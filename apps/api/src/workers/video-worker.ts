import type { AppConfig } from '../../../../config.js'
import type { Repository } from '../db/repository.js'
import type { VideoTaskRow } from '../db/schema.js'
import type { VideoProvider } from '../providers/video-provider.js'
import type { MediaService } from '../services/media-service.js'
import type { CredentialService } from '../services/credential-service.js'

export class VideoWorker {
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private coverRecoveryComplete = false

  constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
    private readonly provider: VideoProvider,
    private readonly mediaService: MediaService,
    private readonly credentials: CredentialService,
  ) {}

  start() {
    if (this.timer) return
    console.info('[video_worker] Background video recovery started')
    void this.tick()
    const interval = this.credentials.get('wan').mode === 'mock'
      ? 500
      : Math.min(5000, this.config.wanProviderPollMs)
    this.timer = setInterval(() => void this.tick(), interval)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      if (!this.coverRecoveryComplete) await this.recoverMissingCovers()
      const tasks = this.repository.listRecoverableVideoTasks()
      for (const task of tasks) await this.process(task)
    } finally {
      this.ticking = false
    }
  }

  private async recoverMissingCovers() {
    this.coverRecoveryComplete = true
    const candidates = this.repository.listVideoCoverCandidates()
    const affectedStories = new Set<string>()
    let recovered = 0
    for (const candidate of candidates) {
      const thumbnail = await this.mediaService.retryThumbnail(
        candidate.taskId,
        candidate.localPath,
      )
      if (!thumbnail) continue
      this.repository.setVideoTaskCover(candidate.taskId, thumbnail)
      affectedStories.add(candidate.storyId)
      recovered += 1
    }
    for (const storyId of affectedStories) this.repository.syncStoryCover(storyId)
    for (const storyId of this.repository.listStoryIdsMissingCovers()) {
      this.repository.syncStoryCover(storyId)
    }
    console.info(
      `[video_worker] Video cover recovery completed candidates=${candidates.length} recovered=${recovered}`,
    )
  }

  private async process(task: VideoTaskRow) {
    if (task.providerMode === 'real' && task.credentialFingerprint) {
      const activeCredential = this.credentials.get('wan')
      if (activeCredential.fingerprint !== task.credentialFingerprint) {
        this.repository.markVideoPausedForCredential(task.id)
        console.warn(`[video_worker] Task paused because its Wan credential is unavailable task=${task.id}`)
        return
      }
    }
    if (task.status === 'submitting') {
      const staleAfter = this.config.providerRequestTimeoutMs + 5000
      if (Date.now() - Date.parse(task.createdAt) >= staleAfter) {
        this.repository.markSubmissionUnknown(
          task.id,
          'The server stopped before provider task creation could be confirmed',
        )
      }
      return
    }

    if (task.status === 'saving' && task.temporaryVideoUrl) {
      await this.save(task, task.temporaryVideoUrl)
      return
    }

    if (!task.providerTaskId) {
      this.repository.markVideoFailed(task.id, task.providerStatus, 'Provider task ID is missing')
      return
    }

    const lastPoll = task.lastPolledAt ? Date.parse(task.lastPolledAt) : 0
    if (Date.now() - lastPoll < this.config.wanProviderPollMs) return

    try {
      this.repository.markVideoPollAttempt(task.id)
      const result = await this.provider.poll(task.providerTaskId)
      if (result.status === 'PENDING') {
        this.repository.markVideoPolled(task.id, 'queued', result.status)
      } else if (result.status === 'RUNNING') {
        this.repository.markVideoPolled(task.id, 'running', result.status)
      } else if (result.status === 'SUCCEEDED' && result.videoUrl) {
        this.repository.markVideoPolled(task.id, 'saving', result.status, result.videoUrl)
        await this.save(task, result.videoUrl)
      } else if (result.status === 'FAILED' || result.status === 'CANCELED') {
        this.repository.markVideoFailed(
          task.id,
          result.status,
          result.error || `Provider task ended with ${result.status}`,
        )
      } else {
        this.repository.markVideoFailed(
          task.id,
          result.status,
          result.error || 'Provider task is unknown or has expired',
        )
      }
    } catch (error) {
      console.warn(
        `[video_worker] Provider poll failed task=${task.id} error=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async save(task: VideoTaskRow, sourceUrl: string) {
    try {
      const media = await this.mediaService.save(task.id, sourceUrl)
      this.repository.markVideoSucceeded(task.id, media.filename, media.mediaType, media.thumbnailFilename)
      console.info(`[video_worker] Video downloaded successfully task=${task.id}`)
    } catch (error) {
      this.repository.markVideoSaveError(
        task.id,
        `Failed to persist generated media: ${error instanceof Error ? error.message : String(error)}`,
      )
      console.warn(
        `[video_worker] Media save will retry task=${task.id} error=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
