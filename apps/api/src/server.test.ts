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
import type { MediaService } from './services/media-service.js'
import { VideoWorker } from './workers/video-worker.js'

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
    assert.match(response.headers['access-control-allow-methods'] ?? '', /DELETE/)
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

test('worker backfills a missing draft cover from an existing local video without resubmitting', async () => {
  const provider = new ControlledVideoProvider()
  const config = testConfig(':memory:', 1)
  const server = await buildServer({ config, videoProvider: provider, startWorker: false })
  try {
    const story = await createStory(server.app)
    const turn = story.turns[0]
    await server.app.inject({
      method: 'POST',
      url: `/api/stories/${story.id}/turns/${turn.id}/video`,
      payload: {},
    })
    await server.videoWorker.tick()
    const task = server.repository.getLatestVideoTask(turn.id)
    assert.ok(task)
    server.database.sqlite.prepare(`
      UPDATE video_tasks
      SET local_path = 'legacy.mp4', media_type = 'video/mp4', provider_mode = 'real'
      WHERE id = ?
    `).run(task.id)
    fs.writeFileSync(path.join(config.mediaDir, 'legacy.mp4'), 'legacy-video-fixture')

    let thumbnailCalls = 0
    const mediaService = {
      async retryThumbnail(taskId: string, mediaFilename: string) {
        thumbnailCalls += 1
        assert.equal(taskId, task.id)
        assert.equal(mediaFilename, 'legacy.mp4')
        return `${taskId}.cover.jpg`
      },
    } as unknown as MediaService
    const recoveryWorker = new VideoWorker(
      config,
      server.repository,
      provider,
      mediaService,
      server.credentials,
    )
    await recoveryWorker.tick()

    const draft = server.repository.listStories().items[0]
    const recoveredStory = server.repository.getStory(story.id)
    assert.equal(thumbnailCalls, 1)
    assert.equal(draft.cover_kind, 'real')
    assert.match(draft.cover_url ?? '', /\.cover\.jpg$/)
    assert.equal(recoveredStory.turns[0].video.cover_kind, 'real')
    assert.equal(recoveredStory.turns[0].video.cover_url, draft.cover_url)
    assert.equal(provider.submitCount, 1)
  } finally {
    await server.app.close()
  }
})

