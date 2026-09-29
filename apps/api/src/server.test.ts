import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AppConfig } from '../../../config.js'
import { createDatabase } from './db/database.js'
import { ProviderError } from './errors.js'
import type {
  VideoPollResult,
  VideoProvider,
  VideoSubmission,
} from './providers/video-provider.js'
import { buildServer } from './server.js'

class ControlledVideoProvider implements VideoProvider {
  submitCount = 0
  pollCount = 0
  pollStatus: VideoPollResult['status'] = 'SUCCEEDED'

  async submit(
    _prompt: string,
    options: { requestId: string; mockOutcome?: 'success' | 'failure' | 'unknown' },
  ): Promise<VideoSubmission> {
    this.submitCount += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (options.mockOutcome === 'unknown') {
      throw new ProviderError('Controlled timeout', true, options.requestId)
    }
    return { taskId: `controlled-${this.submitCount}`, status: 'PENDING', requestId: options.requestId }
  }

  poll(): Promise<VideoPollResult> {
    this.pollCount += 1
    return Promise.resolve({
      status: this.pollStatus,
      videoUrl: this.pollStatus === 'SUCCEEDED' ? 'mock://preview' : null,
      error: this.pollStatus === 'FAILED' ? 'Controlled failure' : null,
      requestId: `poll-${this.pollCount}`,
    })
  }
}

test('CORS permits the browser PATCH used before video submission', async () => {
  const config = testConfig(':memory:', 1)
  const server = await buildServer({ config, startWorker: false })
  try {
    const response = await server.app.inject({
      method: 'OPTIONS',
      url: '/api/stories/00000000-0000-4000-8000-000000000000/turns/00000000-0000-4000-8000-000000000000',
      headers: {
        origin: 'http://127.0.0.1:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type',
      },
    })
    assert.equal(response.statusCode, 204)
    assert.match(response.headers['access-control-allow-methods'] ?? '', /PATCH/)
  } finally {
    await server.app.close()
  }
})

