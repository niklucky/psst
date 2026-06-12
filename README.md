# silo

A platform for managing secrets, organisations, and vaults. End-to-end encrypted — secrets are encrypted client-side before reaching the server.

**Stack:** Hono + tRPC (server) · React + Vite (web) · Drizzle ORM · PostgreSQL · MinIO · Turborepo + pnpm workspaces

---

## Setup

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/) 11+

### 1. Start backing services

```bash
docker compose up -d
```

This starts:

| Service | URL | Notes |
|---------|-----|-------|
| PostgreSQL | `localhost:5432` | database `silo`, user `postgres`, password `dev` |
| MinIO S3 API | `localhost:9000` | access key `minioadmin` / `minioadmin` |
| MinIO console | `localhost:9001` | web UI for browsing buckets |

The `createbuckets` init container creates the `silo-files` bucket automatically.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
# edit .env — set DATABASE_URL, MINIO credentials, session secret, etc.
```

### 4. Run in development

```bash
pnpm dev
```

This runs all apps and packages in watch mode via Turborepo.

| App | URL |
|-----|-----|
| Web | `http://localhost:5173` |
| API server | `http://localhost:3001` |

---

## Docker Compose

The `docker-compose.yml` below is the one included in this repo. It covers local development dependencies only (database + object storage). The application itself runs outside Docker during development.

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: silo
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # web console
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 5s
      retries: 5

  createbuckets:
    image: minio/mc
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/silo-files &&
      echo 'Bucket silo-files ready.'
      "

volumes:
  postgres_data:
  minio_data:
```

---

## Nginx config

The web app is a Vite SPA. When serving it via nginx (e.g. in production), all unknown paths must fall back to `index.html` so the client-side router handles them.

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml+rss text/javascript;
}
```

In production the server Docker image (`server/Dockerfile`) serves the built web assets directly via Hono's `serveStatic`, so a separate nginx container is not required unless you want to terminate TLS or sit a reverse proxy in front.

---

## Project structure

```
apps/
  web/          React + Vite SPA
  desktop/      Tauri desktop app (shares web UI)
  mobile/       Expo React Native
  extension/    Browser extension (WXT)
  cli/          Node CLI (tsup)
packages/
  crypto/       End-to-end encryption primitives (@silo/crypto)
  db/           Drizzle schema + client (@silo/db)
  api/          tRPC router types (@silo/api)
  ui/           Shared React components (@silo/ui)
  shared/       Shared utilities (@silo/shared)
  config/       Shared tsconfig / eslint / prettier
server/         Hono + tRPC API server
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run all apps in watch mode |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run all unit tests |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check all packages |
