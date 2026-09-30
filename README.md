# SceneFork

[中文](./README.zh-CN.md)

SceneFork is an open-source AI interactive storytelling workspace that turns an idea into persisted story turns, generated videos, and selectable continuation directions.

## Current status

The P1 workflow is implemented with Vue 3, Fastify, SQLite, Drizzle, and shared Zod schemas. It includes:

- a persisted multi-draft homepage with stable `draft1`, `draft2`, … numbering;
- true story branches with shared ancestors and branch-only Qwen context;
- immutable story/prompt versions, selectable video history, and branch-scoped stale markers;
- a versioned P0-to-P1 migration that preserves existing task IDs and media paths;
- Qwen-compatible structured story generation with runtime validation;
- asynchronous Wan submission, server-side polling, media download, and restart recovery;
- process-only Qwen/Wan key overrides with redacted status responses;
- independent Mock/Real selection for Qwen and Wan, with Mock fallback when a key is missing;
- FFmpeg first-frame draft covers with a non-failing placeholder fallback.

The default configuration never calls a paid API. Real Qwen/Wan integration is implemented but has not been live-verified in this repository.

## Showcase

### Generated video

> Video demo placeholder — add the final generated-video clip or preview here.

### Homepage

> Homepage showcase placeholder — add the final homepage screenshot here.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Install and run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The API runs at `http://127.0.0.1:3000`.

Production verification:

```bash
npm run typecheck
npm test
npm run build
```

## Safe Mock flow

1. Enter a story idea on the homepage.
2. Review or edit the generated segment's video prompt.
3. Select **Generate mock video** and watch the persisted task states advance.
4. Choose one of the four directions, or enter a custom continuation.
5. Return to a historical turn and choose another direction to create a preserved fork.
6. Refresh while a task is active to verify that the same SQLite task is restored.

The Mock provider uses the real API, database, worker, and idempotency path but does not contact Alibaba Cloud. Browser storage only keeps the active story ID and UI state.

## Environment

Copy `.env.example` to `.env`. The safe defaults are:

```dotenv
SCENEFORK_PROVIDER_MODE=mock
DASHSCOPE_API_KEY=
QWEN_API_KEY=
WAN_API_KEY=
```

To intentionally use Alibaba Cloud, set `SCENEFORK_PROVIDER_MODE=real`, provide model-specific `QWEN_API_KEY` / `WAN_API_KEY` or the legacy shared `DASHSCOPE_API_KEY`, and configure `QWEN_BASE_URL` and `WAN_BASE_URL`. Model-specific keys take precedence. The settings dialog applies process-memory overrides only and never writes `.env`, SQLite, or browser storage.

Wan defaults to `1280*720` and 5 seconds. Video generation is billable in real mode. A submission timeout is stored as `submission_unknown` and is never retried automatically.
Qwen and Wan use independently configurable request timeouts. `QWEN_REQUEST_TIMEOUT_MS` and `PROVIDER_REQUEST_TIMEOUT_MS` both default to 120 seconds; Wan submission timeouts still enter the protected `submission_unknown` flow instead of being retried automatically.

Install FFmpeg or set `FFMPEG_PATH` to enable real first-frame draft covers. On startup, the backend also backfills missing covers from existing local videos without calling Wan again. Missing, failed, or timed-out FFmpeg execution falls back to a visibly distinct placeholder and never changes a successful video task to failed.

## API

- `POST /api/stories`
- `GET /api/stories`
- `GET /api/stories/:storyId`
- `/api/stories/:storyId/branches...`
- `PATCH /api/stories/:storyId/turns/:turnId`
- `/api/stories/:storyId/turns/:turnId/versions...`
- `POST|GET /api/stories/:storyId/turns/:turnId/video`
- `POST /api/stories/:storyId/turns/:turnId/choose`
- `GET|PUT /api/settings/keys` (local UI origin plus `X-SceneFork-Settings` barrier)

Generated databases and media files are ignored by Git. Real provider verification must be deliberately enabled and may incur charges.
