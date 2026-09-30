# SceneFork

[English](./README.md)

SceneFork 是一个开源的 AI 互动叙事工作台，可将一句创意展开为带版本、视频和分支的连续故事。

## 功能

- Qwen 结构化剧情生成，支持四个固定方向和自定义续写
- Wan 视频生成、服务端轮询、持久化和重启恢复
- 保留共享祖先、按分支展示的真实剧情树
- 不可变剧情/Prompt 版本、可切换视频版本和 stale 标记
- 仅展示有效真实视频项目并动态编号的 Recent Drafts
- Recent Drafts 与 STORY PATH 共用 FFmpeg 视频首帧封面
- Qwen/Wan 可分别使用 Mock 或 Real 模式

真实 Qwen 与 Wan API 链路已经过人工验证。项目仍默认使用安全的 Mock 模式，避免误触发付费请求。

## 快速开始

环境要求：Node.js 20+、npm 10+。

```bash
npm install
```

将 `.env.example` 复制为 `.env`，然后同时启动 API 与前端：

```bash
npm run dev
```

打开 `http://127.0.0.1:5173`，API 地址为 `http://127.0.0.1:3000`。

## Provider 配置

默认配置使用免费的 Mock Provider：

```dotenv
SCENEFORK_PROVIDER_MODE=mock
QWEN_API_KEY=
WAN_API_KEY=
```

使用已经验证的阿里云真实链路时，修改 `.env` 后重启服务：

```dotenv
SCENEFORK_PROVIDER_MODE=real
QWEN_API_KEY=你的-Qwen-Key
WAN_API_KEY=你的-Wan-Key
QWEN_BASE_URL=对应地域的兼容模式地址
WAN_BASE_URL=对应地域的视频-API-地址
QWEN_MODEL=qwen3.7-flash
WAN_MODEL=wan2.6-t2v
WAN_VIDEO_SIZE=1920*1080
WAN_VIDEO_DURATION=5
```

API 地址与 Key 必须属于同一个阿里云地域/工作空间。也可以使用共享的 `DASHSCOPE_API_KEY`，但模型独立 Key 优先。`QWEN_PROVIDER_MODE` 和 `WAN_PROVIDER_MODE` 可分别覆盖全局模式。

设置弹窗中的临时 Key 仅保存在后端当前进程内，不写入 SQLite 或浏览器存储。Key 不得放入任何 `VITE_*` 变量。

安装 FFmpeg 或用 `FFMPEG_PATH` 指定可执行文件，可生成并自动补齐视频首帧封面：

```dotenv
FFMPEG_PATH=ffmpeg
FFMPEG_TIMEOUT_MS=15000
```

## 使用方法

1. 在首页输入创意，生成第一个剧情片段。
2. 查看或编辑视频提示词，然后生成视频。
3. 从四个固定方向中选择一个，或输入自定义续写。
4. 回到历史片段选择不同方向，可创建新分支且不覆盖原路线。
5. 在 Version 面板中切换版本，或明确重新生成当前剧情或视频。
6. 在 Branch Drawer 中切换、重命名或删除非 Main 分支。
7. 点击 Draft 卡片可重新进入，三点菜单可删除 Draft。

Recent Drafts 只展示成功生成真实视频且本地媒体文件仍存在的项目。Mock-only、空项目、失败任务和媒体丢失项目不会显示；删除 Draft 后，首页编号会自动连续重排。

## 检查与构建

```bash
npm run typecheck
npm test
npm run build
```

SQLite 数据保存在 `data/`，生成媒体保存在 `media/`，两者都不会提交到 Git。真实视频生成可能产生费用；提交超时会进入 `submission_unknown`，系统不会自动重试，从而避免重复付费。

## 项目展示

### 生成视频

<img width="1906" height="904" alt="20260930144512_rec_" src="https://github.com/user-attachments/assets/a238a5f4-469f-4fb9-94e8-3c6c1e9780ec" />

### 首页

<img width="1904" height="929" alt="img_v3_02161_6e721cf2-d0ef-44ff-b957-d585645be61g" src="https://github.com/user-attachments/assets/06b4b945-af0d-4b1c-b599-300bf7bfc022" />
