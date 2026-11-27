// StudyKit v0.5 P6b — local MCP access for AI agents on this computer.
//
// Two halves:
//
//   1. Inside the running app: a small HTTP endpoint on 127.0.0.1
//      (`POST /mcp`, MCP "streamable HTTP" with plain JSON replies). It
//      only checks the caller and forwards each JSON-RPC message to the
//      WebView, where the project rules live (`application/research/mcp`);
//      the WebView answers through `mcp_respond_v1`. Off until the user
//      turns it on.
//   2. `StudyKit --mcp-stdio`: a bridge for agents that launch MCP
//      servers as a process (Claude Desktop, Claude Code). It reads
//      newline-delimited JSON-RPC on stdin, posts each message to the
//      running app, and writes the replies to stdout.
//
// Who may call: a request needs the bearer token from the config file
// (readable only by this user), must come to 127.0.0.1 / localhost with
// the right port, and must not carry an `Origin` header (web pages
// always send one; local agents don't). That keeps websites in the
// user's browser out even though they can reach localhost.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::{Lazy, OnceCell};
use serde::{Deserialize, Serialize};

pub const IDENTIFIER: &str = "com.studykit.desktop";
pub const DEFAULT_PORT: u16 = 47821;
pub const MCP_PATH: &str = "/mcp";
pub const REQUEST_EVENT: &str = "studykit://mcp-request";
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 1024 * 1024;
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------------------
// Config (enabled flag, port, token) — shared by the app and the bridge
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

/// Same folder Tauri uses for `app_config_dir`, resolved without Tauri so
/// the stdio bridge (which never starts Tauri) finds the same file.
pub fn config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support").join(IDENTIFIER))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(IDENTIFIER))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|d| d.join(IDENTIFIER))
    }
}

pub fn config_path_in(dir: &Path) -> PathBuf {
    dir.join("mcp.json")
}

pub fn load_config(dir: &Path) -> Option<McpConfig> {
    let text = std::fs::read_to_string(config_path_in(dir)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_config(dir: &Path, config: &McpConfig) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = config_path_in(dir);
    let text = serde_json::to_string_pretty(config).map_err(std::io::Error::other)?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path)?;
    file.write_all(text.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn new_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ---------------------------------------------------------------------------
// HTTP (just enough of HTTP/1.1 for one POST per connection)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub fn read_request<R: Read>(stream: R) -> Result<HttpRequest, (u16, &'static str)> {
    let mut reader = BufReader::new(stream);
    let mut head = String::new();
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|_| (400, "bad request"))?;
        if n == 0 {
            return Err((400, "connection closed"));
        }
        head.push_str(&line);
        if head.len() > MAX_HEADER_BYTES {
            return Err((431, "headers too large"));
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
    }
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let length: usize = match headers.get("content-length") {
        Some(v) => v.parse().map_err(|_| (400, "bad content-length"))?,
        None => 0,
    };
    if length > MAX_BODY_BYTES {
        return Err((413, "body too large"));
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|_| (400, "short body"))?;
    Ok(HttpRequest { method, path, headers, body })
}

/// Who may call. Returns the HTTP status and reason to refuse with.
pub fn check_request(req: &HttpRequest, token: &str, port: u16) -> Result<(), (u16, &'static str)> {
    if req.headers.contains_key("origin") {
        return Err((403, "requests from web pages are not accepted"));
    }
    let host = req.headers.get("host").map(String::as_str).unwrap_or("");
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
        return Err((403, "unexpected host"));
    }
    if req.path != MCP_PATH {
        return Err((404, "not found"));
    }
    if req.method != "POST" {
        return Err((405, "only POST is supported"));
    }
    let auth = req.headers.get("authorization").map(String::as_str).unwrap_or("");
    let presented = auth.strip_prefix("Bearer ").unwrap_or("");
    if !constant_time_eq(presented.as_bytes(), token.as_bytes()) {
        return Err((401, "missing or wrong token"));
    }
    Ok(())
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        _ => "Service Unavailable",
    }
}

