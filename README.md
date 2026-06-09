# Personal Report

Personal Report is a private ACG, technology, and local-life briefing dashboard. It crawls RSS feeds, Bangumi schedules, Bilibili events, and optional search results, then uses an OpenAI-compatible model to generate daily and weekly reports with editorial judgement.

## Features

- Daily report: game highlights, technology highlights, local event changes, anime airing today, and optional meal suggestions.
- Weekly report: selected weekly recap, upcoming event list, weekly anime calendar, and weekend shop suggestions.
- Feedback loop: mark items as favorite, not interested, or "more like this"; future reports include a compact feedback summary.
- NAS-friendly dashboard: static Vite UI served by a small Node HTTP server.
- Protected mutation APIs: crawl, feedback, and self-update require `ADMIN_TOKEN`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local config:

```bash
cp config.json.example config.json
```

3. Create `.env`:

```env
OPENAI_API_KEY=your_openai_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# Optional: cheaper/faster model for RSS deep-search candidate selection.
OPENAI_SECONDARY_API_KEY=
OPENAI_SECONDARY_BASE_URL=
OPENAI_SECONDARY_MODEL=

# Optional search provider. Falls back to Baidu scraping when omitted.
TAVILY_API_KEY=

# Required for dashboard mutation APIs.
ADMIN_TOKEN=replace-with-a-long-random-token
VITE_ADMIN_TOKEN=replace-with-the-same-token-for-private-LAN-use

# Keep disabled unless this is a trusted private NAS/LAN deployment.
ENABLE_SELF_UPDATE=false
```

## Development

```bash
npm run dev
npm run build
npm run lint
npm run crawl
npm run crawl:weekly
```

Generated report databases live under `src/data/*.json` and are intentionally ignored by Git.

## Docker / NAS Deployment

```bash
docker compose up -d --build
```

The container serves the dashboard on port `8080`. Mount these local files/directories:

- `config.json` for location, source, and preference settings.
- `.env` for keys and private deployment controls.
- `src/data` for persistent report and feedback JSON files.

Mutation APIs are disabled unless `ADMIN_TOKEN` is configured:

- `POST /api/crawl`
- `POST /api/feedback`
- `POST /api/update`

Self-update also requires `ENABLE_SELF_UPDATE=true`. The update flow is conservative: it only runs on a clean `main` branch, fetches `origin/main`, requires a fast-forward update, then runs `npm ci` and `npm run build`.

## Report Quality Notes

The LLM prompts are designed to avoid module-by-module repetition. The daily summary should read like "today's editorial judgement": 3-5 concise observations about what actually matters, while detailed anime, meal, event, and shop information remains in their own sections.
