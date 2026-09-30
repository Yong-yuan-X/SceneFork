import type { CreateVideoRequest, VideoTaskResponse } from '@scenefork/shared'
import type { AppConfig } from '../../../../config.js'
import type { Repository } from '../db/repository.js'
import { ProviderError } from '../errors.js'
import type { VideoProvider } from '../providers/video-provider.js'
import type { CredentialService } from './credential-service.js'
import type { MediaService } from './media-service.js'

export class VideoService {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
    private readonly provider: VideoProvider,
    private readonly credentials: CredentialService,
    private readonly mediaService: MediaService,
  ) {}

  async submit(
    storyId: string,
    turnId: string,
    input: CreateVideoRequest,
  ): Promise<{ task: VideoTaskResponse; created: boolean }> {
    this.repository.getTurn(storyId, turnId)
    const credential = this.credentials.get('wan')
    const pending = this.repository.beginVideoTask({
      storyId,
      branchId: input.branch_id,
      turnId,
      resolution: this.config.wanVideoSize,
      duration: this.config.wanVideoDuration,
      confirmSubmissionUnknown: input.confirm_submission_unknown,
      regenerate: input.regenerate,
      idempotencyKey: input.idempotency_key,
      providerMode: credential.mode,
      credentialFingerprint: credential.fingerprint,
      credentialSource: credential.source,
      mockOutcome: credential.mode === 'mock' ? input.mock_outcome : undefined,
    })
    if (!pending.created) {
      console.info(`[video_service] Idempotent video response task=${pending.task.id}`)
      return { task: this.repository.toVideoResponse(turnId, pending.task), created: false }
    }

    try {
      const submitted = await this.provider.submit(pending.task.promptSnapshot ?? '', {
        requestId: pending.task.requestId,
        mockOutcome: pending.task.mockOutcome ?? undefined,
      })
      this.repository.markVideoSubmitted(
        pending.task.id,
        submitted.taskId,
        submitted.status,
      )
    } catch (error) {
      if (error instanceof ProviderError && error.outcomeUnknown) {
        this.repository.markSubmissionUnknown(pending.task.id, error.message)
        console.warn(
          `[video_service] Submission outcome unknown request=${pending.task.requestId} error=${error.message}`,
        )
      } else {
        const message = error instanceof Error ? error.message : String(error)
        this.repository.markVideoFailed(
          pending.task.id,
          null,
          message,
        )
        console.warn(
          `[video_service] Submission failed request=${pending.task.requestId} error=${message}`,
        )
      }
    }

    return {
      task: this.repository.toVideoResponse(
        turnId,
        this.repository.getVideoTask(pending.task.id),
        pending.task.id,
      ),
      created: true,
    }
  }

  get(storyId: string, turnId: string, branchId?: string): VideoTaskResponse {
    this.repository.getTurn(storyId, turnId)
    const task = this.repository.getSelectedVideoTask(storyId, turnId, branchId)
    return this.repository.toVideoResponse(turnId, task, task?.id ?? null)
  }

  history(storyId: string, turnId: string, branchId?: string) {
    const selected = this.repository.getSelectedVideoTask(storyId, turnId, branchId)
    return this.repository.listVideoTasks(storyId, turnId)
      .map((task) => this.repository.toVideoResponse(turnId, task, selected?.id ?? null))
  }

  async retryCover(storyId: string) {
    const task = this.repository.getCoverCandidate(storyId)
    if (!task?.localPath) return { cover_url: null, cover_kind: 'placeholder' as const }
    const thumbnail = await this.mediaService.retryThumbnail(task.id, task.localPath)
    if (!thumbnail) return { cover_url: null, cover_kind: 'placeholder' as const }
    this.repository.setVideoTaskCover(task.id, thumbnail)
    this.repository.setStoryCover(storyId, thumbnail)
    return { cover_url: `/media/${encodeURIComponent(thumbnail)}`, cover_kind: 'real' as const }
  }
}
