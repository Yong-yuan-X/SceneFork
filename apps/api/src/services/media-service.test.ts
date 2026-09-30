import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AppConfig } from '../../../../config.js'
import { MediaService } from './media-service.js'

test('missing FFmpeg falls back without failing saved media', async () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenefork-no-ffmpeg-'))
  const videoPath = path.join(mediaDir, 'existing.mp4')
  fs.writeFileSync(videoPath, 'already-saved-video')
  const service = new MediaService({
    nodeEnv: 'test',
    providerMode: 'mock',
    host: '127.0.0.1',
    port: 3000,
    dashscopeApiKey: '',
    qwenModel: 'qwen3.7-flash',
    wanModel: 'wan2.6-t2v',
    qwenBaseUrl: '',
    wanBaseUrl: '',
    databasePath: ':memory:',
    mediaDir,
    wanVideoSize: '1280*720',
    wanVideoDuration: 5,
    wanProviderPollMs: 1,
    providerRequestTimeoutMs: 1000,
    qwenRequestTimeoutMs: 1000,
    qwenMaxRetries: 0,
    ffmpegPath: `missing-ffmpeg-${Date.now()}`,
    ffmpegTimeoutMs: 100,
  } satisfies AppConfig)

  const thumbnail = await service.extractThumbnail(
    '70000000-0000-4000-8000-000000000001',
    videoPath,
  )
  assert.equal(thumbnail, null)
  assert.equal(fs.existsSync(videoPath), true)
  assert.equal(fs.readdirSync(mediaDir).some((name) => name.includes('.cover.jpg')), false)
})
