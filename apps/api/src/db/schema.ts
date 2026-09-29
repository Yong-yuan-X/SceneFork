import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const stories = sqliteTable(
  'stories',
  {
    id: text('id').primaryKey(),
    originalIdea: text('original_idea').notNull(),
    title: text('title').notNull(),
    charactersJson: text('characters_json').notNull(),
    sceneJson: text('scene_json').notNull(),
    currentTurnId: text('current_turn_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('stories_current_turn_idx').on(table.currentTurnId)],
)

export const storyTurns = sqliteTable(
  'story_turns',
  {
    id: text('id').primaryKey(),
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    parentTurnId: text('parent_turn_id'),
    title: text('title').notNull(),
    storyText: text('story_text').notNull(),
    summary: text('summary').notNull(),
    videoPrompt: text('video_prompt').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('story_turns_story_idx').on(table.storyId)],
)

export const choices = sqliteTable(
  'choices',
  {
    id: text('id').primaryKey(),
    turnId: text('turn_id')
      .notNull()
      .references(() => storyTurns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    direction: text('direction').notNull(),
  },
  (table) => [
    uniqueIndex('choices_turn_position_unique').on(table.turnId, table.position),
    index('choices_turn_idx').on(table.turnId),
  ],
)

export const selections = sqliteTable(
  'selections',
  {
    id: text('id').primaryKey(),
    turnId: text('turn_id')
      .notNull()
      .references(() => storyTurns.id, { onDelete: 'cascade' }),
    userDirection: text('user_direction').notNull(),
    source: text('source', { enum: ['preset', 'custom'] }).notNull(),
    choiceId: text('choice_id'),
    nextTurnId: text('next_turn_id'),
    status: text('status', { enum: ['generating', 'complete', 'failed'] }).notNull(),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('selections_turn_unique').on(table.turnId)],
)

export const videoTasks = sqliteTable(
  'video_tasks',
  {
    id: text('id').primaryKey(),
    turnId: text('turn_id')
      .notNull()
      .references(() => storyTurns.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status', {
      enum: [
        'submitting',
        'queued',
        'running',
        'saving',
        'succeeded',
        'failed',
        'submission_unknown',
      ],
    }).notNull(),
    providerTaskId: text('provider_task_id'),
    providerStatus: text('provider_status'),
    lastPolledAt: text('last_polled_at'),
    requestId: text('request_id').notNull(),
    resolution: text('resolution').notNull(),
    duration: integer('duration').notNull(),
    error: text('error'),
    temporaryVideoUrl: text('temporary_video_url'),
    localPath: text('local_path'),
    mediaType: text('media_type'),
    mockOutcome: text('mock_outcome', { enum: ['success', 'failure', 'unknown'] }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    uniqueIndex('video_tasks_turn_version_unique').on(table.turnId, table.version),
    uniqueIndex('video_tasks_provider_task_unique').on(table.providerTaskId),
    index('video_tasks_status_idx').on(table.status),
  ],
)

export type StoryRow = typeof stories.$inferSelect
export type StoryTurnRow = typeof storyTurns.$inferSelect
export type ChoiceRow = typeof choices.$inferSelect
export type SelectionRow = typeof selections.$inferSelect
export type VideoTaskRow = typeof videoTasks.$inferSelect
