# StudyKit: Complete Setup Guide for Ugreen NAS

### From zero (never used Docker) to running app — *including remote access*

This guide assumes you have:

- A Ugreen NAS (any model that supports Docker)
- A computer anywhere in the world (you connect remotely)
- A few hours (actual hands-on time: ~30 minutes)

> **🌐 Working remotely?** This guide is written for setting up your NAS even when you're not on the same network.
> Everything can be done through your NAS's web UI — no SSH required, no need to be in the same building.

---

## Part 0: Remote access — choose your method

Since you access your NAS remotely, you need one of these methods to:

1. **Log into the NAS web UI** (to install Docker, upload files, run commands)
2. **Access StudyKit in your browser** (once it's running)

Pick the method that matches your setup before continuing:

### Method A: UGREENLink (built-in, easiest)

Your Ugreen NAS has a built-in remote access service (like a personal web address).

**To find your UGREENLink ID:**
- Log into your NAS web UI → **Control Panel** → **Remote Access** (or **UGREENLink**)
- You'll see a URL like `https://<your-id>.ugreenlink.com`
- This works like a personal web address — type it in any browser anywhere

**What it's good for:** Accessing the NAS web UI remotely.  
**What you'll still need for StudyKit:** Port forwarding or a tunnel (see Part 9).

### Method B: VPN (Tailscale / WireGuard / OpenVPN) — *recommended for StudyKit*

Install a VPN server on your NAS, or use a mesh VPN like **Tailscale**.

**Tailscale (easiest VPN setup):**
1. Go to your NAS web UI → App Center → search "Tailscale" → Install
2. Open Tailscale, log in with your Google/Microsoft/Apple account
3. Your NAS gets a unique IP like `100.x.x.x`
4. Install Tailscale on your laptop/phone too
5. Now you can access your NAS using the Tailscale IP from anywhere — it's like being on the same network

**What it's good for:** Everything. Once connected via VPN, you access the NAS exactly as if you were at home.

### Method C: Port forwarding + DDNS

Forward ports on your home router. Requires:
- A router where you can configure port forwarding (admin access)
- A DDNS hostname (e.g., `myhouse.ddns.net`) — free from No-IP, DuckDNS, etc.

**What it's good for:** Direct access — no extra software.  
**Risks:** Exposes your NAS directly to the internet. Only recommended if you know what you're doing.

### Method D: Cloudflare Tunnel (cloudflared)

Creates a secure tunnel from Cloudflare's network to your NAS. No open ports on your router.

**Setup:**
1. Install "cloudflared" on your NAS via App Center or Docker
2. Authenticate with your Cloudflare account
3. Point a domain or subdomain at the tunnel

**What it's good for:** Secure remote access without opening ports. Free tier works well.

---

**💡 Recommendation for this guide:** The rest of this guide assumes you're using **VPN (Tailscale)** or the **NAS web UI's built-in tools**. Both work seamlessly from anywhere. If you're using a different method, skip to **[Part 8: Making StudyKit accessible remotely](#part-8-making-studykit-accessible-remotely)** after Docker is running.

---

## Part 1: What are we building?

Think of your NAS as a mini computer that stays on 24/7. We're going to install three "mini apps" (called **containers**) on it:


| Container      | What it does                                                 | Like...          |
| -------------- | ------------------------------------------------------------ | ---------------- |
| **PostgreSQL** | Stores your data (modules, lectures, notes) securely         | A filing cabinet |
| **Backend**    | The brain — handles logins, PDF uploads, saving to database | A receptionist   |
| **Frontend**   | The web page you see in your browser                         | A website        |

Docker is the tool that runs all three containers together, like a conductor leading an orchestra.

---

## Part 2: Find your NAS (remotely)

Since you're not on the same network, here's how to reach your NAS:

### 2.1 Connect to your NAS web UI

Your Ugreen NAS has a web interface (desktop-like UI) that you can access remotely.

**Via UGREENLink (built-in, no setup needed):**
1. Go to `https://<your-id>.ugreenlink.com` in your browser
   - Don't know your ID? Check the Ugreen mobile app → Device Info → UGREENLink ID
   - Or check the email you got when you first set up the NAS
2. Log in with your NAS admin username and password
3. You'll see the Ugreen desktop — this is the NAS web UI

**Via VPN (if you set up Tailscale/WireGuard):**
1. Connect to your VPN (open Tailscale app, it auto-connects)
2. Once connected, type your NAS's local IP in the browser: `http://192.168.1.100`
   - Find the IP via the Tailscale admin console or your NAS web UI
3. Log in with your NAS admin credentials

> **✏️ Write your access info here:**
> - UGREENLink URL: `https://____________________`
> - OR VPN IP: `http://____________________`
> - NAS admin username: _______________
> - NAS admin password: _______________

### 2.2 Once you're in the NAS web UI

You should see a desktop that looks like Windows or Mac. This is where we'll do everything — install Docker, upload files, run commands.

> **💡 No matter where you are in the world**, once you access the web UI, the steps are identical to being at home. The NAS runs everything locally.

### Optional: Find the local IP (for later use)

If you're ever on the same network as the NAS, you'll also want the local IP:

1. Inside the NAS web UI, open **Control Panel** → **Network** → **LAN**
2. Look for "IP Address" — it'll show something like `192.168.x.x`
3. Write it down: **NAS local IP:** ____________________

---

## Part 3: Install Docker on your Ugreen NAS

All done through the NAS web UI — just like installing an app on your phone.

1. Open a browser and go to your NAS web UI (via UGREENLink URL or VPN)
2. Log in with your NAS admin username and password

You'll see the Ugreen desktop (looks like Windows/Mac).

### Find and install Docker:

3. Look for an icon called **"App Center"** (or a shopping bag icon) — click it
4. In the search bar at the top, type **"Docker"**
5. You'll see **"Docker"** or **"Docker Manager"** appear in the results
6. Click **Install** (or **"Get"**)
7. Wait 1-2 minutes for it to finish installing

> **Can't find Docker in App Center?**
> - Go to **Control Panel** → **Terminal & SNMP**
> - Enable **SSH** and **Web SSH**
> - Then check App Center again

### Verify Docker is installed:

1. Go back to the Ugreen desktop
2. Find and open **"Docker"** or **"Docker Manager"** (there's now a new icon)
3. You should see a dashboard saying "No containers running" — that's correct
4. Leave this window open, we'll come back later

---

## Part 4: Get the StudyKit code onto your NAS

Since you're remote, the easiest way is to use your NAS's **File Manager** — it's like drag-and-dropping files into a folder over the internet.

### 4.1 Prepare the files on your computer

First, on your **computer**, open the StudyKit project folder and **zip it up**:

- **Mac**: Right-click the `studykit` folder → **Compress "studykit"** → creates `studykit.zip`
- **Windows**: Right-click the `studykit` folder → **Send to** → **Compressed (zipped) folder** → creates `studykit.zip`

### 4.2 Upload through the NAS web UI

1. Go to your NAS web UI (via UGREENLink or VPN)
2. Open **File Manager** (look for an icon that looks like a folder or filing cabinet)
3. Navigate to: `/volume1/docker/`
   - *If the `docker` folder doesn't exist yet, click "New Folder" and name it `docker`*
4. Drag and drop your `studykit.zip` file into the `/volume1/docker/` folder
   - *The upload will happen over the internet — a ~5MB zip takes about 10-20 seconds*
5. Once uploaded, right-click the zip file → **Extract** (or **Unzip**)
6. After extraction, you'll see a `studykit` folder with all the files inside
7. You can delete the `studykit.zip` file afterwards

### 4.3 Alternative: Use the NAS web terminal (for git users)

If you prefer the command line, UGOS Pro has a built-in **Web SSH terminal** — no separate SSH app needed:

1. In the NAS web UI, go to **Control Panel** → **Terminal & SNMP**
2. Make sure **Web SSH** is enabled
3. Open a new browser tab and go to `https://<your-nas-ip>:7681`
   - Or look for a "Terminal" icon on the desktop
4. Log in with your NAS admin username and password
5. Now you're typing commands directly on the NAS — right in your browser:

```bash
# Create the project folder
sudo mkdir -p /volume1/docker/studykit

# Download the code (if you uploaded it to GitHub)
cd /volume1/docker/
git clone https://github.com/YOUR_USERNAME/studykit.git
```

### 4.4 Verify the files are there

In the File Manager, navigate to `/volume1/docker/studykit/`. You should see:

```
docker-compose.yml    ← the most important file (Docker instructions)
backend/              ← the server code
frontend/             ← the website code
.env.example          ← template for your settings
SETUP_FROM_ZERO.md    ← this guide
```

If you see these files, the code is on your NAS. ✅

---

## Part 5: Configure settings

Now we need to set up your passwords and create storage folders. Use the **Web SSH terminal** from Part 4.3, or open the **Terminal** app on your NAS desktop.

### 5.1 Open the web terminal

**From your NAS web UI (works remotely):**
- Look for a **"Terminal"** icon on the desktop, or
- Go to **Control Panel** → **Terminal & SNMP** → **Web SSH** → click the link
- Log in with your NAS admin username and password

You should see a black screen with a blinking cursor — this is the NAS command line.

### 5.2 Create the environment file

Type these commands one at a time, pressing Enter after each:

```bash
cd /volume1/docker/studykit
cp .env.example .env
```

- `cp` = "copy"
- This creates a file called `.env` (your actual settings) from `.env.example` (the template)

### 5.3 Edit the settings

Now we need to set secure passwords. Type:

```bash
nano .env
```

- `nano` = a simple text editor that opens right in the terminal
- You'll see the file contents

Use the **arrow keys** on your keyboard to move the cursor. Change these two lines:

**Find this line:**
```
DB_PASSWORD=change_me_in_production
```
**Change it to something like (make up your own!):**
```
DB_PASSWORD=MyN4s!sS3cur3#2026
```

**Find this line:**
```
JWT_SECRET=change_me_in_production
```
**Change it to something like (make up your own!):**
```
JWT_SECRET=studykit-jwt-secret-k8x9m2p4v6
```

**Also add an AI credential encryption key:**
```
AI_CREDENTIAL_ENCRYPTION_KEY=请填写至少32位的独立随机字符串
```

You can generate a suitable 64-character hexadecimal key with:
```bash
openssl rand -hex 32
```

> **⚠️ Important:** Don't use the examples above. Keep `AI_CREDENTIAL_ENCRYPTION_KEY` stable after users save API keys, otherwise those credentials cannot be decrypted.

**To save and exit nano:**
1. Press `Ctrl + X` (hold the Control key, press X)
2. Press `Y` (to answer "Yes, save changes")
3. Press `Enter` (to confirm the filename)

You'll be back at the command prompt.

### 5.4 Create data folders

```bash
sudo mkdir -p /volume1/docker/studykit/{postgres,uploads,exports}
```

This creates three storage folders:
- `postgres/` — where your database files live
- `uploads/` — where uploaded PDFs are stored
- `exports/` — where exported files are stored

---

## Part 6: Start Docker

### 6.1 The magic command

Still in the web terminal, make sure you're in the right folder:

```bash
cd /volume1/docker/studykit
```

Then run:

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.nas.yml up -d
```

- `sudo` = "as administrator"
- `docker compose` = "use Docker to run multiple containers together"
- `-f docker-compose.yml -f docker-compose.nas.yml` = 使用两个配置文件（主配置 + NAS 数据卷配置）
- `up` = "start"
- `-d` = "in the background" (detached mode)

> 💡 **如果是在你自己的电脑上测试**（不是在 NAS），只需要：
> ```bash
> docker compose up -d
> ```
> 不需要 `-f docker-compose.nas.yml`，也不需要 `sudo`。

This will take **2-5 minutes** the first time. Docker is downloading and building everything. You'll see a lot of scrolling text — that's normal.

When it finishes, you'll see something like:

```
✔ Container studykit-db-1          Started
✔ Container studykit-backend-1     Started
✔ Container studykit-frontend-1    Started
```

### 6.2 Check everything is running

```bash
sudo docker compose ps
```

You should see:


| NAME                | STATUS       | PORTS                  |
| ------------------- | ------------ | ---------------------- |
| studykit-db-1       | Up (healthy) | 5432/tcp               |
| studykit-backend-1  | Up           | 0.0.0.0:3001->3001/tcp |
| studykit-frontend-1 | Up           | 0.0.0.0:80->80/tcp     |

If any show "Exit" or "Restarting", wait 30 seconds and check again.

### 6.3 Test the backend

```bash
curl http://localhost:3001/api/health
```

You should see:

```json
{"status":"ok","version":"0.1.0"}
```

### 6.4 Create your first user

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_password_here"}'
```

Replace the email and password with what you want. You'll get back:

```json
{"user":{"id":"...","email":"admin@example.com",...},"token":"...","workspace_id":"..."}
```

---

## Part 7: Open StudyKit in your browser

How you access StudyKit remotely depends on your network setup:

### If you set up Tailscale (recommended):
1. Make sure Tailscale is running on your laptop (it auto-connects)
2. Open a browser and go to: `http://<nas-tailscale-ip>`
   - Find your NAS Tailscale IP in the Tailscale app or at [tailscale.com/admin](https://tailscale.com/admin/machines)
   - It looks like `http://100.99.88.77`
3. Log in with the email and password from Step 6.4

### If you set up port forwarding or Cloudflare Tunnel:
- Use your domain: `https://studykit.yourdomain.com`
- Or DDNS hostname: `http://mystudykit.duckdns.org`

### If you haven't set up remote access yet:
1. **Temporarily:** If you happen to be on the same Wi-Fi as the NAS, just use `http://<nas-local-ip>` (e.g., `http://192.168.1.100`)
2. **For permanent remote access:** Go to **Part 8** to set up Tailscale or another method

> **💡 Tip:** The easiest way is **Tailscale** (Part 8, Method A). It's free, takes 5 minutes, and works from anywhere.

**Congratulations! StudyKit is running on your NAS! 🎉**

---

## Part 8: Making StudyKit accessible remotely

StudyKit is currently only accessible from within your home network (it's running on port 80 of your NAS).
To access it from outside your home, pick one of these methods:

### Method A: Tailscale (easiest, recommended)

Tailscale creates a secure private network between your devices. Free for personal use.

**Step 1: Install Tailscale on your NAS**
1. Go to your NAS web UI → **App Center**
2. Search for **"Tailscale"** → **Install**
3. Open Tailscale from the desktop → **Log in** with your Google/Microsoft/Apple account
4. Note the Tailscale IP shown (looks like `100.x.x.x`)

**Step 2: Install Tailscale on your devices**
- **Laptop**: Go to [tailscale.com/download](https://tailscale.com/download) → install → log in with same account
- **Phone**: Download "Tailscale" from App Store/Play Store → log in

**Step 3: Access StudyKit**
1. On your laptop/phone, make sure Tailscale is connected (it auto-connects)
2. Open a browser and go to: `http://<nas-tailscale-ip>:80`
   - Example: `http://100.99.88.77`
3. You'll see StudyKit from anywhere in the world

**To find your NAS Tailscale IP:**
- Open Tailscale on your NAS → it's shown at the top
- Or go to [tailscale.com/admin/machines](https://tailscale.com/admin/machines) while logged in

> **⏱️ Time:** 5 minutes | **Cost:** Free | **Security:** Excellent (encrypted tunnel)

### Method B: UGREENLink + Port Forwarding

If you prefer to use the built-in UGREENLink system, you need to set up port forwarding on your home router.

**Step 1: Find your router's admin page**
- Usually at `http://192.168.1.1` or `http://192.168.0.1`
- Log in with your router admin password

**Step 2: Set up port forwarding**
- Look for **"Port Forwarding"** or **"Virtual Server"** in the router menu
- Create two rules:

| Rule | External Port | Internal IP | Internal Port | Protocol |
|------|--------------|-------------|---------------|----------|
| StudyKit Web | 80 | *your NAS IP* | 80 | TCP |
| StudyKit API | 3001 | *your NAS IP* | 3001 | TCP |

**Step 3: Set up DDNS (Dynamic DNS)**
Since your home IP address changes, you need a fixed hostname:
- Go to your router → **DDNS** or **Dynamic DNS**
- Sign up for a free DDNS service: [DuckDNS](https://duckdns.org) (free), [No-IP](https://noip.com) (free)
- Enter your DDNS hostname in the router settings

**Step 4: Access StudyKit**
- Open a browser and go to: `http://<your-ddns-hostname>` (e.g., `http://mystudykit.duckdns.org`)

> **⏱️ Time:** 15 minutes | **Cost:** Free (DDNS) | **Security:** Moderate (ports exposed)

### Method C: Cloudflare Tunnel (no open ports needed)

Cloudflare Tunnel creates a secure connection without opening any ports on your router.

**Prerequisites:** A domain name managed by Cloudflare (free tier works)

**Step 1: Install Cloudflare Tunnel on your NAS**
1. Go to NAS web UI → **App Center** → search for **"Cloudflared"** or **"Cloudflare Tunnel"** → Install
2. Or use Docker: open the web terminal and run:
```bash
sudo docker run -d --name cloudflared cloudflare/cloudflared tunnel --no-autoupdate run --token your-token-here
```

**Step 2: Create a tunnel from Cloudflare dashboard**
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Zero Trust** → **Networks** → **Tunnels**
2. Click **Create a tunnel** → named it `studykit`
3. Follow the install instructions (they'll give you a token)
4. Add a **Public Hostname** pointing to `http://localhost:80`

**Step 3: Access StudyKit**
- Go to `https://studykit.yourdomain.com` (or whatever subdomain you set)

> **⏱️ Time:** 20 minutes | **Cost:** Free (if you own a domain) | **Security:** Excellent (no open ports)

### Method D: Dedicated Reverse Proxy on Docker

If your NAS has a public IP or you want to run nginx as a reverse proxy:

```bash
# In the web terminal, create a reverse proxy config
sudo docker run -d \
  --name reverse-proxy \
  -p 443:443 \
  -v /volume1/docker/proxy/letsencrypt:/etc/letsencrypt \
  nginx:alpine
```

(This is more advanced — only recommended if you know what you're doing.)

---

**💡 My recommendation:** Use **Tailscale (Method A)**. It's free, takes 5 minutes, works from anywhere on any device, and doesn't require touching your router settings. After setting it up, you access StudyKit at `http://100.x.x.x` just like you would at `http://192.168.1.100`.

---

## Part 9: First-time user guide

Once you're logged in:

1. **Create a Module** — Click the "+ New" button in the sidebar. Type a module name (e.g., "PSYC0005 Research Methods") and press Enter.
2. **Create a Lecture** — Click your module to select it, then click "+ Add lecture". Give it a title (e.g., "Week 1: Introduction").
3. **Upload a PDF** — Click the lecture. You'll see "Upload PDF Slides". Click that and select a PDF from your computer.
4. **Wait for processing** — A message will say "Processing slides...". This takes a few seconds.
5. **View slides** — Use the ◀ and ▶ buttons to navigate. Use − and + to zoom.
6. **Write notes** — Click in the note area on the right. Use the toolbar to format text (H1, H2, bold, lists, etc.)
7. **Annotate slides** — Click the ▨ (highlight) or ✎ (draw) button on the slide. Drag on the slide to create highlights.
8. **Cornell notes** — Click "Cornell" in the notes header. A panel opens on the right for cues and summaries.
9. **Export** — Click "Export" in the top header. Choose Markdown to download your notes as a text file.

---

## Part 10: Common tasks

### Stopping StudyKit

```bash
cd /volume1/docker/studykit
sudo docker compose down
```

This stops everything. Your data is still saved.

### Starting StudyKit again

**NAS 上：**
```bash
cd /volume1/docker/studykit
sudo docker compose -f docker-compose.yml -f docker-compose.nas.yml up -d
```

**本地电脑上（测试用）：**
```bash
cd /path/to/studykit
docker compose up -d
```

### Viewing logs (if something goes wrong)

```bash
cd /volume1/docker/studykit
sudo docker compose logs --tail=50
```

This shows the last 50 lines of logs from all containers.

### Viewing logs for a specific container

```bash
sudo docker compose logs backend --tail=50
# or
sudo docker compose logs frontend --tail=50
# or
sudo docker compose logs db --tail=50
```

### Restarting a single container

```bash
sudo docker compose restart backend
```

### Updating StudyKit (when you get new code)

```bash
cd /volume1/docker/studykit
# Replace the files (either scp from your computer or git pull)
# Then rebuild and restart:
sudo docker compose up -d --build
```

---

## Part 11: Troubleshooting

### Can't access the NAS web UI remotely

Make sure you're using the right URL:
- **UGREENLink**: `https://<your-id>.ugreenlink.com` — log into UGOS first
- **Tailscale**: Make sure Tailscale is running on both NAS and your laptop — check at [tailscale.com/admin/machines](https://tailscale.com/admin/machines)

### StudyKit loads but login/upload fails

If you're accessing StudyKit via port forwarding (not Tailscale), the frontend needs to reach the backend API on port 3001. Make sure **both** port 80 and port 3001 are forwarded in your router.

Or better: use Tailscale — then both ports work without any forwarding.

### Upload is very slow

Uploading a large PDF over a remote connection (especially port forwarded) can be slow. Workaround:
1. Upload the PDF to your NAS **File Manager** first (via UGREENLink)
2. Then in StudyKit, we'd need a "import from NAS" feature (coming in a future update)
3. For now, just let the upload complete — it'll get there eventually

### "Permission denied" when running docker commands

```bash
# Try adding sudo before every docker command
sudo docker compose ps
```

### "docker: command not found"

Docker isn't installed on your NAS. Go back to Part 3 and install Docker from the App Center.

### Can't open the web terminal

1. In NAS web UI, go to **Control Panel** → **Terminal & SNMP**
2. Make sure **Web SSH** is enabled
3. Try accessing it at `https://<nas-ip>:7681` in a new browser tab

### Containers show "Exit" status

```bash
# Check what went wrong
sudo docker compose logs backend
```

Common causes:

- PostgreSQL wasn't ready yet → just wait and run `sudo docker compose restart backend`
- Wrong database password in `.env` → check your `.env` file matches what you set

### Can't see the login page at http://192.168.1.100

1. Check the IP is correct (find it again from Part 2)
2. Make sure Docker is running: `sudo docker compose ps`
3. Try `http://192.168.1.100:80` (add port 80 explicitly)
4. Check frontend logs: `sudo docker compose logs frontend`

### "Port already in use" error

Something else on your NAS is already using port 80 or 3001. Either:

- Stop the other service
- Or edit `docker-compose.yml` to change the ports (e.g., change `"80:80"` to `"8080:80"`, then access via `http://192.168.1.100:8080` or `http://100.x.x.x:8080` via Tailscale)

### I forgot my StudyKit login password

Run these commands in the **web terminal** (the one inside your NAS web UI):

```bash
# Go to the project folder
cd /volume1/docker/studykit

# Connect to the database
sudo docker compose exec db psql -U studykit -d studykit
```

Once you see a prompt like `studykit=#`, type:
```sql
DELETE FROM users WHERE email = 'your@email.com';
```
Press Enter, then type `\q` and press Enter to exit.

Now go back to StudyKit and click **Sign up** to create a new account.

---

## Appendix: Useful commands cheat sheet

| Task | Command |
|------|---------|
| **本地开发** (Mac/PC) | `docker compose up -d` |
| **NAS 部署** (带数据持久化) | `sudo docker compose -f docker-compose.yml -f docker-compose.nas.yml up -d` |
| **停止所有服务** | `sudo docker compose down` |
| **查看运行状态** | `sudo docker compose ps` |
| **查看日志** | `sudo docker compose logs --tail=50` |
| **重启后端** | `sudo docker compose restart backend` |
| **更新后重建** (NAS) | `sudo docker compose -f docker-compose.yml -f docker-compose.nas.yml up -d --build` |
| Check disk space | `df -h /volume1/docker/studykit` |
| Backup database | `sudo docker compose exec db pg_dump -U studykit studykit > backup.sql` |
| Connect to database | `sudo docker compose exec db psql -U studykit -d studykit` |
| List uploaded files | `ls -la /volume1/docker/studykit/uploads/` |
| **Find your NAS local IP** | In NAS web UI → Control Panel → Network → LAN |
| **Find your Tailscale IP** | In NAS web UI → open Tailscale app, or check [tailscale.com/admin](https://tailscale.com/admin/machines) |
| **Access web terminal** | In NAS web UI → Control Panel → Terminal & SNMP → Web SSH |

---

## Need help?

If you get stuck at any step:

- Take a screenshot of the error
- Copy the output of `sudo docker compose logs --tail=50`
- Include your NAS model name

*This guide was written for Ugreen NAS running UGOS with Docker support.*
