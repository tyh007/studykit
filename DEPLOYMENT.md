# StudyKit Deployment Guide

## Architecture

```
┌─ Laptop (Dev) ─────────────────────┐
│  npm run dev → localhost:5173      │
│  Hot-reload frontend               │
│  API proxy → http://nas-ip:3001    │
└────────────────────────────────────┘
         │
         │ Network (LAN)
         ▼
┌─ Ugreen NAS (Docker) ──────────────────────┐
│                                             │
│  nginx (port 80)                            │
│   └─ serves static frontend                 │
│   └─ proxies /api/ → backend:3001           │
│                                             │
│  backend (port 3001)                        │
│   ├─ Express.js REST API                    │
│   ├─ JWT auth                              │
│   └─ File uploads → /data/uploads/         │
│                                             │
│  db (port 5432)                             │
│   └─ PostgreSQL 16                          │
│                                             │
│  Volumes:                                   │
│   ├─ /volume1/docker/studykit/postgres/     │
│   ├─ /volume1/docker/studykit/uploads/      │
│   └─ /volume1/docker/studykit/exports/      │
└─────────────────────────────────────────────┘
```

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Prerequisites

1. **Ugreen NAS** with Docker and Docker Compose installed
2. **SSH or terminal access** to the NAS
3. **A modern browser** (Chrome/Firefox/Safari) on your laptop
4. **Node.js 20+** on your dev machine (for local development)

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Step 1: Get the code on your NAS

```bash
# SSH into your NAS
ssh admin@<nas-ip>

# Create project directory
mkdir -p /volume1/docker/studykit
cd /volume1/docker/studykit

# Copy from your dev machine (run this on your laptop, not on NAS)
scp -r /path/to/studykit/* admin@<nas-ip>:/volume1/docker/studykit/
```

Or if you have git on the NAS:
```bash
git clone <your-repo-url> /volume1/docker/studykit
```

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Step 2: Configure environment

```bash
cd /volume1/docker/studykit
cp .env.example .env
nano .env
```

**Set these values (use strong random values — see below for generation commands):**
```bash
# Database password (CHANGE THIS — required for production)
DB_PASSWORD=<生成一个安全密码>

# JWT signing secret (CHANGE THIS — required for production)
JWT_SECRET=<生成一个 64 字符的随机字符串>

# NAS data directory - adjust if your volume has a different path
NAS_DATA_DIR=/volume1/docker/studykit
```

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Step 3: Create data directories

```bash
mkdir -p /volume1/docker/studykit/{postgres,uploads,exports}
```

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Step 4: Start the services

```bash
cd /volume1/docker/studykit

# Start everything (use -f for NAS data volumes)
# 本地开发可以去掉 -f docker-compose.nas.yml
docker compose -f docker-compose.yml -f docker-compose.nas.yml up -d

# Check all services are running
docker compose ps

# Watch the logs to confirm startup
docker compose logs -f
```

**Expected output from `docker compose ps`:**
```
NAME                    STATUS              PORTS
studykit-db-1           Up (healthy)        5432/tcp
studykit-backend-1      Up                  0.0.0.0:3001->3001/tcp
studykit-frontend-1     Up                  0.0.0.0:80->80/tcp
```

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Step 5: Verify the backend

```bash
# Health check
curl http://localhost:3001/api/health
# → {"status":"ok","version":"0.1.0"}

# Register a test user
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123456"}'
# → {"user":{"id":"...","email":"test@example.com",...},"token":"...","workspace_id":"..."}
```

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Step 6: Open StudyKit

Open your browser and go to:

```
http://<your-nas-ip>
```

Example: if your NAS IP is `192.168.1.100`, go to `http://192.168.1.100`

**First-time user flow:**
1. Click **Sign up** to create an account
2. Create a **Module** (e.g., "PSYC0005 Research Methods")
3. Create a **Lecture** under that module (e.g., "Week 1: Introduction")
4. Click **Upload PDF Slides** and select a lecture PDF
5. Wait for processing — the page will show "Processing slides..." then switch to the viewer
6. Navigate slides with ◀ ▶ buttons, zoom with − +
7. Write notes using the formatting toolbar (H1, H2, B, I, List, Quote, Code)
8. Click **Cornell** to open the cue/summary panel
9. Use **▨ Highlight** or **✎ Draw** tools to annotate slides
10. Ctrl+Z / Ctrl+Shift+Z for undo/redo on annotations
11. Click **Export** to download Markdown or trigger PDF via browser print

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Dev Workflow (local development with hot-reload)

For active development, run the frontend on your laptop with instant hot-reload:

```bash
cd studykit/frontend

# Tell Vite where the NAS backend is
echo "VITE_API_URL=http://<nas-ip>:3001" > .env.local

# Start dev server
npm run dev
# → http://localhost:5173 (hot-reload enabled)
```

The `vite.config.ts` proxy forwards `/api/*` and `/uploads/*` requests to your NAS backend automatically.

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## What to do after deployment

### 1. Set up HTTPS (recommended for any use beyond local network)

```bash
# Option A: Reverse proxy with nginx + Let's Encrypt on NAS
# Create an nginx config that terminates TLS and proxies to studykit-frontend:80

# Option B: Use Ugreen NAS's built-in reverse proxy
#   - Go to NAS web UI → Application Portal → Reverse Proxy
#   - Source: https://studykit.yourdomain.com:443
#   - Destination: http://localhost:80
```

### 2. Set up automatic database backups

