# StudyKit Production Setup Guide

**Last Updated:** 14 May 2026 | Version 0.1.0

> For administrators deploying StudyKit to production on Ugreen NAS with non-trusted users.

---

## 🚀 Quick Start (5 minutes)

### Step 1: Generate Secure Credentials ✅ DONE

Credentials have already been generated:
- DB_PASSWORD: `+PQslJlF/6Nw3j2JErwZftxBKBmLUx5VJ/yaIOItAkA=` (44 chars)
- JWT_SECRET: `GIYpK80TMZF8m/3liD4qGk0mhpeqypszrkt3zn0h2jLjnCvf2RihFTr9RqsX7J26` (64 chars)

⚠️ **CRITICAL:** Save these to a password manager. If you lose them:
- DB_PASSWORD: Reset in Docker container
- JWT_SECRET: All users must re-login

### Step 2: Configure NAS Deployment

Edit `.env` if needed:

```env
# Required for NAS deployment
NAS_DATA_DIR=/volume1/docker/studykit

# If exposing to internet, set CORS origin:
CORS_ORIGIN=http://192.168.1.100  # or your domain
```

### Step 3: Deploy to NAS

**Option A: Automated Script**

```bash
./deploy.sh --nas-ip 192.168.1.100
```

**Option B: Manual Deployment**

```bash
# On NAS:
ssh admin@192.168.1.100
mkdir -p /volume1/docker/studykit/{postgres,uploads,exports,backups}

# From laptop:
scp -r studykit/* admin@192.168.1.100:/volume1/docker/studykit/

# Back on NAS:
cd /volume1/docker/studykit
NAS_DATA_DIR=/volume1/docker/studykit docker compose \
  -f docker-compose.yml \
  -f docker-compose.nas.yml \
  up -d --build

sleep 30
docker compose ps
```

**Access StudyKit at:** `http://<nas-ip>`

---

## 🔐 Security Configuration

### CORS Restriction

In `.env`:
```env
# For local network:
CORS_ORIGIN=http://192.168.1.100

# For domain:
CORS_ORIGIN=https://studykit.yourdomain.com
```

Then restart: `docker compose restart backend`

### Firewall Rules (NAS Web UI)

- ✅ Allow port **80** (HTTP)
- ✅ Allow port **443** (HTTPS, when ready)
- ❌ **BLOCK port 5432** (PostgreSQL)
- ❌ **BLOCK port 3001** (Backend)

### HTTPS Setup

Use NAS Application Portal → Reverse Proxy to configure SSL certificate.

---

## 📊 Monitoring & Maintenance

### View Logs

```bash
cd /volume1/docker/studykit

# All services
docker compose logs -f

# Backend only
docker compose logs -f backend
```

### Database Backups

**Manual backup:**
```bash
docker compose exec -T db pg_dump -U studykit studykit > backup_$(date +%Y%m%d).sql
```

**Automatic daily backup (add to crontab):**
```
0 3 * * * cd /volume1/docker/studykit && docker compose exec -T db pg_dump -U studykit studykit > backups/studykit_$(date +\%Y\%m\%d).sql
```

---

## ⚠️ Common Issues

| Problem | Solution |
|---------|----------|
| White blank page | Check: `docker compose logs frontend` |
| Failed to connect | Check: `docker compose logs backend` |
| Rate limit (429) | Wait 15 min or increase RATE_LIMIT_MAX |
| CORS error | Set CORS_ORIGIN in .env |
| Can't SSH to NAS | Enable SSH in NAS Settings → User |

---

## 📚 Full Documentation

- [README_PRODUCTION.md](README_PRODUCTION.md) — Overview
- [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) — Security verification
- [DEPLOYMENT.md](DEPLOYMENT.md) — Architecture details

---

**Ready?** Start deployment with one of the methods above! 🚀
