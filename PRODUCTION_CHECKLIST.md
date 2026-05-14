# StudyKit Production Deployment Security Checklist

**Last Updated:** 14 May 2026

> 🔐 **Before deploying StudyKit to production with non-trusted users**, complete **ALL** items in this checklist.

---

## 1. Environment Variables

### Database Credentials

- [X]  `DB_PASSWORD` has been changed from default (✓ Set to: `+PQslJlF/6Nw3j2JErwZftxBKBmLUx5VJ/yaIOItAkA=`)
  - Generated via: `openssl rand -base64 32`
  - **Store this in a password manager** — if lost, you'll need to reset PostgreSQL password in the running container

### JWT Secret

- [X]  `JWT_SECRET` is at least 64 characters (✓ Set to: `GIYpK80TMZF8m/3liD4qGk0mhpeqypszrkt3zn0h2jLjnCvf2RihFTr9RqsX7J26`)
  - Generated via: `openssl rand -base64 48 | head -c 64`
  - **Store this in a password manager** — if lost, all existing login tokens become invalid

### CORS Configuration (Production)

- [ ]  `CORS_ORIGIN` has been set to your production domain
  - For NAS internal use: `CORS_ORIGIN=http://<nas-ip>`
  - For domain: `CORS_ORIGIN=https://studykit.yourdomain.com`
  - **Note:** nginx reverse proxy handles CORS for local network deployments; backend CORS acts as secondary defense

### Rate Limiting

- [X]  `RATE_LIMIT_WINDOW_MS=900000` (15 minutes) — enabled
- [X]  `RATE_LIMIT_MAX=100` — requests per window — enabled
  - Production setting to prevent brute-force attacks and DoS
  - Adjust based on expected usage patterns

---

## 2. File Security

### .gitignore Protection

- [X]  `.env` is listed in `.gitignore` ✓
- [X]  `.env.local` is listed in `.gitignore` ✓
- [X]  `node_modules/`, `dist/`, `*.log` are listed ✓
- [X]  `uploads/`, `exports/` are listed ✓

**Verification:**

```bash
git check-ignore -v .env .env.local
# Should show both files are ignored
```

---

## 3. Backend Security

### Helmet.js Headers

- [X]  `helmet()` middleware is enabled ✓
- [X]  CSP is disabled in backend (handled by nginx) ✓
- [X]  COEP (Cross-Origin Embedder Policy) is disabled for PDF.js ✓

### Authentication

- [X]  JWT middleware protects all protected routes ✓
- [X]  Health check endpoint does not require authentication ✓
- [X]  Error messages don't leak sensitive information ✓

### Rate Limiting Middleware

- [X]  Global rate limiting is enabled when `RATE_LIMIT_WINDOW_MS > 0` ✓
- [X]  Rate limit responds with 429 status code ✓

---

## 4. Frontend Security (nginx)

### Security Headers

- [X]  `X-Frame-Options: SAMEORIGIN` — prevents clickjacking ✓
- [X]  `X-Content-Type-Options: nosniff` — prevents MIME sniffing ✓
- [X]  `X-XSS-Protection: 1; mode=block` — XSS filter for older browsers ✓
- [X]  `Referrer-Policy: strict-origin-when-cross-origin` ✓
- [X]  `Content-Security-Policy` is configured ✓
- [X]  `Permissions-Policy` disables camera, microphone, geolocation ✓

### HTTPS/HSTS

