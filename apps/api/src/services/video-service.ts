import type { CreateVideoRequest, VideoTaskResponse } from '@scenefork/shared'
import type { AppConfig } from '../../../../config.js'
import type { Repository } from '../db/repository.js'
import { ProviderError } from '../errors.js'
import type { VideoProvider } from '../providers/video-provider.js'

export class VideoService {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
    private readonly provider: VideoProvider,
  ) {}

  async submit(
    storyId: string,
    turnId: string,
    input: CreateVideoRequest,
  ): Promise<{ task: VideoTaskResponse; created: boolean }> {
    const turn = this.repository.getTurn(storyId, turnId)
    const pending = this.repository.beginVideoTask({
      storyId,
      turnId,
      resolution: this.config.wanVideoSize,
      duration: this.config.wanVideoDuration,
      confirmSubmissionUnknown: input.confirm_submission_unknown,
      mockOutcome: this.config.providerMode === 'mock' ? input.mock_outcome : undefined,
    })
    if (!pending.created) {
      console.info(`[video_service] Idempotent video response task=${pending.task.id}`)
      return { task: this.repository.toVideoResponse(turnId, pending.task), created: false }
    }

    try {
      const submitted = await this.provider.submit(turn.videoPrompt, {
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
      task: this.repository.toVideoResponse(turnId),
      created: true,
    }
  }

  get(storyId: string, turnId: string): VideoTaskResponse {
    this.repository.getTurn(storyId, turnId)
    return this.repository.toVideoResponse(turnId)
  }
}
