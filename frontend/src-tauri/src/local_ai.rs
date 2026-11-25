use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::workspace::WorkspaceError;

const OLLAMA_ADDR: &str = "127.0.0.1:11434";
const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LocalAiDiscovery {
    pub reachable: bool,
    pub endpoint: String,
    pub models: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LocalAiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalAiChatResponse {
    pub content: String,
    pub model: String,
    pub provider: String,
}

fn request(
    path: &str,
    method: &str,
    body: Option<&str>,
    timeout: Duration,
) -> Result<String, String> {
    let address: SocketAddr = OLLAMA_ADDR
        .parse()
        .map_err(|_| "invalid built-in Ollama address".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(450))
        .map_err(|err| format!("Ollama is not reachable: {err}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|err| format!("set Ollama read timeout: {err}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|err| format!("set Ollama write timeout: {err}"))?;
    let payload = body.unwrap_or("");
    let headers = if body.is_some() {
        format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.len()
        )
    } else {
        format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
    };
    stream
        .write_all(headers.as_bytes())
        .map_err(|err| format!("write Ollama request: {err}"))?;
    let mut response = Vec::new();
    stream
        .take(MAX_RESPONSE_BYTES)
        .read_to_end(&mut response)
        .map_err(|err| format!("read Ollama response: {err}"))?;
    let text = String::from_utf8(response)
        .map_err(|_| "Ollama returned a non-UTF-8 response".to_string())?;
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Ollama returned an invalid HTTP response".to_string())?;
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        let status = head.lines().next().unwrap_or("unknown status");
        return Err(format!("Ollama request failed: {status}"));
    }
    Ok(body.to_string())
}

pub fn discover() -> LocalAiDiscovery {
    match request("/api/tags", "GET", None, Duration::from_secs(1)) {
        Ok(body) => {
            let parsed: serde_json::Value = match serde_json::from_str(&body) {
                Ok(value) => value,
                Err(err) => {
                    return LocalAiDiscovery {
                        reachable: false,
                        endpoint: "http://localhost:11434".into(),
                        models: Vec::new(),
                        error: Some(format!("Ollama returned invalid JSON: {err}")),
                    }
                }
            };
            let mut models = parsed
                .get("models")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|model| {
                    model
                        .get("name")
                        .or_else(|| model.get("model"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
                .collect::<Vec<_>>();
            models.sort();
            models.dedup();
            LocalAiDiscovery {
                reachable: true,
                endpoint: "http://localhost:11434".into(),
                models,
                error: None,
            }
        }
        Err(error) => LocalAiDiscovery {
            reachable: false,
            endpoint: "http://localhost:11434".into(),
            models: Vec::new(),
            error: Some(error),
        },
    }
}

pub fn chat(
    model: &str,
    messages: &[LocalAiMessage],
) -> Result<LocalAiChatResponse, WorkspaceError> {
    if model.trim().is_empty() || model.len() > 200 || model.contains('\0') {
        return Err(WorkspaceError::validation_failed(
            "Ollama model name is invalid",
        ));
    }
    if messages.is_empty() || messages.len() > 100 {
        return Err(WorkspaceError::validation_failed(
            "Ollama chat requires 1 to 100 messages",
        ));
    }
    let mut total = 0;
    for message in messages {
        if !matches!(message.role.as_str(), "system" | "user" | "assistant") {
            return Err(WorkspaceError::validation_failed(
                "Ollama chat message role is invalid",
            ));
        }
        total += message.content.len();
    }
    if total > 500_000 {
        return Err(WorkspaceError::validation_failed(
            "Ollama chat context exceeds 500000 bytes",
        ));
    }
    let body = serde_json::json!({
        "model": model,
        "messages": messages.iter().map(|message| serde_json::json!({
            "role": message.role,
            "content": message.content,
        })).collect::<Vec<_>>(),
        "stream": false,
    })
    .to_string();
    let raw = request("/api/chat", "POST", Some(&body), Duration::from_secs(120))
        .map_err(WorkspaceError::db_unusable)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| WorkspaceError::db_unusable("Ollama returned invalid JSON"))?;
    let content = parsed
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| WorkspaceError::db_unusable("Ollama response has no message content"))?;
    Ok(LocalAiChatResponse {
        content: content.to_string(),
        model: model.to_string(),
        provider: "ollama".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_validation_rejects_unsafe_input_before_network() {
        assert!(chat("", &[]).is_err());
        assert!(chat(
            "model",
            &[LocalAiMessage {
                role: "tool".into(),
                content: "x".into()
            }]
        )
        .is_err());
    }
}
