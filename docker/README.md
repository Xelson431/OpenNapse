# Self-Hosting with Docker

## Quick Start

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080).

The app runs in **local-only mode** by default — all data stays in the user's browser (IndexedDB). No backend required.

## Enabling Cloud Features

To enable authentication, teams, and the AI gateway, you need a Supabase project:

```bash
# Create a .env file at the repo root
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Then rebuild:

```bash
docker compose up --build
```

The Supabase URL and anon key are baked into the static bundle at build time. They are safe to expose (anon key is public by design in Supabase).

## Architecture

```
┌─────────────────────────────────────────┐
│  nginx (port 80)                        │
│  Serves static SPA + handles routing    │
│  /assets/ cached with immutable headers │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Browser (user's device)                │
│  IndexedDB for local storage            │
│  Optional: talks to Supabase for cloud  │
└─────────────────────────────────────────┘
```

## Production Considerations

- **HTTPS**: Put a reverse proxy (Caddy, Traefik, or Cloudflare Tunnel) in front for TLS. Required for service worker + IndexedDB.
- **Supabase self-host**: If you don't want to use Supabase Cloud, you can run the [Supabase Docker stack](https://supabase.com/docs/guides/self-hosting/docker) alongside this container.
- **Backups**: Local-only data lives in the user's browser. Cloud data lives in Supabase Postgres — configure pg_dump or Supabase's built-in backups.