fn write_response(stream: &mut TcpStream, status: u16, body: Option<&str>, session_id: Option<&str>) {
    let body = body.unwrap_or("");
    let mut head = format!("HTTP/1.1 {status} {}\r\nConnection: close\r\nContent-Length: {}\r\n", reason(status), body.len());
    if !body.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if let Some(id) = session_id {
        head.push_str(&format!("Mcp-Session-Id: {id}\r\n"));
    }
    if status == 405 {
        head.push_str("Allow: POST\r\n");
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

fn rpc_error(id: &serde_json::Value, message: &str) -> String {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }).to_string()
}

fn request_id(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .unwrap_or(serde_json::Value::Null)
}

// ---------------------------------------------------------------------------
// Server inside the app
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRequestEvent {
    pub id: String,
    pub body: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpReplyIn {
    pub body: Option<String>,
    pub session_id: Option<String>,
    pub status: Option<u16>,
}

/// Hands a message to whatever answers it (the WebView in the app).
pub type Forward = Arc<dyn Fn(McpRequestEvent) -> Option<McpReplyIn> + Send + Sync>;

pub struct RunningServer {
    pub port: u16,
    stop: Arc<AtomicBool>,
}

impl RunningServer {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn handle_connection(mut stream: TcpStream, token: &str, port: u16, forward: &Forward) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let req = match stream.try_clone().map_err(|_| (400, "bad request")).and_then(read_request) {
        Ok(r) => r,
        Err((status, _)) => return write_response(&mut stream, status, None, None),
    };
    if let Err((status, _)) = check_request(&req, token, port) {
        return write_response(&mut stream, status, None, None);
    }
    let body = match String::from_utf8(req.body.clone()) {
        Ok(b) => b,
        Err(_) => return write_response(&mut stream, 400, None, None),
    };
    let event = McpRequestEvent {
        id: uuid::Uuid::new_v4().to_string(),
        body,
        session_id: req.headers.get("mcp-session-id").cloned(),
    };
    match forward(event) {
        Some(reply) => {
            let status = reply.status.unwrap_or(if reply.body.is_some() { 200 } else { 202 });
            write_response(&mut stream, status, reply.body.as_deref(), reply.session_id.as_deref());
        }
        None => {
            let message = "StudyKit didn't answer. Open StudyKit's Research mode and try again.";
            write_response(&mut stream, 503, Some(&rpc_error(&request_id(&req.body), message)), None);
        }
    }
}

/// Bind 127.0.0.1 (the preferred port, else any free one) and serve.
pub fn serve(preferred_port: u16, token: String, forward: Forward) -> std::io::Result<RunningServer> {
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], preferred_port)))
        .or_else(|_| TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))))?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    std::thread::spawn(move || {
        while !stop_flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let token = token.clone();
                    let forward = forward.clone();
                    std::thread::spawn(move || handle_connection(stream, &token, port, &forward));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => std::thread::sleep(Duration::from_millis(200)),
            }
        }
    });
    Ok(RunningServer { port, stop })
}

static APP: OnceCell<tauri::AppHandle> = OnceCell::new();
static SERVER: Lazy<Mutex<Option<RunningServer>>> = Lazy::new(|| Mutex::new(None));
static LAST_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
static PENDING: Lazy<Mutex<HashMap<String, mpsc::Sender<McpReplyIn>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn webview_forward() -> Forward {
    Arc::new(|event: McpRequestEvent| {
        use tauri::Emitter;
        let app = APP.get()?;
        let (tx, rx) = mpsc::channel();
        let id = event.id.clone();
        PENDING.lock().ok()?.insert(id.clone(), tx);
        if app.emit(REQUEST_EVENT, event).is_err() {
            PENDING.lock().ok()?.remove(&id);
            return None;
        }
        let reply = rx.recv_timeout(REPLY_TIMEOUT).ok();
        if let Ok(mut pending) = PENDING.lock() {
            pending.remove(&id);
        }
        reply
    })
}