test('recent drafts include only persisted real videos and renumber after database deletion', async () => {
  const provider = new ControlledVideoProvider()
  const config = testConfig(':memory:', 1)
  const server = await buildServer({
    config,
    videoProvider: provider,
    startWorker: false,
  })
  try {
    const mockOnly = await createStory(server.app)
    const missingMedia = await createStory(server.app)
    await completeVideoAndMarkReal(
      server,
      missingMedia,
      'missing-real.mp4',
      config.mediaDir,
      false,
    )
    const p0 = await createStory(server.app)
    const p0TaskId = await completeVideoAndMarkReal(
      server,
      p0,
      'p0-real.mp4',
      config.mediaDir,
    )
    const p1 = await createStory(server.app)
    await completeVideoAndMarkReal(server, p1, 'p1-real.mp4', config.mediaDir)

    const listed = await server.app.inject({ method: 'GET', url: '/api/stories' })
    assert.equal(listed.statusCode, 200)
    assert.deepEqual(
      listed.json().items.map((item: { id: string; name: string; draft_number: number }) => ({
        id: item.id,
        name: item.name,
        number: item.draft_number,
      })),
      [
        { id: p0.id, name: 'draft1', number: 1 },
        { id: p1.id, name: 'draft2', number: 2 },
      ],
    )
    assert.equal(listed.json().items.some((item: { id: string }) => item.id === mockOnly.id), false)
    assert.equal(listed.json().items.some((item: { id: string }) => item.id === missingMedia.id), false)

    const deleted = await server.app.inject({
      method: 'DELETE',
      url: `/api/stories/${p0.id}`,
    })
    assert.equal(deleted.statusCode, 204)
    const relisted = await server.app.inject({ method: 'GET', url: '/api/stories' })
    assert.deepEqual(
      relisted.json().items.map((item: { id: string; name: string; draft_number: number }) => ({
        id: item.id,
        name: item.name,
        number: item.draft_number,
      })),
      [{ id: p1.id, name: 'draft1', number: 1 }],
    )
    assert.equal(
      (server.database.sqlite.prepare('SELECT COUNT(*) AS value FROM stories WHERE id = ?')
        .get(p0.id) as { value: number }).value,
      0,
    )
    assert.equal(
      (server.database.sqlite.prepare('SELECT COUNT(*) AS value FROM video_tasks WHERE id = ?')
        .get(p0TaskId) as { value: number }).value,
      0,
    )
    assert.equal(
      (server.database.sqlite.prepare('SELECT COUNT(*) AS value FROM story_branches WHERE story_id = ?')
        .get(p0.id) as { value: number }).value,
      0,
    )
    assert.equal((await server.app.inject({
      method: 'GET',
      url: `/api/stories/${p1.id}`,
    })).statusCode, 200)
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

test('temporary model keys are protected, redacted, independent, and cleared on restart', async () => {
  const config: AppConfig = {
    ...testConfig(':memory:', 1),
    providerMode: 'real',
    qwenProviderMode: 'real',
    wanProviderMode: 'real',
    qwenApiKey: '',
    wanApiKey: '',
    dashscopeApiKey: '',
    webOrigin: 'http://127.0.0.1:5173',
    qwenBaseUrl: 'https://example.test/compatible-mode/v1',
    wanBaseUrl: 'https://example.test/api/v1',
  }
  const server = await buildServer({ config, startWorker: false })
  const headers = { origin: config.webOrigin!, 'x-scenefork-settings': '1' }
  try {
    const blocked = await server.app.inject({ method: 'GET', url: '/api/settings/keys' })
    assert.equal(blocked.statusCode, 403)

    const initial = await server.app.inject({ method: 'GET', url: '/api/settings/keys', headers })
    assert.deepEqual(initial.json(), {
      qwen: { configured: false, source: 'missing', temporary: false, mode: 'mock' },
      wan: { configured: false, source: 'missing', temporary: false, mode: 'mock' },
    })
    const qwenKey = 'sk-qwen-temporary-test-key'
    const wanKey = 'sk-wan-temporary-test-key'
    const updated = await server.app.inject({
      method: 'PUT',
      url: '/api/settings/keys',
      headers,
      payload: { qwen_api_key: qwenKey, wan_api_key: wanKey },
    })
    assert.equal(updated.statusCode, 200)
    assert.equal(updated.json().qwen.source, 'temporary')
    assert.equal(updated.json().wan.source, 'temporary')
    assert.equal(updated.json().qwen.mode, 'real')
    assert.equal(updated.json().wan.mode, 'real')
    assert.doesNotMatch(updated.body, /sk-qwen|sk-wan/)

    const cleared = await server.app.inject({
      method: 'PUT',
      url: '/api/settings/keys',
      headers,
      payload: { qwen_api_key: null, wan_api_key: null },
    })
    assert.equal(cleared.json().qwen.source, 'missing')
    assert.equal(cleared.json().wan.source, 'missing')
  } finally {
    await server.app.close()
  }

  const restarted = await buildServer({ config, startWorker: false })
  try {
    const status = await restarted.app.inject({ method: 'GET', url: '/api/settings/keys', headers })
    assert.equal(status.json().qwen.temporary, false)
    assert.equal(status.json().wan.temporary, false)
  } finally {
    await restarted.app.close()
  }
})

test('historical choices fork without overwriting the original branch or its selected versions', async () => {
  const provider = new ControlledVideoProvider()
  const server = await buildServer({
    config: testConfig(':memory:', 1),
    videoProvider: provider,
    startWorker: false,
  })
  try {
    const opening = await createStory(server.app)
    const root = opening.turns[0]
    const mainBranchId = opening.current_branch_id as string
    const videoRoute = `/api/stories/${opening.id}/turns/${root.id}/video`
    await server.app.inject({ method: 'POST', url: videoRoute, payload: { branch_id: mainBranchId } })
    await server.videoWorker.tick()

    const continued = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/turns/${root.id}/choose`,
      payload: { branch_id: mainBranchId, choice_id: root.choices[0].id },
    })
    assert.equal(continued.statusCode, 201)
    assert.equal(continued.json().turns.length, 2)

    const forked = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/turns/${root.id}/choose`,
      payload: { branch_id: mainBranchId, choice_id: root.choices[1].id },
    })
    assert.equal(forked.statusCode, 201)
    const forkStory = forked.json()
    const forkBranchId = forkStory.current_branch_id as string
    assert.notEqual(forkBranchId, mainBranchId)
    assert.equal(forkStory.branches.length, 2)
    assert.equal(forkStory.turns.length, 2)
    assert.equal(forkStory.tree_turns.length, 3)
    assert.deepEqual(
      forkStory.turns.map((turn: { id: string }) => turn.id),
      forkStory.branches
        .find((branch: { id: string }) => branch.id === forkBranchId)
        .path_turn_ids,
    )

    const mainBeforeEdit = await server.app.inject({
      method: 'GET',
      url: `/api/stories/${opening.id}?branch_id=${mainBranchId}`,
    })
    assert.equal(mainBeforeEdit.json().turns.length, 2)
    assert.equal(mainBeforeEdit.json().tree_turns.length, 3)
    assert.notEqual(
      mainBeforeEdit.json().turns[1].id,
      forkStory.turns[1].id,
    )
    assert.equal(
      mainBeforeEdit.json().turns.some(
        (turn: { id: string }) => turn.id === forkStory.turns[1].id,
      ),
      false,
    )

    const edited = await server.app.inject({
      method: 'PATCH',
      url: `/api/stories/${opening.id}/turns/${root.id}`,
      payload: {
        branch_id: mainBranchId,
        story_text: 'The traveler changes the first scene while preserving every previous immutable version.',
      },
    })
    assert.equal(edited.statusCode, 200)
    assert.equal(edited.json().turns[0].content_version, 2)
    assert.equal(edited.json().turns[1].branch_status, 'stale')

    const forkAfterEdit = await server.app.inject({
      method: 'GET',
      url: `/api/stories/${opening.id}?branch_id=${forkBranchId}`,
    })
    assert.equal(forkAfterEdit.json().turns[0].content_version, 1)
    assert.equal(forkAfterEdit.json().turns[1].branch_status, 'normal')

    await server.app.inject({
      method: 'POST',
      url: videoRoute,
      payload: { branch_id: mainBranchId },
    })
    await server.videoWorker.tick()
    const mainVideo = await server.app.inject({
      method: 'GET',
      url: `${videoRoute}?branch_id=${mainBranchId}`,
    })
    const forkVideo = await server.app.inject({
      method: 'GET',
      url: `${videoRoute}?branch_id=${forkBranchId}`,
    })
    assert.equal(mainVideo.json().version, 2)
    assert.equal(forkVideo.json().version, 1)
    assert.equal(provider.submitCount, 2)
  } finally {
    await server.app.close()
  }
})

test('branch deletion protects Main and nodes retained by another branch', async () => {
  const provider = new ControlledVideoProvider()
  const server = await buildServer({
    config: testConfig(':memory:', 1),
    videoProvider: provider,
    startWorker: false,
  })
  try {
    const opening = await createStory(server.app)
    const root = opening.turns[0]
    const mainBranchId = opening.current_branch_id as string
    await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/turns/${root.id}/video`,
      payload: { branch_id: mainBranchId },
    })
    await server.videoWorker.tick()
    const mainContinuation = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/turns/${root.id}/choose`,
      payload: { branch_id: mainBranchId, choice_id: root.choices[0].id },
    })
    const mainChildId = mainContinuation.json().turns[1].id as string
    const forked = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/turns/${root.id}/choose`,
      payload: { branch_id: mainBranchId, choice_id: root.choices[1].id },
    })
    const branchStory = forked.json()
    const branchId = branchStory.current_branch_id as string
    const branchChildId = branchStory.turns[1].id as string
    const descendant = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/branches`,
      payload: {
        source_branch_id: branchId,
        from_turn_id: branchChildId,
        name: 'Branch descendant',
      },
    })
    const descendantId = descendant.json().current_branch_id as string
    const editedMainChild = await server.app.inject({
      method: 'PATCH',
      url: `/api/stories/${opening.id}/turns/${mainChildId}`,
      payload: {
        branch_id: mainBranchId,
        story_text: 'The Main branch keeps this immutable second version while another branch is deleted.',
      },
    })
    assert.equal(editedMainChild.statusCode, 200)
    assert.equal(editedMainChild.json().turns[1].content_version, 2)

    const mainDelete = await server.app.inject({
      method: 'DELETE',
      url: `/api/stories/${opening.id}/branches/${mainBranchId}`,
    })
    assert.equal(mainDelete.statusCode, 409)
    assert.equal(mainDelete.json().code, 'MAIN_BRANCH_DELETE_FORBIDDEN')

    await server.app.inject({
      method: 'PUT',
      url: `/api/stories/${opening.id}/branches/${branchId}/active`,
    })
    const deletedCurrent = await server.app.inject({
      method: 'DELETE',
      url: `/api/stories/${opening.id}/branches/${branchId}`,
    })
    assert.equal(deletedCurrent.statusCode, 200)
    const afterCurrentDelete = deletedCurrent.json()
    assert.equal(afterCurrentDelete.current_branch_id, mainBranchId)
    assert.deepEqual(
      afterCurrentDelete.branches.map((item: { id: string }) => item.id).sort(),
      [mainBranchId, descendantId].sort(),
    )
    const descendantAfterDelete = await server.app.inject({
      method: 'GET',
      url: `/api/stories/${opening.id}?branch_id=${descendantId}`,
    })
    assert.equal(descendantAfterDelete.statusCode, 200)
    assert.deepEqual(
      descendantAfterDelete.json().turns.map((turn: { id: string }) => turn.id),
      [root.id, branchChildId],
    )

    const deletedDescendant = await server.app.inject({
      method: 'DELETE',
      url: `/api/stories/${opening.id}/branches/${descendantId}`,
    })
    assert.equal(deletedDescendant.statusCode, 200)
    assert.deepEqual(
      deletedDescendant.json().branches.map((item: { id: string }) => item.id),
      [mainBranchId],
    )
    assert.deepEqual(
      deletedDescendant.json().turns.map((turn: { id: string }) => turn.id),
      [root.id, mainChildId],
    )
    assert.equal(deletedDescendant.json().turns[1].content_version, 2)
    assert.equal(
      (server.database.sqlite.prepare('SELECT COUNT(*) AS value FROM story_turns WHERE id = ?')
        .get(branchChildId) as { value: number }).value,
      0,
    )
    assert.equal(
      (server.database.sqlite.prepare('SELECT COUNT(*) AS value FROM story_turns WHERE id = ?')
        .get(root.id) as { value: number }).value,
      1,
    )
    assert.equal(server.repository.getStory(opening.id, mainBranchId).turns[0].video.status, 'succeeded')
  } finally {
    await server.app.close()
  }
})