```bash
# Add to NAS cron (via web UI or crontab)
# Daily backup at 3 AM
0 3 * * * docker compose -f /volume1/docker/studykit/docker-compose.yml exec -T db pg_dump -U studykit studykit > /volume1/docker/studykit/backups/studykit_$(date +\%Y\%m\%d).sql

# Keep last 30 days
0 4 * * * find /volume1/docker/studykit/backups -name "*.sql" -mtime +30 -delete
```

### 3. Configure PDF export (improve beyond browser print)

The current PDF export uses browser print (Ctrl+P → "Save as PDF"). For a better experience:

- **Playwright server-side rendering** — add a Docker service that renders slides+notes as proper PDF
- **jsPDF** — generate PDF client-side with precise layout control
- See `DEC-005` in the PRD for the export spike decision

### 4. Regular maintenance

```bash
# Update all services (NAS)
cd /volume1/docker/studykit
git pull
docker compose -f docker-compose.yml -f docker-compose.nas.yml up -d --build

# Check logs for errors
docker compose logs --tail=50

# Clean old exports (30-day retention per PRD)
find /volume1/docker/studykit/exports -type f -mtime +30 -delete

# Monitor disk usage
df -h /volume1/docker/studykit
```

### 5. Performance tuning (when you have real data)

- **Code splitting** — The frontend JS bundle is ~1.2MB. Split PDF.js worker, Tiptap, and KaTeX into separate async chunks
- **PostgreSQL tuning** — If you have many lectures, add indexes and tune `shared_buffers`
- **Redis caching** — For frequently accessed PDF metadata in multi-device setups

### 6. Next features to build (from PRD milestones)

| Priority | Feature | Milestone |
|----------|---------|-----------|
| 1 | Equation blocks in editor (KaTeX) | M3 |
| 429 Too Many Requests | Rate limit hit | Wait 15 minutes, or adjust RATE_LIMIT_MAX in .env |
| 2 | Slide thumbnails strip for navigation | M2 |
| 3 | Attachment upload + embedding in notes | M3 |
| 4 | Full sync engine (operation log → push/pull) | M5 |
| 5 | Proper PDF Template A + B rendering | M6 |
| 6 | Offline-first module/lecture creation | M1 |

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `backend` exits immediately | DB not ready | Wait 10s, then `docker compose restart backend` |
| `ECONNREFUSED` connecting to DB | Wrong DB_HOST in backend | Must be `db` (Docker service name), not `localhost` |
| PDF upload fails with 413 | File >100MB | Increase `limits.fileSize` in `source-documents.js` |
| "Failed to load PDF" on canvas | File path wrong | Check `/volume1/docker/studykit/uploads/` exists and has the file |
| White screen on frontend | nginx config error | `docker compose logs frontend` |
| 401 on all API calls | JWT token expired | Log out and sign in again |
| Notes don't save | IndexedDB quota exceeded | Clear browser storage for the site, or increase quota |
| Annotations misaligned at zoom | Scale calculation off | Check `AnnotationLayer.tsx` scale matches `PDFViewer.tsx` viewport |
| Docker volumes not mounting | Wrong NAS path | Check `NAS_DATA_DIR` in `.env` — must be an existing directory |
| Literature tables missing | Schema only initializes on fresh DB | Run: `docker exec -i studykit-db-1 psql -U studykit -d studykit < backend/schema.sql` |

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## File structure reference

```
studykit/
├── docker-compose.yml          # Docker services config
├── .env                        # Secrets (not in git)
├── .env.example                # Template for .env
├── DEPLOYMENT.md               # You are here
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── index.js                # Express server entry
│   ├── db.js                   # PostgreSQL connection pool
│   ├── auth.js                 # JWT middleware
│   ├── schema.sql              # Full DB schema (14 tables)
│   └── routes/
│       ├── auth.js             # Register, login, /me
│       ├── modules.js          # Module CRUD
│       ├── lectures.js         # Lecture CRUD (with note_blocks.module_id consistency)
│       ├── source-documents.js # PDF upload + processing
│       └── note-blocks.js      # Note block CRUD (for sync)
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx             # Main app with auth + workspace UI
        ├── index.css           # All styles with dark mode
        ├── types.ts            # Full PRD data types
        ├── store/useStore.ts   # Zustand state management
        ├── lib/
        │   ├── db.ts           # Dexie.js IndexedDB schema
        │   ├── api.ts          # Backend API client
        │   ├── auth.tsx        # Auth context + session persistence
        │   └── sync.ts         # Sync status helper
        └── components/
            ├── PDFViewer.tsx       # PDF.js slide renderer
            ├── NoteEditor.tsx     # Tiptap editor with structured blocks
            ├── AnnotationLayer.tsx # SVG highlight + ink overlay
            ├── CornellPanel.tsx    # Cornell cue + summary panel
            └── ExportDialog.tsx    # Markdown/PDF export UI
```

---

### 🔐 Generating secure secrets

Run these commands on your **local machine** or **NAS terminal**:

```bash
# Generate a secure DB_PASSWORD (44 characters, base64)
openssl rand -base64 32

# Generate a 64-character JWT_SECRET
openssl rand -base64 48 | head -c 64
```

> **⚠️ IMPORTANT:** Save these values in a password manager. If you lose them:
> - `DB_PASSWORD`: You'll need to reset the PostgreSQL password in the running container
> - `JWT_SECRET`: All existing login tokens will become invalid — users will need to log in again


## Security checklist

- [ ] Changed `DB_PASSWORD` from default
- [ ] Changed `JWT_SECRET` from default
- [ ] HTTPS configured if exposing to internet
- [ ] NAS firewall restricts SSH access
- [ ] Regular DB backups configured
- [ ] Docker images updated periodically