fn start_from(config: &McpConfig, dir: &Path) -> Result<(), String> {
    let mut slot = SERVER.lock().map_err(|_| "server lock poisoned".to_string())?;
    if slot.is_some() {
        return Ok(());
    }
    let server = serve(config.port, config.token.clone(), webview_forward()).map_err(|e| format!("could not listen on 127.0.0.1: {e}"))?;
    if server.port != config.port {
        // The preferred port was taken; record the real one for the bridge.
        let mut next = config.clone();
        next.port = server.port;
        save_config(dir, &next).map_err(|e| format!("could not save the MCP settings: {e}"))?;
    }
    *slot = Some(server);
    Ok(())
}

fn stop_server() {
    if let Ok(mut slot) = SERVER.lock() {
        if let Some(server) = slot.take() {
            server.stop();
        }
    }
}

fn set_error(error: Option<String>) {
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = error;
    }
}

/// Called once at startup: remembers the app and starts the server if
/// the user turned agent access on earlier.
pub fn setup(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    if let Some(dir) = config_dir() {
        if let Some(config) = load_config(&dir) {
            if config.enabled {
                set_error(start_from(&config, &dir).err());
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub error: Option<String>,
    /// The program agents launch, with `--mcp-stdio`.
    pub command: Option<String>,
    pub config_file: Option<String>,
}

fn status() -> McpStatus {
    let dir = config_dir();
    let config = dir.as_deref().and_then(load_config);
    let running_port = SERVER.lock().ok().and_then(|s| s.as_ref().map(|r| r.port));
    McpStatus {
        enabled: config.as_ref().map(|c| c.enabled).unwrap_or(false),
        running: running_port.is_some(),
        port: running_port,
        error: LAST_ERROR.lock().ok().and_then(|e| e.clone()),
        command: std::env::current_exe().ok().map(|p| p.display().to_string()),
        config_file: dir.map(|d| config_path_in(&d).display().to_string()),
    }
}

#[tauri::command]
pub fn mcp_status_v1() -> McpStatus {
    status()
}

#[tauri::command]
pub fn mcp_set_enabled_v1(enabled: bool) -> McpStatus {
    let Some(dir) = config_dir() else {
        set_error(Some("could not find the settings folder".to_string()));
        return status();
    };
    let mut config = load_config(&dir).unwrap_or(McpConfig { enabled: false, port: DEFAULT_PORT, token: new_token() });
    config.enabled = enabled;
    if let Err(e) = save_config(&dir, &config) {
        set_error(Some(format!("could not save the MCP settings: {e}")));
        return status();
    }
    if enabled {
        set_error(start_from(&config, &dir).err());
    } else {
        stop_server();
        set_error(None);
    }
    status()
}

/// The WebView's answer to one forwarded message.
#[tauri::command]
pub fn mcp_respond_v1(id: String, reply: McpReplyIn) {
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(tx) = pending.remove(&id) {
            let _ = tx.send(reply);
        }
    }
}

// ---------------------------------------------------------------------------
// Bridge: `StudyKit --mcp-stdio`
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct HttpReply {
    pub status: u16,
    pub session_id: Option<String>,
    pub body: String,
}

pub fn post(port: u16, token: &str, session_id: Option<&str>, body: &str) -> std::io::Result<HttpReply> {
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(2))?;
    stream.set_read_timeout(Some(REPLY_TIMEOUT + Duration::from_secs(5)))?;
    let mut head = format!(
        "POST {MCP_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(id) = session_id {
        head.push_str(&format!("Mcp-Session-Id: {id}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    let text = String::from_utf8_lossy(&raw);
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let session_id = head
        .lines()
        .find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("mcp-session-id")).map(|(_, v)| v.trim().to_string()));
    Ok(HttpReply { status, session_id, body: body.to_string() })
}

/// One stdin line in, zero or one stdout line out. Keeps the session id
/// and replays `initialize` once if the app restarted (unknown session).
pub struct Bridge {
    config: Box<dyn Fn() -> Option<McpConfig>>,
    session_id: Option<String>,
    initialize: Option<String>,
}

const NOT_RUNNING: &str = "StudyKit isn't running, or AI agent access is off. Open StudyKit, go to a project's “AI agents” page and turn on access.";

impl Bridge {
    pub fn new(config: Box<dyn Fn() -> Option<McpConfig>>) -> Self {
        Bridge { config, session_id: None, initialize: None }
    }

    pub fn handle_line(&mut self, line: &str) -> Option<String> {
        let line = line.trim();
        if line.is_empty() {
            return None;
        }
        let parsed: serde_json::Value = serde_json::from_str(line).unwrap_or(serde_json::Value::Null);
        let id = parsed.get("id").cloned();
        let is_initialize = parsed.get("method").and_then(|m| m.as_str()) == Some("initialize");
        if is_initialize {
            self.initialize = Some(line.to_string());
            self.session_id = None;
        }
        let fail = |message: &str| id.as_ref().map(|id| rpc_error(id, message));
        let Some(config) = (self.config)().filter(|c| c.enabled) else {
            return fail(NOT_RUNNING);
        };
        let mut reply = match post(config.port, &config.token, self.session_id.as_deref(), line) {
            Ok(r) => r,
            Err(_) => return fail(NOT_RUNNING),
        };
        if reply.status == 404 && !is_initialize {
            if let Some(init) = self.initialize.clone() {
                if let Ok(again) = post(config.port, &config.token, None, &init) {
                    self.session_id = again.session_id;
                    if let Ok(retry) = post(config.port, &config.token, self.session_id.as_deref(), line) {
                        reply = retry;
                    }
                }
            }
        }
        if is_initialize {
            self.session_id = reply.session_id.clone();
        }
        match reply.status {
            200 if !reply.body.trim().is_empty() => Some(reply.body.trim().to_string()),
            200 | 202 => None,
            401 => fail("StudyKit refused the connection: the access token changed. Restart the agent."),
            _ if !reply.body.trim().is_empty() => Some(reply.body.trim().to_string()),
            _ => fail(NOT_RUNNING),
        }
    }
}

/// Entry point for `--mcp-stdio`. Returns the process exit code.
pub fn run_stdio_bridge() -> i32 {
    let mut bridge = Bridge::new(Box::new(|| config_dir().and_then(|d| load_config(&d))));
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if let Some(out) = bridge.handle_line(&line) {
            if writeln!(stdout, "{out}").and_then(|_| stdout.flush()).is_err() {
                return 1;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(headers: &[(&str, &str)]) -> HttpRequest {
        HttpRequest {
            method: "POST".into(),
            path: MCP_PATH.into(),
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: vec![],
        }
    }

    #[test]
    fn parses_a_post_with_body() {
        let raw = b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:1\r\nContent-Length: 2\r\nX-Thing: a:b\r\n\r\n{}";
        let r = read_request(&raw[..]).unwrap();
        assert_eq!(r.method, "POST");
        assert_eq!(r.headers.get("x-thing").unwrap(), "a:b");
        assert_eq!(r.body, b"{}");
    }

    #[test]
    fn refuses_web_pages_wrong_hosts_and_bad_tokens() {
        let ok = [("host", "127.0.0.1:9"), ("authorization", "Bearer t0k")];
        assert!(check_request(&req(&ok), "t0k", 9).is_ok());
        assert_eq!(check_request(&req(&[("host", "localhost:9"), ("authorization", "Bearer t0k")]), "t0k", 9), Ok(()));
        let mut with_origin = ok.to_vec();
        with_origin.push(("origin", "https://evil.example"));
        assert_eq!(check_request(&req(&with_origin), "t0k", 9).unwrap_err().0, 403);
        assert_eq!(check_request(&req(&[("host", "evil.example:9"), ("authorization", "Bearer t0k")]), "t0k", 9).unwrap_err().0, 403);
        assert_eq!(check_request(&req(&[("host", "127.0.0.1:9"), ("authorization", "Bearer nope")]), "t0k", 9).unwrap_err().0, 401);
        assert_eq!(check_request(&req(&[("host", "127.0.0.1:9")]), "t0k", 9).unwrap_err().0, 401);
        let mut get = req(&ok);
        get.method = "GET".into();
        assert_eq!(check_request(&get, "t0k", 9).unwrap_err().0, 405);
    }

    #[test]
    fn config_round_trips_and_is_private() {
        let dir = tempfile::tempdir().unwrap();
        let config = McpConfig { enabled: true, port: 4000, token: new_token() };
        save_config(dir.path(), &config).unwrap();
        assert_eq!(load_config(dir.path()), Some(config));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(config_path_in(dir.path())).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    /// A stand-in for the WebView: answers initialize with a session, then
    /// echoes; forgets sessions when `restarted` is set.
    fn fake_app(restarted: Arc<AtomicBool>) -> Forward {
        let known = Arc::new(Mutex::new(Vec::<String>::new()));
        Arc::new(move |event: McpRequestEvent| {
            let v: serde_json::Value = serde_json::from_str(&event.body).unwrap();
            if restarted.swap(false, Ordering::SeqCst) {
                known.lock().unwrap().clear();
            }
            if v.get("id").is_none() {
                return Some(McpReplyIn { body: None, session_id: None, status: None });
            }
            if v["method"] == "initialize" {
                let sid = uuid::Uuid::new_v4().to_string();
                known.lock().unwrap().push(sid.clone());
                return Some(McpReplyIn { body: Some(format!(r#"{{"jsonrpc":"2.0","id":{},"result":{{}}}}"#, v["id"])), session_id: Some(sid), status: None });
            }
            let ok = event.session_id.map(|s| known.lock().unwrap().contains(&s)).unwrap_or(false);
            Some(McpReplyIn {
                body: Some(format!(r#"{{"jsonrpc":"2.0","id":{},"result":{{"ok":{ok}}}}}"#, v["id"])),
                session_id: None,
                status: if ok { None } else { Some(404) },
            })
        })
    }

    #[test]
    fn bridge_talks_to_the_server_end_to_end_and_survives_an_app_restart() {
        let restarted = Arc::new(AtomicBool::new(false));
        let token = new_token();
        let server = serve(0, token.clone(), fake_app(restarted.clone())).unwrap();
        let config = McpConfig { enabled: true, port: server.port, token: token.clone() };
        let mut bridge = Bridge::new(Box::new(move || Some(config.clone())));

        let init = bridge.handle_line(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#).unwrap();
        assert!(init.contains(r#""id":1"#));
        assert_eq!(bridge.handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), None);
        assert!(bridge.handle_line(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).unwrap().contains(r#""ok":true"#));

        // The app restarted and forgot the session: the bridge re-initializes once.
        restarted.store(true, Ordering::SeqCst);
        assert!(bridge.handle_line(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#).unwrap().contains(r#""ok":true"#));

        // A wrong token is refused; the agent gets a JSON-RPC error, not silence.
        let mut wrong = Bridge::new(Box::new(move || Some(McpConfig { enabled: true, port: server.port, token: "x".into() })));
        assert!(wrong.handle_line(r#"{"jsonrpc":"2.0","id":4,"method":"ping"}"#).unwrap().contains("access token"));
        server.stop();
    }

    #[test]
    fn bridge_explains_when_access_is_off() {
        let mut bridge = Bridge::new(Box::new(|| None));
        let out = bridge.handle_line(r#"{"jsonrpc":"2.0","id":7,"method":"initialize"}"#).unwrap();
        assert!(out.contains(r#""id":7"#) && out.contains("turn on access"));
        assert_eq!(bridge.handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), None);
    }

    #[test]
    fn server_rejects_browser_requests_over_tcp() {
        let token = new_token();
        let server = serve(0, token.clone(), Arc::new(|_| None)).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
        let body = "{}";
        write!(
            stream,
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nOrigin: https://evil.example\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{body}",
            server.port,
            body.len()
        )
        .unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        assert!(out.starts_with("HTTP/1.1 403"));
        server.stop();
    }
}