test('explicit story regeneration creates an immutable version without creating a branch', async () => {
  const provider = new ControlledVideoProvider()
  const server = await buildServer({
    config: testConfig(':memory:', 1),
    videoProvider: provider,
    startWorker: false,
  })
  try {
    const opening = await createStory(server.app)
    const root = opening.turns[0]
    const branchId = opening.current_branch_id as string
    await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/turns/${root.id}/video`,
      payload: { branch_id: branchId },
    })
    await server.videoWorker.tick()
    const continued = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/turns/${root.id}/choose`,
      payload: { branch_id: branchId, choice_id: root.choices[0].id },
    })
    assert.equal(continued.statusCode, 201)
    const before = continued.json()
    const response = await server.app.inject({
      method: 'POST',
      url: `/api/stories/${opening.id}/branches/${branchId}/turns/${root.id}/regenerate-story`,
    })
    assert.equal(response.statusCode, 201)
    const regenerated = response.json()
    assert.equal(regenerated.current_branch_id, branchId)
    assert.equal(regenerated.branches.length, before.branches.length)
    assert.deepEqual(
      regenerated.turns.map((turn: { id: string }) => turn.id),
      before.turns.map((turn: { id: string }) => turn.id),
    )
    assert.equal(regenerated.selections.length, before.selections.length)
    assert.equal(regenerated.turns[0].content_version, 2)
    assert.equal(regenerated.turns[0].video.status, 'idle')
    assert.equal(regenerated.turns[1].branch_status, 'stale')

    const versions = await server.app.inject({
      method: 'GET',
      url: `/api/stories/${opening.id}/turns/${root.id}/versions`,
    })
    assert.equal(versions.statusCode, 200)
    assert.deepEqual(
      versions.json().map((version: { version: number }) => version.version),
      [2, 1],
    )
  } finally {
    await server.app.close()
  }
})

