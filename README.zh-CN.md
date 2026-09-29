# SceneFork

[English](./README.md)

SceneFork 是一个开源的 AI 互动叙事工作台，可将一句创意展开为持久化故事片段、生成视频与可选择的续写方向。

## 当前状态

阶段 B 的 P0 链路已使用 Vue 3、Fastify、SQLite、Drizzle 和共享 Zod Schema 实现，包含：

- 故事、片段、选项、选择记录、视频任务与本地媒体持久化；
- Qwen 兼容的结构化故事生成与运行时校验；
- Wan 异步提交、服务端轮询、媒体下载和服务重启恢复；
- 每个故事片段独立关联视频任务；
- 数据库级重复视频提交幂等保护；
- 固定选项与自定义方向共用同一续写链路；
- 未明确启用真实模式时使用安全的服务端 Mock Provider。

默认配置不会调用任何付费 API。真实 Qwen/Wan 接入代码已经实现，但本仓库尚未执行真实付费联调。

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

1. 在右侧输入框写下故事创意。
2. 查看或编辑生成片段的视频提示词。
3. 点击“生成 Mock 视频”，观察数据库中的任务状态依次变化。
4. 选择四个方向之一，或输入自定义续写方向。
5. 打开设置，可让下一次任务演示成功、失败或提交结果未知。
6. 在任务进行中刷新页面，可验证恢复同一条 SQLite 任务。

Mock Provider 使用与真实模式相同的 API、数据库、后台 worker 和幂等链路，但不会请求阿里云。浏览器存储仅保存当前故事 ID 与 UI 状态。

## 环境变量

将 `.env.example` 复制为 `.env`。安全默认值为：

```dotenv
SCENEFORK_PROVIDER_MODE=mock
DASHSCOPE_API_KEY=
```

如需主动启用阿里云真实服务，请设置 `SCENEFORK_PROVIDER_MODE=real`，并配置 `DASHSCOPE_API_KEY`、`QWEN_BASE_URL` 与 `WAN_BASE_URL`；三者必须属于同一地域和业务空间。API Key 仅由服务端根目录 `config.ts` 读取，严禁放入任何 `VITE_*` 变量。

Wan 默认使用 `1280*720`、5 秒规格。真实模式的视频生成会产生费用；提交超时会持久化为 `submission_unknown`，绝不会自动重试。
Qwen 与 Wan 使用相互独立的请求超时配置；`QWEN_REQUEST_TIMEOUT_MS` 和 `PROVIDER_REQUEST_TIMEOUT_MS` 均默认 120 秒。Wan 提交超时后仍会进入受保护的 `submission_unknown` 状态，不会自动重试付费请求。

## API

- `POST /api/stories`
- `GET /api/stories/:storyId`
- `PATCH /api/stories/:storyId/turns/:turnId`
- `POST|GET /api/stories/:storyId/turns/:turnId/video`
- `POST /api/stories/:storyId/turns/:turnId/choose`

生成的数据库和媒体文件均被 Git 忽略。真实 Provider 验证必须由开发者主动启用，并可能产生费用。
