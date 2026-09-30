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

  list(page: number, pageSize: number) {
    return this.repository.listStories(page, pageSize)
  }

  get(storyId: string, branchId?: string): StoryResponse {
    return this.repository.getStory(storyId, branchId)
  }

  delete(storyId: string) {
    this.repository.deleteStory(storyId)
  }

  updateTurn(
    storyId: string,
    turnId: string,
    patch: { branch_id?: string; story_text?: string; video_prompt?: string },
  ): StoryResponse {
    return this.repository.updateTurn(storyId, turnId, patch)
  }

  async regenerateTurn(storyId: string, branchId: string, turnId: string) {
    const story = this.repository.getStory(storyId, branchId)
    if (!story.turns.some((turn) => turn.id === turnId)) {
      throw new ConflictError('The turn is not part of this branch', 'TURN_NOT_IN_BRANCH')
    }
    console.info(
      `[story_service] Story turn regeneration started story=${storyId} branch=${branchId} turn=${turnId}`,
    )
    const output = await this.provider.regenerateTurn(story, turnId)
    const regenerated = this.repository.createGeneratedTurnVersion(
      storyId,
      branchId,
      turnId,
      output,
    )
    console.info(
      `[story_service] Story turn regeneration completed story=${storyId} branch=${branchId} turn=${turnId}`,
    )
    return regenerated
  }

  async choose(storyId: string, turnId: string, input: ChooseRequest): Promise<StoryResponse> {
    const prepared = this.repository.prepareSelection(storyId, turnId, input)
    if (prepared.action === 'complete') return this.repository.getStory(storyId)
    if (prepared.action === 'generating') {
      throw new ConflictError('This turn is already being continued', 'CONTINUATION_IN_PROGRESS')
    }

    try {
      const story = this.repository.getStory(storyId, prepared.selection.branchId)
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

  createBranch(storyId: string, sourceBranchId: string, fromTurnId: string, name?: string) {
    return this.repository.createBranch(storyId, sourceBranchId, fromTurnId, name)
  }

  activateBranch(storyId: string, branchId: string) {
    return this.repository.activateBranch(storyId, branchId)
  }

  renameBranch(storyId: string, branchId: string, name: string) {
    return this.repository.renameBranch(storyId, branchId, name)
  }

  deleteBranch(storyId: string, branchId: string) {
    return this.repository.deleteBranch(storyId, branchId)
  }

  listVersions(storyId: string, turnId: string) {
    return this.repository.listContentVersions(storyId, turnId)
  }

  selectVersion(
    storyId: string,
    branchId: string,
    turnId: string,
    input: { content_version_id?: string; video_task_id?: string | null },
  ) {
    return this.repository.selectVersion(storyId, branchId, turnId, input)
  }

  confirmTurn(storyId: string, branchId: string, turnId: string) {
    return this.repository.confirmTurn(storyId, branchId, turnId)
  }
}
