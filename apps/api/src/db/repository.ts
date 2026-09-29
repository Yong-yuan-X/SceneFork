import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  CharacterSchema,
  SceneSchema,
  type ChooseRequest,
  type ProviderMode,
  type StoryModelOutput,
  type StoryResponse,
  type VideoStatus,
  type VideoTaskResponse,
} from '@scenefork/shared'
import { ConflictError, NotFoundError } from '../errors.js'
import type { SceneForkDatabase } from './database.js'
import {
  choices,
  selections,
  stories,
  storyTurns,
  videoTasks,
  type SelectionRow,
  type VideoTaskRow,
} from './schema.js'

const ACTIVE_VIDEO_STATUSES: VideoStatus[] = ['submitting', 'queued', 'running', 'saving']

const now = () => new Date().toISOString()

export class Repository {
  constructor(
    private readonly database: SceneForkDatabase,
    private readonly providerMode: ProviderMode,
  ) {}

  createStory(idea: string, output: StoryModelOutput): StoryResponse {
    const storyId = randomUUID()
    const turnId = randomUUID()
    const timestamp = now()

    this.database.db.transaction((transaction) => {
      transaction
        .insert(stories)
        .values({
          id: storyId,
          originalIdea: idea,
          title: output.title,
          charactersJson: JSON.stringify(output.characters),
          sceneJson: JSON.stringify(output.scene),
          currentTurnId: turnId,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run()
      transaction
        .insert(storyTurns)
        .values({
          id: turnId,
          storyId,
          parentTurnId: null,
          title: output.title,
          storyText: output.story_text,
          summary: output.summary,
          videoPrompt: output.video_prompt,
          createdAt: timestamp,
        })
        .run()
      transaction
        .insert(choices)
        .values(
          output.next_choices.map((choice, index) => ({
            id: randomUUID(),
            turnId,
            position: index + 1,
            label: choice.label,
            direction: choice.direction,
          })),
        )
        .run()
    })

    return this.getStory(storyId)
  }

  getStory(storyId: string): StoryResponse {
    const story = this.database.db.select().from(stories).where(eq(stories.id, storyId)).get()
    if (!story) throw new NotFoundError('Story not found')

    const turns = this.database.db
      .select()
      .from(storyTurns)
      .where(eq(storyTurns.storyId, storyId))
      .orderBy(asc(storyTurns.createdAt))
      .all()

    const turnIds = turns.map((turn) => turn.id)
    const storyChoices = turnIds.length
      ? this.database.db.select().from(choices).where(inArray(choices.turnId, turnIds)).all()
      : []
    const storySelections = turnIds.length
      ? this.database.db.select().from(selections).where(inArray(selections.turnId, turnIds)).all()
      : []
    const tasks = turnIds.length
      ? this.database.db
          .select()
          .from(videoTasks)
          .where(inArray(videoTasks.turnId, turnIds))
          .orderBy(desc(videoTasks.version))
          .all()
      : []

    const latestTaskByTurn = new Map<string, VideoTaskRow>()
    for (const task of tasks) {
      if (!latestTaskByTurn.has(task.turnId)) latestTaskByTurn.set(task.turnId, task)
    }

    return {
      id: story.id,
      original_idea: story.originalIdea,
      title: story.title,
      current_turn_id: story.currentTurnId,
      characters: CharacterSchema.array().parse(JSON.parse(story.charactersJson)),
      scene: SceneSchema.parse(JSON.parse(story.sceneJson)),
      created_at: story.createdAt,
      updated_at: story.updatedAt,
      provider_mode: this.providerMode,
      turns: turns.map((turn) => ({
        id: turn.id,
        story_id: turn.storyId,
        parent_turn_id: turn.parentTurnId,
        title: turn.title,
        story_text: turn.storyText,
        summary: turn.summary,
        video_prompt: turn.videoPrompt,
        created_at: turn.createdAt,
        choices: storyChoices
          .filter((choice) => choice.turnId === turn.id)
          .sort((left, right) => left.position - right.position)
          .map((choice) => ({
            id: choice.id,
            position: choice.position,
            label: choice.label,
            direction: choice.direction,
          })),
        video: this.toVideoResponse(turn.id, latestTaskByTurn.get(turn.id)),
      })),
      selections: storySelections.map((selection) => this.toSelectionResponse(selection)),
    }
  }

  getTurn(storyId: string, turnId: string) {
    const turn = this.database.db
      .select()
      .from(storyTurns)
      .where(and(eq(storyTurns.id, turnId), eq(storyTurns.storyId, storyId)))
      .get()
    if (!turn) throw new NotFoundError('Story turn not found')
    return turn
  }

  updateTurn(
    storyId: string,
    turnId: string,
    patch: { story_text?: string; video_prompt?: string },
  ): StoryResponse {
    this.getTurn(storyId, turnId)
    const latestTask = this.getLatestVideoTask(turnId)
    if (latestTask && !['failed'].includes(latestTask.status)) {
      throw new ConflictError('The turn cannot be edited after video submission', 'TURN_LOCKED')
    }

    this.database.db
      .update(storyTurns)
      .set({
        ...(patch.story_text === undefined ? {} : { storyText: patch.story_text }),
        ...(patch.video_prompt === undefined ? {} : { videoPrompt: patch.video_prompt }),
      })
      .where(eq(storyTurns.id, turnId))
      .run()
    this.database.db
      .update(stories)
      .set({ updatedAt: now() })
      .where(eq(stories.id, storyId))
      .run()

    return this.getStory(storyId)
  }

  beginVideoTask(input: {
    storyId: string
    turnId: string
    resolution: string
    duration: number
    confirmSubmissionUnknown: boolean
    mockOutcome?: 'success' | 'failure' | 'unknown'
  }): { task: VideoTaskRow; created: boolean } {
    this.getTurn(input.storyId, input.turnId)

    return this.database.db.transaction((transaction) => {
      const latest = transaction
        .select()
        .from(videoTasks)
        .where(eq(videoTasks.turnId, input.turnId))
        .orderBy(desc(videoTasks.version))
        .get()

      if (latest?.status === 'submission_unknown' && !input.confirmSubmissionUnknown) {
        throw new ConflictError(
          'The previous submission result is unknown and requires explicit confirmation',
          'SUBMISSION_UNKNOWN_CONFIRMATION_REQUIRED',
        )
      }
      if (latest && (ACTIVE_VIDEO_STATUSES.includes(latest.status) || latest.status === 'succeeded')) {
        return { task: latest, created: false }
      }

      const timestamp = now()
      const task: typeof videoTasks.$inferInsert = {
        id: randomUUID(),
        turnId: input.turnId,
        version: (latest?.version ?? 0) + 1,
        status: 'submitting',
        providerTaskId: null,
        providerStatus: null,
        lastPolledAt: null,
        requestId: randomUUID(),
        resolution: input.resolution,
        duration: input.duration,
        error: null,
        temporaryVideoUrl: null,
        localPath: null,
        mediaType: null,
        mockOutcome: input.mockOutcome ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      }
      transaction.insert(videoTasks).values(task).run()
      return { task: task as VideoTaskRow, created: true }
    })
  }

  getLatestVideoTask(turnId: string): VideoTaskRow | undefined {
    return this.database.db
      .select()
      .from(videoTasks)
      .where(eq(videoTasks.turnId, turnId))
      .orderBy(desc(videoTasks.version))
      .get()
  }

  getVideoTask(taskId: string): VideoTaskRow {
    const task = this.database.db.select().from(videoTasks).where(eq(videoTasks.id, taskId)).get()
    if (!task) throw new NotFoundError('Video task not found')
    return task
  }

  listRecoverableVideoTasks(): VideoTaskRow[] {
    return this.database.db
      .select()
      .from(videoTasks)
      .where(inArray(videoTasks.status, ['submitting', 'queued', 'running', 'saving']))
      .all()
  }

  markVideoSubmitted(taskId: string, providerTaskId: string, providerStatus: string) {
    this.database.db
      .update(videoTasks)
      .set({
        status: providerStatus === 'RUNNING' ? 'running' : 'queued',
        providerTaskId,
        providerStatus,
        updatedAt: now(),
      })
      .where(eq(videoTasks.id, taskId))
      .run()
  }

  markSubmissionUnknown(taskId: string, error: string) {
    this.database.db
      .update(videoTasks)
      .set({ status: 'submission_unknown', error, updatedAt: now() })
      .where(eq(videoTasks.id, taskId))
      .run()
  }

  markVideoFailed(taskId: string, providerStatus: string | null, error: string) {
    const timestamp = now()
    this.database.db
      .update(videoTasks)
      .set({
        status: 'failed',
        providerStatus,
        error,
        updatedAt: timestamp,
        completedAt: timestamp,
      })
      .where(eq(videoTasks.id, taskId))
      .run()
  }

  markVideoPolled(
    taskId: string,
    status: 'queued' | 'running' | 'saving',
    providerStatus: string,
    temporaryVideoUrl?: string,
  ) {
    const timestamp = now()
    this.database.db
      .update(videoTasks)
      .set({
        status,
        providerStatus,
        lastPolledAt: timestamp,
        updatedAt: timestamp,
        ...(temporaryVideoUrl ? { temporaryVideoUrl } : {}),
      })
      .where(eq(videoTasks.id, taskId))
      .run()
  }

  markVideoPollAttempt(taskId: string) {
    const timestamp = now()
    this.database.db
      .update(videoTasks)
      .set({ lastPolledAt: timestamp, updatedAt: timestamp })
      .where(eq(videoTasks.id, taskId))
      .run()
  }

  markVideoSaveError(taskId: string, error: string) {
    this.database.db
      .update(videoTasks)
      .set({ status: 'saving', error, updatedAt: now() })
      .where(eq(videoTasks.id, taskId))
      .run()
  }

  markVideoSucceeded(taskId: string, localPath: string, mediaType: string) {
    const timestamp = now()
    this.database.db
      .update(videoTasks)
      .set({
        status: 'succeeded',
        localPath,
        mediaType,
        error: null,
        updatedAt: timestamp,
        completedAt: timestamp,
      })
      .where(eq(videoTasks.id, taskId))
      .run()
  }

  prepareSelection(storyId: string, turnId: string, input: ChooseRequest) {
    return this.database.db.transaction((transaction) => {
      const story = transaction.select().from(stories).where(eq(stories.id, storyId)).get()
      if (!story) throw new NotFoundError('Story not found')
      const turn = transaction
        .select()
        .from(storyTurns)
        .where(and(eq(storyTurns.id, turnId), eq(storyTurns.storyId, storyId)))
        .get()
      if (!turn) throw new NotFoundError('Story turn not found')

      const latestVideo = transaction
        .select()
        .from(videoTasks)
        .where(eq(videoTasks.turnId, turnId))
        .orderBy(desc(videoTasks.version))
        .get()
      if (latestVideo?.status !== 'succeeded') {
        throw new ConflictError(
          'The current turn video must succeed before continuing the story',
          'VIDEO_NOT_READY',
        )
      }

      const existing = transaction
        .select()
        .from(selections)
        .where(eq(selections.turnId, turnId))
        .get()
      if (existing) {
        if (existing.status === 'complete') return { selection: existing, action: 'complete' as const }
        if (existing.status === 'generating') return { selection: existing, action: 'generating' as const }
        transaction
          .update(selections)
          .set({ status: 'generating', error: null, updatedAt: now() })
          .where(eq(selections.id, existing.id))
          .run()
        return { selection: { ...existing, status: 'generating' as const }, action: 'generate' as const }
      }

      if (story.currentTurnId !== turnId) {
        throw new ConflictError('Only the current story turn can be continued', 'TURN_NOT_CURRENT')
      }

      let userDirection: string
      let source: 'preset' | 'custom'
      let choiceId: string | null
      if (input.choice_id) {
        const selectedChoice = transaction
          .select()
          .from(choices)
          .where(and(eq(choices.id, input.choice_id), eq(choices.turnId, turnId)))
          .get()
        if (!selectedChoice) {
          throw new ConflictError('The selected choice does not belong to this turn', 'INVALID_CHOICE')
        }
        userDirection = selectedChoice.direction
        source = 'preset'
        choiceId = selectedChoice.id
      } else {
        userDirection = input.custom_direction!.trim()
        source = 'custom'
        choiceId = null
      }

      const timestamp = now()
      const selection: SelectionRow = {
        id: randomUUID(),
        turnId,
        userDirection,
        source,
        choiceId,
        nextTurnId: null,
        status: 'generating',
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      transaction.insert(selections).values(selection).run()
      return { selection, action: 'generate' as const }
    })
  }

  completeSelection(storyId: string, selectionId: string, output: StoryModelOutput): StoryResponse {
    this.database.db.transaction((transaction) => {
      const selection = transaction
        .select()
        .from(selections)
        .where(eq(selections.id, selectionId))
        .get()
      if (!selection) throw new NotFoundError('Selection not found')
      if (selection.nextTurnId) return

      const nextTurnId = randomUUID()
      const timestamp = now()
      transaction
        .insert(storyTurns)
        .values({
          id: nextTurnId,
          storyId,
          parentTurnId: selection.turnId,
          title: output.title,
          storyText: output.story_text,
          summary: output.summary,
          videoPrompt: output.video_prompt,
          createdAt: timestamp,
        })
        .run()
      transaction
        .insert(choices)
        .values(
          output.next_choices.map((choice, index) => ({
            id: randomUUID(),
            turnId: nextTurnId,
            position: index + 1,
            label: choice.label,
            direction: choice.direction,
          })),
        )
        .run()
      transaction
        .update(selections)
        .set({ status: 'complete', nextTurnId, updatedAt: timestamp })
        .where(eq(selections.id, selection.id))
        .run()
      transaction
        .update(stories)
        .set({
          title: output.title,
          currentTurnId: nextTurnId,
          charactersJson: JSON.stringify(output.characters),
          sceneJson: JSON.stringify(output.scene),
          updatedAt: timestamp,
        })
        .where(eq(stories.id, storyId))
        .run()
    })

    return this.getStory(storyId)
  }

  failSelection(selectionId: string, error: string) {
    this.database.db
      .update(selections)
      .set({ status: 'failed', error, updatedAt: now() })
      .where(eq(selections.id, selectionId))
      .run()
  }

  toVideoResponse(turnId: string, task = this.getLatestVideoTask(turnId)): VideoTaskResponse {
    if (!task) {
      return {
        id: null,
        turn_id: turnId,
        version: 1,
        status: 'idle',
        task_id: null,
        provider_status: null,
        resolution: '1280*720',
        duration: 5,
        video_url: null,
        media_type: null,
        error: null,
        created_at: null,
        updated_at: null,
      }
    }

    return {
      id: task.id,
      turn_id: task.turnId,
      version: task.version,
      status: task.status,
      task_id: task.providerTaskId,
      provider_status: task.providerStatus,
      resolution: task.resolution,
      duration: task.duration,
      video_url: task.localPath ? `/media/${encodeURIComponent(task.localPath)}` : null,
      media_type: task.mediaType,
      error: task.error,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    }
  }

  private toSelectionResponse(selection: SelectionRow) {
    return {
      id: selection.id,
      turn_id: selection.turnId,
      user_direction: selection.userDirection,
      source: selection.source,
      choice_id: selection.choiceId,
      next_turn_id: selection.nextTurnId,
      status: selection.status,
      created_at: selection.createdAt,
    }
  }
}
