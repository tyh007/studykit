# StudyKit

A lecture-first academic workspace prototype connecting PDF slides, structured notes, annotations and literature review.

This repository contains a React/TypeScript frontend, an Express API and a PostgreSQL schema. It is a working development prototype, with implemented lecture and literature workflows; the broader roadmap is not a list of completed features.

## Implemented areas

- Module and lecture organisation, PDF source upload and slide viewing.
- Rich-text notes, Cornell cues, equations, images and annotations.
- Browser storage with Dexie and a server sync API.
- Literature projects, paper workspaces, custom extraction fields, notes, relationships, reading lists and citation views.
- AI-provider profiles, model discovery and extraction routes; external provider access and credentials are required.
- Zotero connection/import routes and export endpoints. Their availability depends on the configured local or remote services.

These are source-level capabilities, not a claim that every workflow or deployment has passed end-to-end acceptance.

## Architecture

```text
frontend/     React 19, Vite, TypeScript, TipTap, PDF.js, Dexie, Zustand
backend/      Express, PostgreSQL, JWT authentication, upload and AI routes
backend/schema.sql   Database schema for a fresh development database
```

The browser calls `/api`; Vite proxies requests to port 3001 during local development. PostgreSQL and uploaded/exported files are separate persistence layers.

## Local setup

Prerequisites: Node.js 22 LTS, npm, and PostgreSQL 16 (or Docker Compose).

### Option A: Docker Compose

```bash
cp .env.example .env
# Set unique DB_PASSWORD and JWT_SECRET values in .env.
# Set AI_CREDENTIAL_ENCRYPTION_KEY if saving provider credentials.
docker compose up --build
```

Open `http://localhost:8080`. This starts the frontend, backend and a database. The database schema is initialised only on the first use of an empty database volume. Do not delete volumes or rerun schema initialisation against an existing database as a cleanup step.

### Option B: local processes

Create a development database/user, then initialise that fresh database:

```bash
psql -h localhost -U studykit -d studykit -f backend/schema.sql
npm --prefix backend ci
npm --prefix frontend ci
```

In one terminal, set the backend environment and run:

```bash
export DB_HOST=localhost DB_PORT=5432 DB_NAME=studykit DB_USER=studykit
export DB_PASSWORD='your-local-database-password'
export JWT_SECRET='a-unique-long-random-secret'
# Required only when saving AI provider credentials; use your own generated key.
# export AI_CREDENTIAL_ENCRYPTION_KEY='your-generated-key'
npm --prefix backend run dev
```

In a second terminal:

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173`. The backend reads exported process variables; it does not automatically load the root `.env` file. Root `.env` is consumed by Docker Compose. If using only the Compose database service, its host port is **5433**, so set `DB_PORT=5433` for the local backend.

## Checks

```bash
npm --prefix backend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

The existing backend tests cover AI-provider adapters, credential encryption and selected URL validation. They do not constitute a full database, synchronisation, authentication or browser test suite. Frontend build output currently includes a large-bundle warning.

## Product documents and deployment notes

- `studykit_stage_one_prd_v0.2.0.md`: Stage One specification.
- `studykit_full_product_introduction_cn.md`: product vision and staged roadmap; later-stage functionality must not be inferred to be implemented.
- `studykit_post_stage_one_llm_coding_prd_guide.md`: development planning guide.
- The deployment guides and Compose variants are historical/operator references. Inspect their assumptions before use; this cleanup does not certify production deployment.

## Boundaries and known gaps

This is an academic/product prototype. It is not a finished institutional learning platform. Plugin SDKs, comprehensive revision/flashcard workflows, institutional integrations and real-time collaboration are roadmap items unless separately implemented and verified.

Authentication uses browser-held tokens. Uploaded files and exports are served through static paths; authentication on API routes alone does not make those file URLs private. Do not use confidential lecture or participant material on a public deployment without reviewing file access, retention, backup and user isolation. Cloud AI sends selected content to the configured provider; local AI availability depends on the user's local service and network setup.

No reuse license or collaborator role has been inferred by this documentation. Source and original product documents are retained; generated build caches are excluded.