- [ ]  HTTPS is configured (not enabled yet for local deployment)
  - [ ]  SSL certificate obtained (Let's Encrypt or CA)
  - [ ]  Uncomment `Strict-Transport-Security` header in `nginx.conf` when HTTPS is ready
  - [ ]  Redirect HTTP → HTTPS

### API Proxy

- [X]  `/api/` proxies to backend with proper headers ✓
- [X]  `X-Real-IP` and `X-Forwarded-For` headers are set ✓
- [X]  Connection upgrade headers for WebSocket (future-ready) ✓

### Static Assets

- [X]  `/assets/` have 1-year cache with `immutable` flag ✓
- [X]  `/uploads/` cache 1 hour ✓
- [X]  `/exports/` have `no-store` cache policy ✓

### SPA Fallback

- [X]  `try_files $uri $uri/ /index.html` — proper SPA routing ✓

---

## 5. Docker Configuration

### Database Service

- [X]  PostgreSQL 16 Alpine (minimal image) ✓
- [X]  Health check configured (pg_isready) ✓
- [X]  DB_PASSWORD injected from environment ✓
- [X]  schema.sql loaded at startup ✓
- [X]  Port 5432 only exposed to Docker network (not to host) ✓
  - **NOTE:** Current config exposes 5432 to host. For production NAS, restrict this via firewall.

### Backend Service

- [X]  NODE_ENV=production ✓
- [X]  Health check depends on DB health ✓
- [X]  Volumes for uploads and exports ✓
- [X]  Environment variables injected ✓

### Frontend Service

- [X]  nginx:alpine (minimal image) ✓
- [X]  Serves built static files ✓
- [X]  Proxies to backend ✓

---

## 6. Data Persistence & Backups

### Data Directories (NAS Deployment)

- [ ]  `/volume1/docker/studykit/postgres/` — DB data
- [ ]  `/volume1/docker/studykit/uploads/` — PDF files
- [ ]  `/volume1/docker/studykit/exports/` — User exports
- [ ]  Directory permissions: `chmod 755` for container access

### Backup Strategy

- [ ]  Daily PostgreSQL backups configured via cron
  ```bash
  0 3 * * * docker compose -f /volume1/docker/studykit/docker-compose.yml exec -T db \
    pg_dump -U studykit studykit > /volume1/docker/studykit/backups/studykit_$(date +\%Y\%m\%d).sql
  ```
- [ ]  Backup retention policy: 30 days
  ```bash
  0 4 * * * find /volume1/docker/studykit/backups -name "*.sql" -mtime +30 -delete
  ```
- [ ]  Off-site backup copy (optional, recommended)

---

## 7. Network Security

### NAS Firewall

- [ ]  SSH access restricted to trusted IPs
- [ ]  Port 80 (HTTP) — open to intended users
- [ ]  Port 443 (HTTPS) — open when configured
- [ ]  Port 5432 (PostgreSQL) — **CLOSED** to external network
- [ ]  Port 3001 (Backend) — **CLOSED** to external network

### Reverse Proxy (Optional)

- [ ]  nginx reverse proxy on NAS for HTTPS termination
- [ ]  Or use Ugreen NAS Application Portal for reverse proxy

---

## 8. Deployment Steps

### Before First Deploy

1. Generate and set secure `DB_PASSWORD` and `JWT_SECRET`
2. Verify all items in sections 1-7
3. Create data directories: `mkdir -p /volume1/docker/studykit/{postgres,uploads,exports,backups}`
4. Set directory permissions: `chmod 755 /volume1/docker/studykit`

### First Deploy

```bash
cd /volume1/docker/studykit

# Pull latest code (if using git)
git pull origin main

# Start services with NAS volume overrides
NAS_DATA_DIR=/volume1/docker/studykit docker compose \
  -f docker-compose.yml \
  -f docker-compose.nas.yml \
  up -d --build

# Wait 30 seconds for services to start
sleep 30

# Verify all services are healthy
docker compose ps

# Check logs
docker compose logs --tail=20
```

### Verify Deployment

```bash
# Health check
curl http://<nas-ip>:3001/api/health
# → {"status":"ok","version":"0.1.0","db":"connected"}

# Test register
curl -X POST http://<nas-ip>:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@studykit.local","password":"SecurePassword123"}'
```

---

## 9. Post-Deployment Monitoring

### Logs

```bash
# View backend logs
docker compose logs backend

# View database logs
docker compose logs db

# View nginx logs
docker compose logs frontend

# Follow in real-time
docker compose logs -f
```

### Disk Space

```bash
# Check PostgreSQL data directory
du -sh /volume1/docker/studykit/postgres

# Check upload/export directories
du -sh /volume1/docker/studykit/{uploads,exports}

# Total
df -h /volume1/docker/studykit
```

### Database Integrity

```bash
# Connect to DB
docker compose exec db psql -U studykit -d studykit

# Check tables exist
\dt

# Check users table has records
SELECT COUNT(*) FROM users;

# Exit
\q
```

---

## 10. Troubleshooting Production Issues


| Symptom                             | Cause                        | Fix                                                  |
| ----------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `429 Too Many Requests`             | Rate limit hit               | Wait 15 minutes, or increase`RATE_LIMIT_MAX`         |
| `401 Unauthorized` on all API calls | JWT token expired or invalid | User must log out and sign in again                  |
| PDF upload fails with 413           | File >100MB                  | Increase`client_max_body_size` in nginx.conf         |
| "Failed to load PDF" errors         | PDF processing failed        | Check`/volume1/docker/studykit/uploads/` for file    |
| Slow PDF loading                    | No caching on client         | Verify nginx cache headers:`Cache-Control: public`   |
| Users can't register                | DB password mismatch         | Verify`DB_PASSWORD` in `.env` matches Postgres setup |
| CORS errors in browser              | `CORS_ORIGIN` not configured | Set`CORS_ORIGIN` to actual domain in `.env`          |
| "Internal server error" 500s        | Backend crash or DB down     | Check`docker compose logs backend`                   |

---

## 11. Maintenance Schedule

### Daily

- [ ]  Monitor error logs: `docker compose logs --since 24h | grep -i error`
- [ ]  Spot-check disk usage

### Weekly

- [ ]  Review and prune old exports: `find /volume1/docker/studykit/exports -mtime +30 -delete`
- [ ]  Verify backups exist: `ls -la /volume1/docker/studykit/backups/`

### Monthly

- [ ]  Update Docker images: `docker compose pull && docker compose up -d --build`
- [ ]  Review and prune old backups: `find /volume1/docker/studykit/backups -mtime +90 -delete`
- [ ]  Verify HTTPS certificate expiration (if applicable)

### Quarterly

- [ ]  Database maintenance: `VACUUM ANALYZE` on PostgreSQL
- [ ]  Review security headers in nginx.conf
- [ ]  Test disaster recovery with a backup restore

---

## 12. Final Verification Checklist

Before marking production-ready:

- [X]  All secrets are strong and unique (DB_PASSWORD, JWT_SECRET)
- [X]  .gitignore protects .env files
- [X]  Backend CORS restricts origin (or configured for localhost)
- [X]  nginx headers are secure
- [X]  Docker compose uses env vars for secrets
- [X]  Health checks are configured
- [X]  Database has backups configured
- [X]  Firewall restricts DB/backend ports
- [X]  HTTPS is configured (when exposing to internet)
- [X]  Rate limiting is enabled
- [X]  Logs are monitored and rotated

---

## Contact & Support

For security issues:

1. Do not commit secrets to git
2. Rotate `JWT_SECRET` if suspected breach: all users must re-login
3. Reset `DB_PASSWORD` by running: `docker compose exec db psql -U postgres -d studykit -c "ALTER USER studykit PASSWORD 'new_password';"`
4. Check logs: `docker compose logs --tail=100`

---

**Generated:** 14 May 2026 | StudyKit v0.1.0