test('API persists stories, protects concurrent video submits, and normalizes preset continuation', async () => {
  const provider = new ControlledVideoProvider()
  const config = testConfig(':memory:', 1)
  const server = await buildServer({ config, videoProvider: provider, startWorker: false })
  try {
    const story = await createStory(server.app)
    const turn = story.turns[0]
    const route = `/api/stories/${story.id}/turns/${turn.id}/video`
    const [first, second] = await Promise.all([
      server.app.inject({ method: 'POST', url: route, payload: { mock_outcome: 'success' } }),
      server.app.inject({ method: 'POST', url: route, payload: { mock_outcome: 'success' } }),
    ])
    assert.equal(first.statusCode, 202)
    assert.equal(second.statusCode, 202)
    assert.equal(provider.submitCount, 1)

    const readOnlyPoll = await server.app.inject({ method: 'GET', url: route })
    assert.equal(readOnlyPoll.statusCode, 200)
    assert.equal(provider.submitCount, 1)

    await server.videoWorker.tick()
    const completed = await server.app.inject({ method: 'GET', url: route })
    const completedTask = completed.json()
    assert.equal(completedTask.status, 'succeeded')
    assert.match(completedTask.video_url, /^\/media\//)
    assert.ok(fs.existsSync(path.join(config.mediaDir, path.basename(completedTask.video_url))))

    const selectedChoice = turn.choices[0]
    const chooseRoute = `/api/stories/${story.id}/turns/${turn.id}/choose`
    const continued = await server.app.inject({
      method: 'POST',
      url: chooseRoute,
      payload: { choice_id: selectedChoice.id },
    })
    assert.equal(continued.statusCode, 201)
    const continuedStory = continued.json()
    assert.equal(continuedStory.turns.length, 2)
    assert.equal(continuedStory.turns[1].parent_turn_id, turn.id)
    assert.equal(continuedStory.turns[0].video.status, 'succeeded')
    assert.equal(continuedStory.turns[1].video.status, 'idle')
    assert.equal(continuedStory.selections[0].source, 'preset')
    assert.equal(continuedStory.selections[0].user_direction, selectedChoice.direction)

    const repeated = await server.app.inject({
      method: 'POST',
      url: chooseRoute,
      payload: { choice_id: selectedChoice.id },
    })
    assert.equal(repeated.statusCode, 201)
    assert.equal(repeated.json().turns.length, 2)
  } finally {
    await server.app.close()
  }
})

test('custom continuation shares the same persisted selection flow', async () => {
  const provider = new ControlledVideoProvider()
  const config = testConfig(':memory:', 1)
  const server = await buildServer({ config, videoProvider: provider, startWorker: false })
  try {
    const story = await createStory(server.app)
    const turn = story.turns[0]
    const videoRoute = `/api/stories/${story.id}/turns/${turn.id}/video`
    await server.app.inject({ method: 'POST', url: videoRoute, payload: {} })
    await server.videoWorker.tick()
    const direction = '主角留在桥头，点亮信号灯等待城堡回应。'
    const response = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${story.id}/turns/${turn.id}/choose`,
      payload: { custom_direction: `  ${direction}  ` },
    })
    assert.equal(response.statusCode, 201)
    const selection = response.json().selections[0]
    assert.equal(selection.source, 'custom')
    assert.equal(selection.choice_id, null)
    assert.equal(selection.user_direction, direction)
  } finally {
    await server.app.close()
  }
})

test('unknown submission requires explicit confirmation before a paid retry boundary', async () => {
  const provider = new ControlledVideoProvider()
  const server = await buildServer({
    config: testConfig(':memory:', 1),
    videoProvider: provider,
    startWorker: false,
  })
  try {
    const story = await createStory(server.app)
    const turn = story.turns[0]
    const route = `/api/stories/${story.id}/turns/${turn.id}/video`
    const unknown = await server.app.inject({
      method: 'POST',
      url: route,
      payload: { mock_outcome: 'unknown' },
    })
    assert.equal(unknown.statusCode, 202)
    assert.equal(unknown.json().status, 'submission_unknown')

    const blocked = await server.app.inject({ method: 'POST', url: route, payload: {} })
    assert.equal(blocked.statusCode, 409)
    assert.equal(blocked.json().code, 'SUBMISSION_UNKNOWN_CONFIRMATION_REQUIRED')

    const confirmed = await server.app.inject({
      method: 'POST',
      url: route,
      payload: { confirm_submission_unknown: true, mock_outcome: 'success' },
    })
    assert.equal(confirmed.statusCode, 202)
    assert.equal(confirmed.json().version, 2)
    assert.equal(provider.submitCount, 2)
  } finally {
    await server.app.close()
  }
})

test('worker resumes persisted tasks after restart and provider polling is rate limited', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scenefork-recovery-'))
  const databasePath = path.join(directory, 'recovery.db')
  const firstProvider = new ControlledVideoProvider()
  const first = await buildServer({
    config: testConfig(databasePath, 60_000),
    videoProvider: firstProvider,
    startWorker: false,
  })
  const story = await createStory(first.app)
  const turn = story.turns[0]
  await first.app.inject({
    method: 'POST',
    url: `/api/stories/${story.id}/turns/${turn.id}/video`,
    payload: {},
  })
  await first.app.close()

  const secondProvider = new ControlledVideoProvider()
  secondProvider.pollStatus = 'RUNNING'
  const database = createDatabase(databasePath)
  const second = await buildServer({
    config: testConfig(databasePath, 60_000),
    database,
    videoProvider: secondProvider,
    startWorker: false,
  })
  try {
    await second.videoWorker.tick()
    await second.videoWorker.tick()
    assert.equal(secondProvider.pollCount, 1)
    assert.equal(second.repository.getLatestVideoTask(turn.id)?.status, 'running')
  } finally {
    await second.app.close()
    database.close()
  }
})

async function createStory(app: Awaited<ReturnType<typeof buildServer>>['app']) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/stories',
    payload: { idea: '一名旅人在暮色中发现山顶古堡' },
  })
  assert.equal(response.statusCode, 201)
  return response.json()
}

function testConfig(databasePath: string, providerPollMs: number): AppConfig {
  return {
    nodeEnv: 'test',
    providerMode: 'mock',
    host: '127.0.0.1',
    port: 3000,
    dashscopeApiKey: '',
    qwenModel: 'qwen3.7-flash',
    wanModel: 'an2.2-t2v-plus',
    qwenBaseUrl: '',
    wanBaseUrl: '',
    databasePath,
    mediaDir: fs.mkdtempSync(path.join(os.tmpdir(), 'scenefork-media-')),
    wanVideoSize: '1280*720',
    wanVideoDuration: 5,
    wanProviderPollMs: providerPollMs,
    providerRequestTimeoutMs: 1000,
    qwenRequestTimeoutMs: 1000,
    qwenMaxRetries: 0,
  }
}
