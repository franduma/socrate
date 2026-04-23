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
