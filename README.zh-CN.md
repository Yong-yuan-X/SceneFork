# SceneFork

[English](./README.md)

SceneFork 是一个开源的 AI 互动叙事工作台，可将一句创意展开为持久化故事片段、生成视频与可选择的续写方向。

## 当前状态

P1 链路已使用 Vue 3、Fastify、SQLite、Drizzle 和共享 Zod Schema 实现，包含：

- 多草稿首页与稳定的 draft1、draft2……编号；
- 共享祖先但互不覆盖的真实剧情分支，Qwen 只读取当前分支路径；
- 不可变剧情/Prompt 版本、可切换视频历史及分支级 stale 标记；
- 保留 P0 任务 ID、媒体路径和版本号的显式版本化迁移；
- Qwen 兼容的结构化故事生成与运行时校验；
- Wan 异步提交、服务端轮询、媒体下载和服务重启恢复；
- 仅保存在后端当前进程内的 Qwen/Wan 临时 Key 覆盖与脱敏状态；
- Qwen/Wan 独立 Mock/Real 判定，缺少对应 Key 时自动使用 Mock；
- FFmpeg 视频首帧草稿封面及不影响视频成功状态的占位降级。

默认配置不会调用任何付费 API。真实 Qwen/Wan 接入代码已经实现，但本仓库尚未执行真实付费联调。

## 项目展示

### 生成视频

> 视频展示预留位置——后续在此放入最终生成视频或预览。

### 首页

> 首页展示预留位置——后续在此放入最终首页截图。

## 环境要求

- Node.js 20 或更新版本
- npm 10 或更新版本

## 安装与启动

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`，API 地址为 `http://127.0.0.1:3000`。

生产构建验证：

```bash
npm run typecheck
npm test
npm run build
```

## 安全 Mock 流程

1. 在首页输入故事创意。
2. 查看或编辑生成片段的视频提示词。
3. 点击“生成 Mock 视频”，观察数据库中的任务状态依次变化。
4. 选择四个方向之一，或输入自定义续写方向。
5. 返回历史镜头选择另一方向，验证原路线保留并生成新分支。
6. 在任务进行中刷新页面，可验证恢复同一条 SQLite 任务。

Mock Provider 使用与真实模式相同的 API、数据库、后台 worker 和幂等链路，但不会请求阿里云。浏览器存储仅保存当前故事 ID 与 UI 状态。

## 环境变量

将 `.env.example` 复制为 `.env`。安全默认值为：

```dotenv
SCENEFORK_PROVIDER_MODE=mock
DASHSCOPE_API_KEY=
QWEN_API_KEY=
WAN_API_KEY=
```

如需主动启用阿里云真实服务，请设置 `SCENEFORK_PROVIDER_MODE=real`，并配置模型独立的 `QWEN_API_KEY` / `WAN_API_KEY`，或兼容的共享 `DASHSCOPE_API_KEY`，以及对应地域的 `QWEN_BASE_URL` 与 `WAN_BASE_URL`。模型独立 Key 优先。设置弹窗只覆盖后端当前进程内存，不写入 `.env`、SQLite 或浏览器存储。

Wan 默认使用 `1280*720`、5 秒规格。真实模式的视频生成会产生费用；提交超时会持久化为 `submission_unknown`，绝不会自动重试。
Qwen 与 Wan 使用相互独立的请求超时配置；`QWEN_REQUEST_TIMEOUT_MS` 和 `PROVIDER_REQUEST_TIMEOUT_MS` 均默认 120 秒。Wan 提交超时后仍会进入受保护的 `submission_unknown` 状态，不会自动重试付费请求。

安装 FFmpeg 或通过 `FFMPEG_PATH` 指定程序路径可启用真实视频首帧封面。后端启动时也会从已有本地视频补提缺失封面，不会再次调用 Wan。FFmpeg 缺失、失败或超时只会使用明显不同的占位封面，不会把已成功保存的视频任务改成失败。

## API

- `POST /api/stories`
- `GET /api/stories`
- `GET /api/stories/:storyId`
- `/api/stories/:storyId/branches...`
- `PATCH /api/stories/:storyId/turns/:turnId`
- `/api/stories/:storyId/turns/:turnId/versions...`
- `POST|GET /api/stories/:storyId/turns/:turnId/video`
- `POST /api/stories/:storyId/turns/:turnId/choose`
- `GET|PUT /api/settings/keys`（仅允许本机 UI 来源并要求 `X-SceneFork-Settings` 请求头）

生成的数据库和媒体文件均被 Git 忽略。真实 Provider 验证必须由开发者主动启用，并可能产生费用。
