# SceneFork

[中文](./README.zh-CN.md)

SceneFork is an open-source AI interactive storytelling workspace that turns an idea into versioned story turns, generated videos, and branching continuations.

## Features

- Qwen story generation with four fixed choices and custom continuation
- Wan video generation with server-side polling, persistence, and restart recovery
- Branches with shared ancestors and branch-scoped story paths
- Immutable story/prompt versions, selectable video versions, and stale markers
- Dynamic Recent Drafts numbering for projects with valid real videos
- FFmpeg first-frame covers shared by Recent Drafts and STORY PATH
- Independent Mock/Real modes for Qwen and Wan

The real Qwen and Wan API workflow has been manually verified. Mock remains the safe default to prevent accidental paid requests.

## Quick start

Requirements: Node.js 20+ and npm 10+.

```bash
npm install
```

Copy `.env.example` to `.env`, then start the API and frontend:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. The API listens on `http://127.0.0.1:3000`.

## Provider configuration

The default configuration uses free Mock providers:

```dotenv
SCENEFORK_PROVIDER_MODE=mock
QWEN_API_KEY=
WAN_API_KEY=
```

To use the verified Alibaba Cloud workflow, update `.env` and restart the server:

```dotenv
SCENEFORK_PROVIDER_MODE=real
QWEN_API_KEY=your-qwen-key
WAN_API_KEY=your-wan-key
QWEN_BASE_URL=your-compatible-mode-endpoint
WAN_BASE_URL=your-video-api-endpoint
QWEN_MODEL=qwen3.7-flash
WAN_MODEL=wan2.6-t2v
WAN_VIDEO_SIZE=1920*1080
WAN_VIDEO_DURATION=5
```

The endpoints and keys must use the same Alibaba Cloud region/workspace. `DASHSCOPE_API_KEY` is supported as a shared fallback, while model-specific keys take precedence. `QWEN_PROVIDER_MODE` and `WAN_PROVIDER_MODE` can override the global mode independently.

Temporary keys entered in Settings are kept only in backend process memory. Keys are never stored in SQLite or browser storage and must not be placed in a `VITE_*` variable.

Install FFmpeg or set `FFMPEG_PATH` to generate and backfill video first-frame covers:

```dotenv
FFMPEG_PATH=ffmpeg
FFMPEG_TIMEOUT_MS=15000
```

## Usage

1. Enter an idea on the homepage to generate the opening story turn.
2. Review or edit its video prompt, then generate the video.
3. Choose one of four directions or enter a custom continuation.
4. Select a historical turn and choose a different direction to create a branch without overwriting the original path.
5. Use the Version panel to switch versions or explicitly regenerate the current story or video.
6. Open, rename, or delete non-Main branches in the Branch Drawer.
7. Reopen a Draft by clicking its card, or delete it from the card's three-dot menu.

Recent Drafts only shows projects with a successful Real-provider video whose local media file still exists. Mock-only, empty, failed, and missing-media projects are excluded. Visible Draft numbers are recalculated after deletion.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

SQLite data is stored under `data/` and generated media under `media/`; both are ignored by Git. Real video generation may incur charges. A submission timeout becomes `submission_unknown` and is not retried automatically, preventing duplicate paid requests.

## Showcase

### Generated video

<img width="1906" height="904" alt="20260930144512_rec_" src="https://github.com/user-attachments/assets/7d4d2c59-e2df-412f-a7a2-cc3fba3279dc" />

### Homepage

<img width="1904" height="929" alt="img_v3_02161_6e721cf2-d0ef-44ff-b957-d585645be61g" src="https://github.com/user-attachments/assets/cbe45549-9b75-49c9-94d4-417efe4b21d0" />