test('explicit video regeneration keeps the story version and preserves video history', async () => {
  const provider = new ControlledVideoProvider()
  const server = await buildServer({
    config: testConfig(':memory:', 1),
    videoProvider: provider,
    startWorker: false,
  })
  try {
    const opening = await createStory(server.app)
    const turn = opening.turns[0]
    const branchId = opening.current_branch_id as string
    const route = `/api/stories/${opening.id}/turns/${turn.id}/video`
    await server.app.inject({
      method: 'POST',
      url: route,
      payload: { branch_id: branchId },
    })
    await server.videoWorker.tick()

    const before = server.repository.getStory(opening.id, branchId)
    const response = await server.app.inject({
      method: 'POST',
      url: route,
      payload: { branch_id: branchId, regenerate: true },
    })
    assert.equal(response.statusCode, 202)
    assert.equal(response.json().version, 2)

    const after = server.repository.getStory(opening.id, branchId)
    assert.equal(after.branches?.length, before.branches?.length)
    assert.equal(after.turns[0].content_version_id, before.turns[0].content_version_id)
    assert.equal(after.turns[0].content_version, before.turns[0].content_version)
    assert.equal(after.turns[0].video.version, 2)
    const history = await server.app.inject({
      method: 'GET',
      url: `/api/stories/${opening.id}/turns/${turn.id}/videos?branch_id=${branchId}`,
    })
    assert.equal(history.statusCode, 200)
    assert.deepEqual(
      history.json().map((video: { version: number }) => video.version),
      [2, 1],
    )
    assert.equal(provider.submitCount, 2)
  } finally {
    await server.app.close()
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

async function completeVideoAndMarkReal(
  server: Awaited<ReturnType<typeof buildServer>>,
  story: { id: string; turns: Array<{ id: string }> },
  filename: string,
  mediaDir: string,
  createMediaFile = true,
) {
  const turnId = story.turns[0]!.id
  await server.app.inject({
    method: 'POST',
    url: `/api/stories/${story.id}/turns/${turnId}/video`,
    payload: {},
  })
  await server.videoWorker.tick()
  const task = server.repository.getLatestVideoTask(turnId)
  assert.ok(task)
  server.database.sqlite.prepare(`
    UPDATE video_tasks
    SET provider_mode = 'real', status = 'succeeded', local_path = ?, media_type = 'video/mp4'
    WHERE id = ?
  `).run(filename, task.id)
  if (createMediaFile) fs.writeFileSync(path.join(mediaDir, filename), 'real-video-fixture')
  return task.id
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
