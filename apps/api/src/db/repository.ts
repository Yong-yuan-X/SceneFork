import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  CharacterSchema,
  SceneSchema,
  type ChooseRequest,
  type ProviderMode,
  type StoryListResponse,
  type StoryModelOutput,
  type StoryResponse,
  type VideoStatus,
  type VideoTaskResponse,
} from '@scenefork/shared'
import { ConflictError, NotFoundError } from '../errors.js'
import type { SceneForkDatabase } from './database.js'
import {
  branchTurnOverrides,
  choices,
  selections,
  stories,
  storyBranches,
  storyTurns,
  turnContentVersions,
  videoTasks,
  type SelectionRow,
  type StoryBranchRow,
  type StoryTurnRow,
  type TurnContentVersionRow,
  type VideoTaskRow,
} from './schema.js'

const ACTIVE_VIDEO_STATUSES: VideoStatus[] = ['submitting', 'queued', 'running', 'saving']
const now = () => new Date().toISOString()
type ProviderModes = { story: ProviderMode; video: ProviderMode }

export class Repository {
  constructor(
    private readonly database: SceneForkDatabase,
    private readonly providerModes: ProviderMode | (() => ProviderModes),
    private readonly mediaDir?: string,
  ) {}

  createStory(idea: string, output: StoryModelOutput): StoryResponse {
    const storyId = randomUUID()
    const turnId = randomUUID()
    const branchId = randomUUID()
    const versionId = randomUUID()
    const timestamp = now()

    this.database.db.transaction((transaction) => {
      transaction.insert(stories).values({
        id: storyId,
        originalIdea: idea,
        title: output.title,
        charactersJson: JSON.stringify(output.characters),
        sceneJson: JSON.stringify(output.scene),
        currentTurnId: turnId,
        activeBranchId: branchId,
        draftNumber: null,
        coverPath: null,
        coverKind: 'placeholder',
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run()
      transaction.insert(storyTurns).values({
        id: turnId,
        storyId,
        parentTurnId: null,
        title: output.title,
        storyText: output.story_text,
        summary: output.summary,
        videoPrompt: output.video_prompt,
        createdAt: timestamp,
      }).run()
      transaction.insert(storyBranches).values({
        id: branchId,
        storyId,
        name: 'Main',
        forkedFromBranchId: null,
        forkedAtTurnId: null,
        headTurnId: turnId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run()
      transaction.insert(turnContentVersions).values({
        id: versionId,
        turnId,
        version: 1,
        title: output.title,
        storyText: output.story_text,
        summary: output.summary,
        videoPrompt: output.video_prompt,
        charactersJson: JSON.stringify(output.characters),
        sceneJson: JSON.stringify(output.scene),
        createdAt: timestamp,
      }).run()
      transaction.insert(branchTurnOverrides).values({
        branchId,
        turnId,
        contentVersionId: versionId,
        selectedVideoTaskId: null,
        status: 'normal',
        triggeredByVersionId: null,
        updatedAt: timestamp,
      }).run()
      transaction.insert(choices).values(output.next_choices.map((choice, index) => ({
        id: randomUUID(),
        turnId,
        position: index + 1,
        label: choice.label,
        direction: choice.direction,
      }))).run()
    })
    return this.getStory(storyId, branchId)
  }

  listStories(page = 1, pageSize = 9): StoryListResponse {
    const offset = (page - 1) * pageSize
    const candidates = this.database.sqlite.prepare(`
      SELECT story.id, story.title, story.original_idea, story.active_branch_id,
        story.current_turn_id, story.cover_path, story.cover_kind,
        story.created_at, story.updated_at, task.local_path
      FROM stories AS story
      JOIN story_turns AS turn ON turn.story_id = story.id
      JOIN video_tasks AS task ON task.turn_id = turn.id
      WHERE task.status = 'succeeded'
        AND task.provider_mode = 'real'
        AND task.local_path IS NOT NULL
        AND task.media_type LIKE 'video/%'
      ORDER BY story.created_at ASC, story.rowid ASC
    `).all() as Array<{
      id: string
      title: string
      original_idea: string
      active_branch_id: string
      current_turn_id: string
      cover_path: string | null
      cover_kind: 'real' | 'mock' | 'placeholder'
      created_at: string
      updated_at: string
      local_path: string
    }>
    const seen = new Set<string>()
    const validDrafts = candidates.filter((row) => {
      if (seen.has(row.id)) return false
      const mediaExists = !this.mediaDir || fs.existsSync(path.join(this.mediaDir, row.local_path))
      if (!mediaExists) return false
      seen.add(row.id)
      return true
    })
    const total = validDrafts.length
    const rows = validDrafts.slice(offset, offset + pageSize)
    return {
      items: rows.map((row, index) => {
        const draftNumber = offset + index + 1
        return {
        id: row.id,
        draft_number: draftNumber,
        name: `draft${draftNumber}`,
        title: row.title,
        original_idea: row.original_idea,
        current_branch_id: row.active_branch_id,
        current_turn_id: row.current_turn_id,
        cover_url: row.cover_path ? `/media/${encodeURIComponent(row.cover_path)}` : null,
        cover_kind: row.cover_kind,
        created_at: row.created_at,
        updated_at: row.updated_at,
        }
      }),
      page,
      page_size: pageSize,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
    }
  }

  getStory(storyId: string, requestedBranchId?: string): StoryResponse {
    const story = this.database.db.select().from(stories).where(eq(stories.id, storyId)).get()
    if (!story) throw new NotFoundError('Story not found')
    const branchId = requestedBranchId ?? story.activeBranchId
    if (!branchId) throw new NotFoundError('Story branch not found')
    const branch = this.getBranch(storyId, branchId)
    const allTurns = this.database.db.select().from(storyTurns)
      .where(eq(storyTurns.storyId, storyId)).orderBy(asc(storyTurns.createdAt)).all()
    const pathIds = this.pathIds(allTurns, branch.headTurnId)
    const pathSet = new Set(pathIds)
    const turnIds = allTurns.map((turn) => turn.id)
    const storyChoices = turnIds.length
      ? this.database.db.select().from(choices).where(inArray(choices.turnId, turnIds)).all()
      : []
    const allSelections = turnIds.length
      ? this.database.db.select().from(selections).where(inArray(selections.turnId, turnIds)).all()
      : []
    const tasks = turnIds.length
      ? this.database.db.select().from(videoTasks).where(inArray(videoTasks.turnId, turnIds))
          .orderBy(desc(videoTasks.version)).all()
      : []
    const overrides = this.database.db.select().from(branchTurnOverrides)
      .where(eq(branchTurnOverrides.branchId, branchId)).all()
    const overrideByTurn = new Map(overrides.map((item) => [item.turnId, item]))
    const allVersions = turnIds.length
      ? this.database.db.select().from(turnContentVersions)
          .where(inArray(turnContentVersions.turnId, turnIds)).all()
      : []
    const versionById = new Map(allVersions.map((version) => [version.id, version]))
    const firstVersionByTurn = new Map<string, TurnContentVersionRow>()
    for (const version of [...allVersions].sort((left, right) => left.version - right.version)) {
      if (!firstVersionByTurn.has(version.turnId)) firstVersionByTurn.set(version.turnId, version)
    }
    const branches = this.database.db.select().from(storyBranches)
      .where(eq(storyBranches.storyId, storyId)).orderBy(asc(storyBranches.createdAt)).all()
    const selectedHeadVersion = this.resolveVersion(branch.headTurnId, overrideByTurn, versionById, firstVersionByTurn)
    const modes = this.getProviderModes()

    const mapTurn = (turn: StoryTurnRow, active: boolean) => {
      const override = active ? overrideByTurn.get(turn.id) : undefined
      const content = this.resolveVersion(turn.id, overrideByTurn, versionById, firstVersionByTurn, active)
      const history = tasks.filter((task) => task.turnId === turn.id)
      const selectedTask = override?.selectedVideoTaskId
        ? history.find((task) => task.id === override.selectedVideoTaskId)
        : undefined
      return {
        id: turn.id,
        story_id: turn.storyId,
        parent_turn_id: turn.parentTurnId,
        title: content.title,
        story_text: content.storyText,
        summary: content.summary,
        video_prompt: content.videoPrompt,
        created_at: turn.createdAt,
        content_version_id: content.id,
        content_version: content.version,
        branch_status: override?.status ?? 'normal' as const,
        stale_reason_version_id: override?.triggeredByVersionId ?? null,
        choices: storyChoices.filter((choice) => choice.turnId === turn.id)
          .sort((left, right) => left.position - right.position)
          .map((choice) => ({
            id: choice.id,
            position: choice.position,
            label: choice.label,
            direction: choice.direction,
          })),
        video: this.toVideoResponse(turn.id, selectedTask, override?.selectedVideoTaskId ?? null),
        video_history: history.map((task) =>
          this.toVideoResponse(turn.id, task, override?.selectedVideoTaskId ?? null)),
      }
    }
    const treeTurns = allTurns.map((turn) => mapTurn(turn, pathSet.has(turn.id)))
    const pathTurns = pathIds.map((turnId) => treeTurns.find((turn) => turn.id === turnId)!)

    return {
      id: story.id,
      original_idea: story.originalIdea,
      title: selectedHeadVersion.title,
      current_turn_id: branch.headTurnId,
      current_branch_id: branch.id,
      characters: CharacterSchema.array().parse(JSON.parse(selectedHeadVersion.charactersJson)),
      scene: SceneSchema.parse(JSON.parse(selectedHeadVersion.sceneJson)),
      created_at: story.createdAt,
      updated_at: story.updatedAt,
      provider_mode: modes.story,
      provider_modes: modes,
      turns: pathTurns,
      tree_turns: treeTurns,
      branches: branches.map((item) => ({
        id: item.id,
        story_id: item.storyId,
        name: item.name,
        forked_from_branch_id: item.forkedFromBranchId,
        forked_at_turn_id: item.forkedAtTurnId,
        head_turn_id: item.headTurnId,
        path_turn_ids: this.pathIds(allTurns, item.headTurnId),
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })),
      selections: allSelections.map((selection) => this.toSelectionResponse(selection)),
    }
  }

  deleteStory(storyId: string) {
    const story = this.database.db.select().from(stories).where(eq(stories.id, storyId)).get()
    if (!story) throw new NotFoundError('Story not found')
    this.database.db.delete(stories).where(eq(stories.id, storyId)).run()
  }

  getTurn(storyId: string, turnId: string) {
    const turn = this.database.db.select().from(storyTurns)
      .where(and(eq(storyTurns.id, turnId), eq(storyTurns.storyId, storyId))).get()
    if (!turn) throw new NotFoundError('Story turn not found')
    return turn
  }

  updateTurn(
    storyId: string,
    turnId: string,
    patch: { branch_id?: string; story_text?: string; video_prompt?: string },
  ): StoryResponse {
    this.getTurn(storyId, turnId)
    const branch = this.resolveBranch(storyId, patch.branch_id)
    const path = this.getBranchPath(storyId, branch.id)
    if (!path.some((turn) => turn.id === turnId)) {
      throw new ConflictError('The turn is not part of this branch', 'TURN_NOT_IN_BRANCH')
    }
    const selected = this.getSelectedContentVersion(branch.id, turnId)
    const nextVersion = (this.database.db.select().from(turnContentVersions)
      .where(eq(turnContentVersions.turnId, turnId)).orderBy(desc(turnContentVersions.version)).get()?.version ?? 0) + 1
    const versionId = randomUUID()
    const timestamp = now()
    const storyText = patch.story_text ?? selected.storyText
    const storyChanged = storyText !== selected.storyText
    this.database.db.transaction((transaction) => {
      transaction.insert(turnContentVersions).values({
        id: versionId,
        turnId,
        version: nextVersion,
        title: selected.title,
        storyText,
        summary: selected.summary,
        videoPrompt: patch.video_prompt ?? selected.videoPrompt,
        charactersJson: selected.charactersJson,
        sceneJson: selected.sceneJson,
        createdAt: timestamp,
      }).run()
      transaction.update(branchTurnOverrides).set({
        contentVersionId: versionId,
        selectedVideoTaskId: null,
        updatedAt: timestamp,
      }).where(and(
        eq(branchTurnOverrides.branchId, branch.id),
        eq(branchTurnOverrides.turnId, turnId),
      )).run()
      if (storyChanged) {
        const turnIndex = path.findIndex((turn) => turn.id === turnId)
        for (const downstream of path.slice(turnIndex + 1)) {
          transaction.update(branchTurnOverrides).set({
            status: 'stale',
            triggeredByVersionId: versionId,
            updatedAt: timestamp,
          }).where(and(
            eq(branchTurnOverrides.branchId, branch.id),
            eq(branchTurnOverrides.turnId, downstream.id),
          )).run()
        }
      }
      transaction.update(stories).set({ updatedAt: timestamp }).where(eq(stories.id, storyId)).run()
    })
    return this.getStory(storyId, branch.id)
  }

  createGeneratedTurnVersion(
    storyId: string,
    branchId: string,
    turnId: string,
    output: StoryModelOutput,
  ): StoryResponse {
    this.getTurn(storyId, turnId)
    const branch = this.getBranch(storyId, branchId)
    const path = this.getBranchPath(storyId, branch.id)
    const turnIndex = path.findIndex((turn) => turn.id === turnId)
    if (turnIndex < 0) {
      throw new ConflictError('The turn is not part of this branch', 'TURN_NOT_IN_BRANCH')
    }
    const nextVersion = (this.database.db.select().from(turnContentVersions)
      .where(eq(turnContentVersions.turnId, turnId))
      .orderBy(desc(turnContentVersions.version)).get()?.version ?? 0) + 1
    const versionId = randomUUID()
    const timestamp = now()
    this.database.db.transaction((transaction) => {
      transaction.insert(turnContentVersions).values({
        id: versionId,
        turnId,
        version: nextVersion,
        title: output.title,
        storyText: output.story_text,
        summary: output.summary,
        videoPrompt: output.video_prompt,
        charactersJson: JSON.stringify(output.characters),
        sceneJson: JSON.stringify(output.scene),
        createdAt: timestamp,
      }).run()
      transaction.update(branchTurnOverrides).set({
        contentVersionId: versionId,
        selectedVideoTaskId: null,
        status: 'normal',
        triggeredByVersionId: null,
        updatedAt: timestamp,
      }).where(and(
        eq(branchTurnOverrides.branchId, branch.id),
        eq(branchTurnOverrides.turnId, turnId),
      )).run()
      for (const downstream of path.slice(turnIndex + 1)) {
        transaction.update(branchTurnOverrides).set({
          status: 'stale',
          triggeredByVersionId: versionId,
          updatedAt: timestamp,
        }).where(and(
          eq(branchTurnOverrides.branchId, branch.id),
          eq(branchTurnOverrides.turnId, downstream.id),
        )).run()
      }
      transaction.update(stories).set({ updatedAt: timestamp })
        .where(eq(stories.id, storyId)).run()
    })
    this.syncStoryCover(storyId)
    return this.getStory(storyId, branch.id)
  }

  listContentVersions(storyId: string, turnId: string) {
    this.getTurn(storyId, turnId)
    return this.database.db.select().from(turnContentVersions)
      .where(eq(turnContentVersions.turnId, turnId)).orderBy(desc(turnContentVersions.version)).all()
      .map((version) => ({
        id: version.id,
        turn_id: version.turnId,
        version: version.version,
        title: version.title,
        story_text: version.storyText,
        summary: version.summary,
        video_prompt: version.videoPrompt,
        created_at: version.createdAt,
      }))
  }

  selectVersion(storyId: string, branchId: string, turnId: string, input: {
    content_version_id?: string
    video_task_id?: string | null
  }) {
    this.getBranch(storyId, branchId)
    const path = this.getBranchPath(storyId, branchId)
    const turnIndex = path.findIndex((turn) => turn.id === turnId)
    if (turnIndex < 0) throw new ConflictError('The turn is not part of this branch', 'TURN_NOT_IN_BRANCH')
    const timestamp = now()
    if (input.content_version_id) {
      const version = this.database.db.select().from(turnContentVersions).where(and(
        eq(turnContentVersions.id, input.content_version_id),
        eq(turnContentVersions.turnId, turnId),
      )).get()
      if (!version) throw new NotFoundError('Content version not found')
      this.database.db.update(branchTurnOverrides).set({
        contentVersionId: version.id,
        selectedVideoTaskId: null,
        updatedAt: timestamp,
      }).where(and(
        eq(branchTurnOverrides.branchId, branchId),
        eq(branchTurnOverrides.turnId, turnId),
      )).run()
      for (const downstream of path.slice(turnIndex + 1)) {
        this.database.db.update(branchTurnOverrides).set({
          status: version.version === 1 ? 'normal' : 'stale',
          triggeredByVersionId: version.version === 1 ? null : version.id,
          updatedAt: timestamp,
        }).where(and(
          eq(branchTurnOverrides.branchId, branchId),
          eq(branchTurnOverrides.turnId, downstream.id),
        )).run()
      }
    }
    if (input.video_task_id !== undefined) {
      if (input.video_task_id) {
        const task = this.database.db.select().from(videoTasks).where(and(
          eq(videoTasks.id, input.video_task_id), eq(videoTasks.turnId, turnId),
        )).get()
        if (!task) throw new NotFoundError('Video version not found')
      }
      this.database.db.update(branchTurnOverrides).set({
        selectedVideoTaskId: input.video_task_id,
        updatedAt: timestamp,
      }).where(and(
        eq(branchTurnOverrides.branchId, branchId),
        eq(branchTurnOverrides.turnId, turnId),
      )).run()
    }
    this.syncStoryCover(storyId)
    return this.getStory(storyId, branchId)
  }

  confirmTurn(storyId: string, branchId: string, turnId: string) {
    this.getTurn(storyId, turnId)
    this.database.db.update(branchTurnOverrides).set({
      status: 'normal', triggeredByVersionId: null, updatedAt: now(),
    }).where(and(
      eq(branchTurnOverrides.branchId, branchId),
      eq(branchTurnOverrides.turnId, turnId),
    )).run()
    return this.getStory(storyId, branchId)
  }

  createBranch(storyId: string, sourceBranchId: string, fromTurnId: string, name?: string) {
    const branch = this.createBranchRow(storyId, sourceBranchId, fromTurnId, name)
    this.activateBranch(storyId, branch.id)
    return this.getStory(storyId, branch.id)
  }

  activateBranch(storyId: string, branchId: string) {
    const branch = this.getBranch(storyId, branchId)
    const head = this.getSelectedContentVersion(branch.id, branch.headTurnId)
    this.database.db.update(stories).set({
      activeBranchId: branch.id,
      currentTurnId: branch.headTurnId,
      title: head.title,
      charactersJson: head.charactersJson,
      sceneJson: head.sceneJson,
      updatedAt: now(),
    }).where(eq(stories.id, storyId)).run()
    this.syncStoryCover(storyId)
    return this.getStory(storyId, branch.id)
  }

  renameBranch(storyId: string, branchId: string, name: string) {
    this.getBranch(storyId, branchId)
    this.database.db.update(storyBranches).set({ name, updatedAt: now() })
      .where(eq(storyBranches.id, branchId)).run()
    return this.getStory(storyId)
  }

  deleteBranch(storyId: string, branchId: string): StoryResponse {
    const story = this.database.db.select().from(stories).where(eq(stories.id, storyId)).get()
    if (!story) throw new NotFoundError('Story not found')
    const branch = this.getBranch(storyId, branchId)
    if (!branch.forkedFromBranchId) {
      throw new ConflictError('The Main branch cannot be deleted', 'MAIN_BRANCH_DELETE_FORBIDDEN')
    }

    const allBranches = this.database.db.select().from(storyBranches)
      .where(eq(storyBranches.storyId, storyId)).orderBy(asc(storyBranches.createdAt)).all()
    const remainingBranches = allBranches.filter((item) => item.id !== branch.id)
    const fallback = remainingBranches.find((item) => !item.forkedFromBranchId)
      ?? remainingBranches[0]
    if (!fallback) throw new ConflictError('A story must keep at least one branch')

    const allTurns = this.database.db.select().from(storyTurns)
      .where(eq(storyTurns.storyId, storyId)).all()
    const deletedPathIds = this.pathIds(allTurns, branch.headTurnId)
    const retainedTurnIds = new Set(
      remainingBranches.flatMap((item) => this.pathIds(allTurns, item.headTurnId)),
    )
    const exclusiveTurnIds = deletedPathIds.filter((turnId) => !retainedTurnIds.has(turnId))
    const fallbackHead = this.getSelectedContentVersion(fallback.id, fallback.headTurnId)
    const timestamp = now()
    const deletingActiveBranch = story.activeBranchId === branch.id

    this.database.db.transaction((transaction) => {
      transaction.update(storyBranches).set({
        forkedFromBranchId: branch.forkedFromBranchId,
        updatedAt: timestamp,
      }).where(eq(storyBranches.forkedFromBranchId, branch.id)).run()
      if (exclusiveTurnIds.length) {
        transaction.delete(selections)
          .where(inArray(selections.nextTurnId, exclusiveTurnIds)).run()
      }
      transaction.delete(storyBranches).where(eq(storyBranches.id, branch.id)).run()
      if (exclusiveTurnIds.length) {
        transaction.delete(storyTurns).where(inArray(storyTurns.id, exclusiveTurnIds)).run()
      }
      transaction.update(stories).set(deletingActiveBranch
        ? {
            activeBranchId: fallback.id,
            currentTurnId: fallback.headTurnId,
            title: fallbackHead.title,
            charactersJson: fallbackHead.charactersJson,
            sceneJson: fallbackHead.sceneJson,
            updatedAt: timestamp,
          }
        : { updatedAt: timestamp })
        .where(eq(stories.id, storyId)).run()
    })

    this.syncStoryCover(storyId)
    return this.getStory(storyId, deletingActiveBranch
      ? fallback.id
      : story.activeBranchId ?? fallback.id)
  }

  beginVideoTask(input: {
    storyId: string
    branchId?: string
    turnId: string
    resolution: string
    duration: number
    confirmSubmissionUnknown: boolean
    regenerate: boolean
    idempotencyKey?: string
    providerMode: ProviderMode
    credentialFingerprint: string | null
    credentialSource: string
    mockOutcome?: 'success' | 'failure' | 'unknown'
  }): { task: VideoTaskRow; created: boolean; branchId: string } {
    this.getTurn(input.storyId, input.turnId)
    const branch = this.resolveBranch(input.storyId, input.branchId)
    const content = this.getSelectedContentVersion(branch.id, input.turnId)
    const override = this.getOverride(branch.id, input.turnId)
    if (input.idempotencyKey) {
      const exact = this.database.db.select().from(videoTasks)
        .where(eq(videoTasks.requestId, input.idempotencyKey)).get()
      if (exact) return { task: exact, created: false, branchId: branch.id }
    }
    const selected = override.selectedVideoTaskId
      ? this.database.db.select().from(videoTasks).where(eq(videoTasks.id, override.selectedVideoTaskId)).get()
      : undefined
    if (selected?.status === 'submission_unknown' && !input.confirmSubmissionUnknown) {
      throw new ConflictError(
        'The previous submission result is unknown and requires explicit confirmation',
        'SUBMISSION_UNKNOWN_CONFIRMATION_REQUIRED',
      )
    }
    if (selected && (ACTIVE_VIDEO_STATUSES.includes(selected.status) ||
      (selected.status === 'succeeded' && !input.regenerate))) {
      return { task: selected, created: false, branchId: branch.id }
    }
    const matching = this.database.db.select().from(videoTasks).where(and(
      eq(videoTasks.turnId, input.turnId), eq(videoTasks.contentVersionId, content.id),
    )).orderBy(desc(videoTasks.version)).get()
    if (!input.regenerate && matching &&
      (ACTIVE_VIDEO_STATUSES.includes(matching.status) || matching.status === 'succeeded')) {
      this.selectVideoTask(branch.id, input.turnId, matching.id)
      return { task: matching, created: false, branchId: branch.id }
    }

    return this.database.db.transaction((transaction) => {
      const latest = transaction.select().from(videoTasks)
        .where(eq(videoTasks.turnId, input.turnId)).orderBy(desc(videoTasks.version)).get()
      const timestamp = now()
      const task: typeof videoTasks.$inferInsert = {
        id: randomUUID(),
        turnId: input.turnId,
        version: (latest?.version ?? 0) + 1,
        status: 'submitting',
        providerTaskId: null,
        providerStatus: null,
        lastPolledAt: null,
        requestId: input.idempotencyKey ?? randomUUID(),
        resolution: input.resolution,
        duration: input.duration,
        error: null,
        temporaryVideoUrl: null,
        localPath: null,
        coverPath: null,
        mediaType: null,
        mockOutcome: input.mockOutcome ?? null,
        contentVersionId: content.id,
        promptSnapshot: content.videoPrompt,
        credentialFingerprint: input.credentialFingerprint,
        credentialSource: input.credentialSource,
        providerMode: input.providerMode,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      }
      transaction.insert(videoTasks).values(task).run()
      transaction.update(branchTurnOverrides).set({
        selectedVideoTaskId: task.id,
        updatedAt: timestamp,
      }).where(and(
        eq(branchTurnOverrides.branchId, branch.id),
        eq(branchTurnOverrides.turnId, input.turnId),
      )).run()
      return { task: task as VideoTaskRow, created: true, branchId: branch.id }
    })
  }

  getLatestVideoTask(turnId: string): VideoTaskRow | undefined {
    return this.database.db.select().from(videoTasks).where(eq(videoTasks.turnId, turnId))
      .orderBy(desc(videoTasks.version)).get()
  }

  getSelectedVideoTask(storyId: string, turnId: string, branchId?: string) {
    const branch = this.resolveBranch(storyId, branchId)
    const override = this.getOverride(branch.id, turnId)
    return override.selectedVideoTaskId
      ? this.database.db.select().from(videoTasks).where(eq(videoTasks.id, override.selectedVideoTaskId)).get()
      : undefined
  }

  listVideoTasks(storyId: string, turnId: string) {
    this.getTurn(storyId, turnId)
    return this.database.db.select().from(videoTasks).where(eq(videoTasks.turnId, turnId))
      .orderBy(desc(videoTasks.version)).all()
  }

  getCoverCandidate(storyId: string) {
    const story = this.getStory(storyId)
    for (const turn of story.turns) {
      if (turn.video.id && turn.video.status === 'succeeded' && turn.video.media_type?.startsWith('video/')) {
        const task = this.getVideoTask(turn.video.id)
        if (task.localPath) return task
      }
    }
    return null
  }

  listVideoCoverCandidates(): Array<{ taskId: string; storyId: string; localPath: string }> {
    return this.database.sqlite.prepare(`
      SELECT video_tasks.id AS task_id, story_turns.story_id, video_tasks.local_path
      FROM video_tasks
      JOIN story_turns ON story_turns.id = video_tasks.turn_id
      WHERE video_tasks.status = 'succeeded'
        AND video_tasks.local_path IS NOT NULL
        AND video_tasks.media_type LIKE 'video/%'
        AND video_tasks.cover_path IS NULL
      ORDER BY video_tasks.created_at ASC
    `).all().map((row) => {
      const candidate = row as { task_id: string; story_id: string; local_path: string }
      return {
        taskId: candidate.task_id,
        storyId: candidate.story_id,
        localPath: candidate.local_path,
      }
    })
  }

  listStoryIdsMissingCovers(): string[] {
    return (this.database.sqlite.prepare(`
      SELECT id FROM stories WHERE cover_path IS NULL ORDER BY created_at ASC, rowid ASC
    `).all() as Array<{ id: string }>).map((row) => row.id)
  }

  setVideoTaskCover(taskId: string, coverPath: string) {
    this.database.db.update(videoTasks).set({ coverPath, updatedAt: now() })
      .where(eq(videoTasks.id, taskId)).run()
  }

  setStoryCover(storyId: string, coverPath: string | null) {
    this.database.db.update(stories).set({
      coverPath,
      coverKind: coverPath ? 'real' : 'placeholder',
      updatedAt: now(),
    }).where(eq(stories.id, storyId)).run()
  }

  syncStoryCover(storyId: string) {
    const candidate = this.getCoverCandidate(storyId)
    this.setStoryCover(storyId, candidate?.coverPath ?? null)
  }

  getVideoTask(taskId: string): VideoTaskRow {
    const task = this.database.db.select().from(videoTasks).where(eq(videoTasks.id, taskId)).get()
    if (!task) throw new NotFoundError('Video task not found')
    return task
  }

  listRecoverableVideoTasks(): VideoTaskRow[] {
    return this.database.db.select().from(videoTasks)
      .where(inArray(videoTasks.status, ['submitting', 'queued', 'running', 'saving'])).all()
  }

  markVideoSubmitted(taskId: string, providerTaskId: string, providerStatus: string) {
    this.database.db.update(videoTasks).set({
      status: providerStatus === 'RUNNING' ? 'running' : 'queued',
      providerTaskId, providerStatus, updatedAt: now(),
    }).where(eq(videoTasks.id, taskId)).run()
  }

  markSubmissionUnknown(taskId: string, error: string) {
    this.database.db.update(videoTasks).set({ status: 'submission_unknown', error, updatedAt: now() })
      .where(eq(videoTasks.id, taskId)).run()
  }

  markVideoPausedForCredential(taskId: string) {
    this.database.db.update(videoTasks).set({
      status: 'submission_unknown',
      error: 'This task is paused until the same temporary Wan credential is supplied again',
      updatedAt: now(),
    }).where(eq(videoTasks.id, taskId)).run()
  }

  resumeTasksWithCredential(fingerprint: string | null) {
    if (!fingerprint) return 0
    const tasks = this.database.db.select().from(videoTasks).where(and(
      eq(videoTasks.status, 'submission_unknown'),
      eq(videoTasks.credentialFingerprint, fingerprint),
    )).all().filter((task) => task.error?.startsWith('This task is paused until the same temporary Wan credential'))
    for (const task of tasks) {
      const status = task.temporaryVideoUrl
        ? 'saving'
        : task.providerStatus === 'RUNNING'
          ? 'running'
          : 'queued'
      this.database.db.update(videoTasks).set({ status, error: null, updatedAt: now() })
        .where(eq(videoTasks.id, task.id)).run()
    }
    return tasks.length
  }

  markVideoFailed(taskId: string, providerStatus: string | null, error: string) {
    const timestamp = now()
    this.database.db.update(videoTasks).set({
      status: 'failed', providerStatus, error, updatedAt: timestamp, completedAt: timestamp,
    }).where(eq(videoTasks.id, taskId)).run()
  }

  markVideoPolled(taskId: string, status: 'queued' | 'running' | 'saving', providerStatus: string, temporaryVideoUrl?: string) {
    const timestamp = now()
    this.database.db.update(videoTasks).set({
      status, providerStatus, lastPolledAt: timestamp, updatedAt: timestamp,
      ...(temporaryVideoUrl ? { temporaryVideoUrl } : {}),
    }).where(eq(videoTasks.id, taskId)).run()
  }

  markVideoPollAttempt(taskId: string) {
    const timestamp = now()
    this.database.db.update(videoTasks).set({ lastPolledAt: timestamp, updatedAt: timestamp })
      .where(eq(videoTasks.id, taskId)).run()
  }

  markVideoSaveError(taskId: string, error: string) {
    this.database.db.update(videoTasks).set({ status: 'saving', error, updatedAt: now() })
      .where(eq(videoTasks.id, taskId)).run()
  }

  markVideoSucceeded(taskId: string, localPath: string, mediaType: string, coverPath?: string | null) {
    const timestamp = now()
    let storyId: string | null = null
    this.database.db.transaction((transaction) => {
      transaction.update(videoTasks).set({
        status: 'succeeded', localPath, coverPath: coverPath ?? null, mediaType, error: null,
        updatedAt: timestamp, completedAt: timestamp,
      }).where(eq(videoTasks.id, taskId)).run()
      const task = transaction.select().from(videoTasks).where(eq(videoTasks.id, taskId)).get()
      const turn = task
        ? transaction.select().from(storyTurns).where(eq(storyTurns.id, task.turnId)).get()
        : undefined
      if (turn) {
        storyId = turn.storyId
        const story = transaction.select().from(stories).where(eq(stories.id, turn.storyId)).get()
        if (coverPath && story && !story.coverPath) {
          transaction.update(stories).set({ coverPath, coverKind: 'real', updatedAt: timestamp })
            .where(eq(stories.id, story.id)).run()
        }
      }
    })
    if (storyId) this.syncStoryCover(storyId)
  }

  prepareSelection(storyId: string, turnId: string, input: ChooseRequest) {
    this.getTurn(storyId, turnId)
    let branch = this.resolveBranch(storyId, input.branch_id)
    const path = this.getBranchPath(storyId, branch.id)
    if (!path.some((turn) => turn.id === turnId)) {
      throw new ConflictError('The turn is not part of this branch', 'TURN_NOT_IN_BRANCH')
    }
    const selectedVideo = this.getSelectedVideoTask(storyId, turnId, branch.id)
    if (selectedVideo?.status !== 'succeeded') {
      throw new ConflictError('The current turn video must succeed before continuing the story', 'VIDEO_NOT_READY')
    }
    const direction = this.resolveDirection(turnId, input)
    const intentKey = normalizeIntent(direction.userDirection)
    const existing = this.database.db.select().from(selections).where(and(
      eq(selections.branchId, branch.id),
      eq(selections.turnId, turnId),
      eq(selections.intentKey, intentKey),
    )).get()
    if (existing) {
      this.activateBranch(storyId, existing.branchId)
      if (existing.status === 'complete') return { selection: existing, action: 'complete' as const }
      if (existing.status === 'generating') return { selection: existing, action: 'generating' as const }
      this.database.db.update(selections).set({ status: 'generating', error: null, updatedAt: now() })
        .where(eq(selections.id, existing.id)).run()
      return { selection: { ...existing, status: 'generating' as const }, action: 'generate' as const }
    }
    if (branch.headTurnId !== turnId) {
      branch = this.createBranchRow(storyId, branch.id, turnId)
      this.activateBranch(storyId, branch.id)
    }
    const timestamp = now()
    const selection: SelectionRow = {
      id: randomUUID(),
      turnId,
      branchId: branch.id,
      userDirection: direction.userDirection,
      source: direction.source,
      choiceId: direction.choiceId,
      intentKey,
      nextTurnId: null,
      status: 'generating',
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.database.db.insert(selections).values(selection).run()
    return { selection, action: 'generate' as const }
  }

  completeSelection(storyId: string, selectionId: string, output: StoryModelOutput): StoryResponse {
    let branchId = ''
    this.database.db.transaction((transaction) => {
      const selection = transaction.select().from(selections).where(eq(selections.id, selectionId)).get()
      if (!selection) throw new NotFoundError('Selection not found')
      branchId = selection.branchId
      if (selection.nextTurnId) return
      const nextTurnId = randomUUID()
      const versionId = randomUUID()
      const timestamp = now()
      transaction.insert(storyTurns).values({
        id: nextTurnId, storyId, parentTurnId: selection.turnId,
        title: output.title, storyText: output.story_text, summary: output.summary,
        videoPrompt: output.video_prompt, createdAt: timestamp,
      }).run()
      transaction.insert(turnContentVersions).values({
        id: versionId, turnId: nextTurnId, version: 1, title: output.title,
        storyText: output.story_text, summary: output.summary, videoPrompt: output.video_prompt,
        charactersJson: JSON.stringify(output.characters), sceneJson: JSON.stringify(output.scene),
        createdAt: timestamp,
      }).run()
      transaction.insert(branchTurnOverrides).values({
        branchId: selection.branchId, turnId: nextTurnId, contentVersionId: versionId,
        selectedVideoTaskId: null, status: 'normal', triggeredByVersionId: null, updatedAt: timestamp,
      }).run()
      transaction.insert(choices).values(output.next_choices.map((choice, index) => ({
        id: randomUUID(), turnId: nextTurnId, position: index + 1,
        label: choice.label, direction: choice.direction,
      }))).run()
      transaction.update(selections).set({ status: 'complete', nextTurnId, updatedAt: timestamp })
        .where(eq(selections.id, selection.id)).run()
      transaction.update(storyBranches).set({ headTurnId: nextTurnId, updatedAt: timestamp })
        .where(eq(storyBranches.id, selection.branchId)).run()
      transaction.update(stories).set({
        title: output.title, currentTurnId: nextTurnId, activeBranchId: selection.branchId,
        charactersJson: JSON.stringify(output.characters), sceneJson: JSON.stringify(output.scene),
        updatedAt: timestamp,
      }).where(eq(stories.id, storyId)).run()
    })
    return this.getStory(storyId, branchId)
  }

  failSelection(selectionId: string, error: string) {
    this.database.db.update(selections).set({ status: 'failed', error, updatedAt: now() })
      .where(eq(selections.id, selectionId)).run()
  }

  toVideoResponse(turnId: string, task?: VideoTaskRow, selectedTaskId: string | null = null): VideoTaskResponse {
    if (!task) return {
      id: null, turn_id: turnId, version: 1, status: 'idle', task_id: null,
      provider_status: null, resolution: '1280*720', duration: 5, video_url: null,
      cover_url: null, cover_kind: 'placeholder',
      media_type: null, error: null, created_at: null, updated_at: null,
      content_version_id: null, is_selected: false,
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
      cover_url: task.coverPath ? `/media/${encodeURIComponent(task.coverPath)}` : null,
      cover_kind: task.coverPath ? 'real' as const : 'placeholder' as const,
      media_type: task.mediaType,
      error: task.error,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      content_version_id: task.contentVersionId,
      is_selected: task.id === selectedTaskId,
    }
  }

  private getProviderModes(): ProviderModes {
    return typeof this.providerModes === 'function'
      ? this.providerModes()
      : { story: this.providerModes, video: this.providerModes }
  }

  private getBranch(storyId: string, branchId: string) {
    const branch = this.database.db.select().from(storyBranches).where(and(
      eq(storyBranches.id, branchId), eq(storyBranches.storyId, storyId),
    )).get()
    if (!branch) throw new NotFoundError('Story branch not found')
    return branch
  }

  private resolveBranch(storyId: string, branchId?: string) {
    if (branchId) return this.getBranch(storyId, branchId)
    const story = this.database.db.select().from(stories).where(eq(stories.id, storyId)).get()
    if (!story) throw new NotFoundError('Story not found')
    if (!story.activeBranchId) throw new NotFoundError('Story branch not found')
    return this.getBranch(storyId, story.activeBranchId)
  }

  private getBranchPath(storyId: string, branchId: string) {
    const branch = this.getBranch(storyId, branchId)
    const turns = this.database.db.select().from(storyTurns).where(eq(storyTurns.storyId, storyId)).all()
    const ids = this.pathIds(turns, branch.headTurnId)
    const byId = new Map(turns.map((turn) => [turn.id, turn]))
    return ids.map((id) => byId.get(id)!)
  }

  private pathIds(turns: StoryTurnRow[], headTurnId: string) {
    const byId = new Map(turns.map((turn) => [turn.id, turn]))
    const result: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = headTurnId
    while (cursor) {
      if (seen.has(cursor)) throw new ConflictError('Story path contains a cycle', 'INVALID_STORY_PATH')
      seen.add(cursor)
      const turn = byId.get(cursor)
      if (!turn) throw new ConflictError('Story path references a missing turn', 'INVALID_STORY_PATH')
      result.unshift(turn.id)
      cursor = turn.parentTurnId
    }
    return result
  }

  private createBranchRow(storyId: string, sourceBranchId: string, fromTurnId: string, name?: string): StoryBranchRow {
    const source = this.getBranch(storyId, sourceBranchId)
    const path = this.getBranchPath(storyId, source.id)
    const forkIndex = path.findIndex((turn) => turn.id === fromTurnId)
    if (forkIndex < 0) throw new ConflictError('Fork turn is not part of the source branch', 'TURN_NOT_IN_BRANCH')
    const branchCount = this.database.db.select().from(storyBranches)
      .where(eq(storyBranches.storyId, storyId)).all().length
    const timestamp = now()
    const branch: StoryBranchRow = {
      id: randomUUID(), storyId, name: name ?? `Branch ${branchCount + 1}`,
      forkedFromBranchId: source.id, forkedAtTurnId: fromTurnId, headTurnId: fromTurnId,
      createdAt: timestamp, updatedAt: timestamp,
    }
    const sourceOverrides = this.database.db.select().from(branchTurnOverrides)
      .where(eq(branchTurnOverrides.branchId, source.id)).all()
    const sourceByTurn = new Map(sourceOverrides.map((item) => [item.turnId, item]))
    this.database.db.transaction((transaction) => {
      transaction.insert(storyBranches).values(branch).run()
      for (const turn of path.slice(0, forkIndex + 1)) {
        const selected = sourceByTurn.get(turn.id)
        if (!selected) throw new ConflictError('Source branch version mapping is incomplete', 'INVALID_STORY_PATH')
        transaction.insert(branchTurnOverrides).values({
          branchId: branch.id, turnId: turn.id, contentVersionId: selected.contentVersionId,
          selectedVideoTaskId: selected.selectedVideoTaskId, status: selected.status,
          triggeredByVersionId: selected.triggeredByVersionId, updatedAt: timestamp,
        }).run()
      }
    })
    return branch
  }

  private getOverride(branchId: string, turnId: string) {
    const result = this.database.db.select().from(branchTurnOverrides).where(and(
      eq(branchTurnOverrides.branchId, branchId), eq(branchTurnOverrides.turnId, turnId),
    )).get()
    if (!result) throw new ConflictError('Branch version mapping is missing', 'INVALID_STORY_PATH')
    return result
  }

  private getSelectedContentVersion(branchId: string, turnId: string) {
    const override = this.getOverride(branchId, turnId)
    const version = this.database.db.select().from(turnContentVersions)
      .where(eq(turnContentVersions.id, override.contentVersionId)).get()
    if (!version) throw new NotFoundError('Selected content version not found')
    return version
  }

  private resolveVersion(
    turnId: string,
    overrideByTurn: Map<string, typeof branchTurnOverrides.$inferSelect>,
    versionById: Map<string, TurnContentVersionRow>,
    firstVersionByTurn: Map<string, TurnContentVersionRow>,
    useOverride = true,
  ) {
    const override = useOverride ? overrideByTurn.get(turnId) : undefined
    const version = (override ? versionById.get(override.contentVersionId) : undefined)
      ?? firstVersionByTurn.get(turnId)
    if (!version) throw new NotFoundError('Turn content version not found')
    return version
  }

  private selectVideoTask(branchId: string, turnId: string, taskId: string) {
    this.database.db.update(branchTurnOverrides).set({ selectedVideoTaskId: taskId, updatedAt: now() })
      .where(and(eq(branchTurnOverrides.branchId, branchId), eq(branchTurnOverrides.turnId, turnId))).run()
  }

  private resolveDirection(turnId: string, input: ChooseRequest) {
    if (input.choice_id) {
      const choice = this.database.db.select().from(choices).where(and(
        eq(choices.id, input.choice_id), eq(choices.turnId, turnId),
      )).get()
      if (!choice) throw new ConflictError('The selected choice does not belong to this turn', 'INVALID_CHOICE')
      return { userDirection: choice.direction, source: 'preset' as const, choiceId: choice.id }
    }
    return { userDirection: input.custom_direction!.trim(), source: 'custom' as const, choiceId: null }
  }

  private toSelectionResponse(selection: SelectionRow) {
    return {
      id: selection.id,
      turn_id: selection.turnId,
      branch_id: selection.branchId,
      user_direction: selection.userDirection,
      source: selection.source,
      choice_id: selection.choiceId,
      next_turn_id: selection.nextTurnId,
      status: selection.status,
      created_at: selection.createdAt,
    }
  }
}

function normalizeIntent(direction: string) {
  return direction.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}
