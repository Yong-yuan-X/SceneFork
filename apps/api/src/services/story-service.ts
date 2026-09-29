import type { ChooseRequest, CreateStoryRequest, StoryResponse } from '@scenefork/shared'
import { ConflictError } from '../errors.js'
import type { Repository } from '../db/repository.js'
import type { StoryProvider } from '../providers/story-provider.js'

export class StoryService {
  constructor(
    private readonly repository: Repository,
    private readonly provider: StoryProvider,
  ) {}

  async create(input: CreateStoryRequest): Promise<StoryResponse> {
    const output = await this.provider.generateOpening(input.idea, input.style)
    console.info('[story_service] Story opening validated and ready to persist')
    return this.repository.createStory(input.idea, output)
  }

  get(storyId: string): StoryResponse {
    return this.repository.getStory(storyId)
  }

  updateTurn(
    storyId: string,
    turnId: string,
    patch: { story_text?: string; video_prompt?: string },
  ): StoryResponse {
    return this.repository.updateTurn(storyId, turnId, patch)
  }

  async choose(storyId: string, turnId: string, input: ChooseRequest): Promise<StoryResponse> {
    const prepared = this.repository.prepareSelection(storyId, turnId, input)
    if (prepared.action === 'complete') return this.repository.getStory(storyId)
    if (prepared.action === 'generating') {
      throw new ConflictError('This turn is already being continued', 'CONTINUATION_IN_PROGRESS')
    }

    try {
      const story = this.repository.getStory(storyId)
      const output = await this.provider.generateContinuation(
        story,
        prepared.selection.userDirection,
      )
      return this.repository.completeSelection(storyId, prepared.selection.id, output)
    } catch (error) {
      this.repository.failSelection(
        prepared.selection.id,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }
}
