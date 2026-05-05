# Socrate

Socrate is a Vite + React + TypeScript application for capturing conversations, segmenting them with Gemini, and exploring the results through semantic views, knowledge graphs, and threaded chat.

## Stack

- React 19
- TypeScript
- Vite
- Dexie / IndexedDB
- Gemini API

## Getting Started

Prerequisites:

- Node.js 20+

Install dependencies:

```bash
npm install
```

Create a local environment file and provide your Gemini key:

```bash
copy .env.example .env.local
```

Then set `GEMINI_API_KEY` in `.env.local`.

Start the development server:

```bash
npm run dev
```

Start the full local stack (Docker Neo4j+Chroma + replication server + Vite):

```bash
npm run dev:full
```

Run the TypeScript check:

```bash
npm run lint
```

Create a production build:

```bash
npm run build
```

## Notes

- Conversation data is stored locally in IndexedDB through Dexie.
- API keys can also be overridden from the app settings and are persisted in local storage.
- `.env*` files are ignored by git except for `.env.example`.
- Operational guide (single source of truth): `docs/OPERATIONS_RUNBOOK.md`

## Optional Local Infra (Neo4j + Chroma)

This project now includes a local Docker stack to prepare real replication targets.

1. Create env file:

```bash
copy .env.neo4j-chroma.example .env.neo4j-chroma
```

2. Start services:

```bash
docker compose --env-file .env.neo4j-chroma -f docker-compose.neo4j-chroma.yml up -d
```

3. Check endpoints:

- Neo4j Browser: `http://127.0.0.1:7474`
- Chroma: `http://127.0.0.1:8000`

4. Stop services:

```bash
docker compose -f docker-compose.neo4j-chroma.yml down
```

## Replication Server (real Neo4j + Chroma writes)

When Docker services are up, run:

```bash
npm run replication:server
```

By default it listens on `http://127.0.0.1:3213` and exposes:

- `GET /health`
- `POST /replicate`

`/health` now checks both Neo4j and Chroma connectivity and returns `503` if one dependency is down.

In Socrate settings, keep replication endpoint set to:

`http://127.0.0.1:3213/replicate`
