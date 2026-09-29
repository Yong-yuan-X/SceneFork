# SceneFork

[中文](./README.zh-CN.md)

SceneFork is an open-source AI interactive storytelling workspace that turns an idea into video-ready story segments with branching directions.

## Current status

Phase A is available as a local Vue 3 mock experience. It includes:

- idea input and mock story generation;
- an editable video prompt for the current segment;
- explicit submitting, queued, running, saving, success, failure, and unknown states;
- manual retry and duplicate-submit protection;
- four preset directions plus custom continuation text;
- local task persistence and refresh recovery;
- a clearly labelled mock player and disabled export placeholder.

No Qwen or Wan request is made in this phase. Real model APIs, persistent server storage, and media download are Phase B work.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Production verification:

```bash
npm run typecheck
npm run build
```

## Try the mock flow

1. Enter a story idea in the right-hand composer.
2. Review or edit the generated segment's video prompt.
3. Select **Generate mock video** and watch the task states advance.
4. Choose one of the four directions, or enter a custom continuation.
5. Open the settings button to make the next task succeed, fail, or return an unknown submission result.
6. Refresh while a task is active to verify that the same local task is restored.

Mock state is stored in browser `localStorage`. Use **Clear local demo** in settings, or click the SceneFork wordmark, to start over.

## Environment

Copy `.env.example` to `.env` only when configuration is needed. Phase A uses no secret values. Variables such as `DASHSCOPE_API_KEY` are reserved for the future server and must never be exposed through `VITE_*` or committed.

Model API calls may incur charges once Phase B is implemented. This repository currently performs no paid requests.
