# SceneFork

[中文](./README.zh-CN.md)

SceneFork is an open-source AI interactive storytelling workspace that turns an idea into persisted story turns, generated videos, and selectable continuation directions.

## Current status

The Phase B P0 workflow is implemented with Vue 3, Fastify, SQLite, Drizzle, and shared Zod schemas. It includes:

- persisted stories, turns, choices, selections, video tasks, and local media;
- Qwen-compatible structured story generation with runtime validation;
- asynchronous Wan submission, server-side polling, media download, and restart recovery;
- one independently tracked video task per story turn;
- database-backed idempotency for duplicate video submissions;
- one continuation path shared by preset choices and custom directions;
- a safe server-side Mock provider used whenever real mode is not explicitly enabled.

The default configuration never calls a paid API. Real Qwen/Wan integration is implemented but has not been live-verified in this repository.

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

1. Enter a story idea in the right-hand composer.
2. Review or edit the generated segment's video prompt.
3. Select **Generate mock video** and watch the persisted task states advance.
4. Choose one of the four directions, or enter a custom continuation.
5. Open the settings button to make the next task succeed, fail, or return an unknown submission result.
6. Refresh while a task is active to verify that the same SQLite task is restored.

The Mock provider uses the real API, database, worker, and idempotency path but does not contact Alibaba Cloud. Browser storage only keeps the active story ID and UI state.

## Environment

Copy `.env.example` to `.env`. The safe defaults are:

```dotenv
SCENEFORK_PROVIDER_MODE=mock
DASHSCOPE_API_KEY=
```

To intentionally use Alibaba Cloud, set `SCENEFORK_PROVIDER_MODE=real`, provide `DASHSCOPE_API_KEY`, `QWEN_BASE_URL`, and `WAN_BASE_URL`, and ensure all three belong to the same region and workspace. The API key is read only by the server-side root `config.ts`; never place it in a `VITE_*` variable.

Wan defaults to `1280*720` and 5 seconds. Video generation is billable in real mode. A submission timeout is stored as `submission_unknown` and is never retried automatically.
Qwen and Wan use independently configurable request timeouts. `QWEN_REQUEST_TIMEOUT_MS` and `PROVIDER_REQUEST_TIMEOUT_MS` both default to 120 seconds; Wan submission timeouts still enter the protected `submission_unknown` flow instead of being retried automatically.

## API

- `POST /api/stories`
- `GET /api/stories/:storyId`
- `PATCH /api/stories/:storyId/turns/:turnId`
- `POST|GET /api/stories/:storyId/turns/:turnId/video`
- `POST /api/stories/:storyId/turns/:turnId/choose`

Generated databases and media files are ignored by Git. Real provider verification must be deliberately enabled and may incur charges.
