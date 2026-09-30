import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

const P1_MIGRATION_ID = 1
const P1_MIGRATION_HASH = '001_p1_scenefork_branch_versions'
const VIDEO_COVERS_MIGRATION_ID = 2
const VIDEO_COVERS_MIGRATION_HASH = '002_video_task_covers'

const P1_STRUCTURE_SQL = `
  ALTER TABLE stories ADD COLUMN active_branch_id TEXT;
  ALTER TABLE stories ADD COLUMN draft_number INTEGER;
  ALTER TABLE stories ADD COLUMN cover_path TEXT;
  ALTER TABLE stories ADD COLUMN cover_kind TEXT NOT NULL DEFAULT 'placeholder';

  ALTER TABLE video_tasks ADD COLUMN content_version_id TEXT;
  ALTER TABLE video_tasks ADD COLUMN prompt_snapshot TEXT;
  ALTER TABLE video_tasks ADD COLUMN credential_fingerprint TEXT;
  ALTER TABLE video_tasks ADD COLUMN credential_source TEXT;
  ALTER TABLE video_tasks ADD COLUMN provider_mode TEXT NOT NULL DEFAULT 'mock';

  CREATE TABLE story_branches (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    forked_from_branch_id TEXT,
    forked_at_turn_id TEXT,
    head_turn_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX story_branches_story_idx ON story_branches(story_id);

  CREATE TABLE turn_content_versions (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    story_text TEXT NOT NULL,
    summary TEXT NOT NULL,
    video_prompt TEXT NOT NULL,
    characters_json TEXT NOT NULL,
    scene_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX turn_content_versions_turn_version_unique
    ON turn_content_versions(turn_id, version);
  CREATE INDEX turn_content_versions_turn_idx ON turn_content_versions(turn_id);

  CREATE TABLE branch_turn_overrides (
    branch_id TEXT NOT NULL REFERENCES story_branches(id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
    content_version_id TEXT NOT NULL REFERENCES turn_content_versions(id),
    selected_video_task_id TEXT,
    status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal', 'stale')),
    triggered_by_version_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX branch_turn_overrides_pk ON branch_turn_overrides(branch_id, turn_id);
  CREATE INDEX branch_turn_overrides_turn_idx ON branch_turn_overrides(turn_id);
`

export function runMigrations(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = sqlite
    .prepare('SELECT 1 FROM __drizzle_migrations WHERE id = ?')
    .get(P1_MIGRATION_ID)
  if (!applied) {
    applyP1Migration(sqlite)
  } else {
    sqlite.exec('DROP INDEX IF EXISTS selections_turn_unique')
  }

  applyVideoCoversMigration(sqlite)
}

function applyP1Migration(sqlite: Database.Database) {
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    sqlite.exec(P1_STRUCTURE_SQL)
    backfillP1Data(sqlite)
    rebuildSelections(sqlite)
    recordMigration(sqlite, P1_MIGRATION_ID, P1_MIGRATION_HASH)
    sqlite.exec('COMMIT')
    console.info('[db_migration] Applied migration 001_p1')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    console.error(
      `[db_migration] Migration 001_p1 failed error=${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

function applyVideoCoversMigration(sqlite: Database.Database) {
  const applied = sqlite
    .prepare('SELECT 1 FROM __drizzle_migrations WHERE id = ?')
    .get(VIDEO_COVERS_MIGRATION_ID)
  if (applied) return

  sqlite.exec('BEGIN IMMEDIATE')
  try {
    const columns = sqlite.prepare('PRAGMA table_info(video_tasks)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'cover_path')) {
      sqlite.exec('ALTER TABLE video_tasks ADD COLUMN cover_path TEXT')
    }
    recordMigration(sqlite, VIDEO_COVERS_MIGRATION_ID, VIDEO_COVERS_MIGRATION_HASH)
    sqlite.exec('COMMIT')
    console.info('[db_migration] Applied migration 002_video_task_covers')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    console.error(
      `[db_migration] Migration 002_video_task_covers failed error=${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

function recordMigration(sqlite: Database.Database, id: number, hash: string) {
  const columns = sqlite.prepare('PRAGMA table_info(__drizzle_migrations)').all() as Array<{ name: string }>
  const hashColumn = columns.some((column) => column.name === 'hash') ? 'hash' : 'name'
  sqlite.prepare(
    `INSERT INTO __drizzle_migrations (id, ${hashColumn}, applied_at) VALUES (?, ?, ?)`,
  ).run(id, hash, new Date().toISOString())
}

function backfillP1Data(sqlite: Database.Database) {
  const stories = sqlite
    .prepare(
      'SELECT id, current_turn_id, characters_json, scene_json, created_at, updated_at FROM stories ORDER BY created_at, rowid',
    )
    .all() as Array<{
    id: string
    current_turn_id: string
    characters_json: string
    scene_json: string
    created_at: string
    updated_at: string
  }>

  const insertBranch = sqlite.prepare(`
    INSERT INTO story_branches (
      id, story_id, name, forked_from_branch_id, forked_at_turn_id,
      head_turn_id, created_at, updated_at
    ) VALUES (?, ?, 'Main', NULL, NULL, ?, ?, ?)
  `)
  const updateStory = sqlite.prepare(
    'UPDATE stories SET active_branch_id = ?, draft_number = ? WHERE id = ?',
  )
  const insertVersion = sqlite.prepare(`
    INSERT INTO turn_content_versions (
      id, turn_id, version, title, story_text, summary, video_prompt,
      characters_json, scene_json, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertOverride = sqlite.prepare(`
    INSERT INTO branch_turn_overrides (
      branch_id, turn_id, content_version_id, selected_video_task_id,
      status, triggered_by_version_id, updated_at
    ) VALUES (?, ?, ?, ?, 'normal', NULL, ?)
  `)
  const updateTask = sqlite.prepare(`
    UPDATE video_tasks
    SET content_version_id = ?, prompt_snapshot = ?, provider_mode = CASE
      WHEN provider_task_id LIKE 'mock-%' THEN 'mock' ELSE 'real' END
    WHERE turn_id = ?
  `)

  stories.forEach((story, storyIndex) => {
    const branchId = randomUUID()
    insertBranch.run(
      branchId,
      story.id,
      story.current_turn_id,
      story.created_at,
      story.updated_at,
    )
    updateStory.run(branchId, storyIndex + 1, story.id)

    const turns = sqlite
      .prepare(
        'SELECT id, parent_turn_id, title, story_text, summary, video_prompt, created_at FROM story_turns WHERE story_id = ?',
      )
      .all(story.id) as Array<{
      id: string
      parent_turn_id: string | null
      title: string
      story_text: string
      summary: string
      video_prompt: string
      created_at: string
    }>
    const turnById = new Map(turns.map((turn) => [turn.id, turn]))
    const versionByTurn = new Map<string, string>()
    for (const turn of turns) {
      const versionId = randomUUID()
      versionByTurn.set(turn.id, versionId)
      insertVersion.run(
        versionId,
        turn.id,
        turn.title,
        turn.story_text,
        turn.summary,
        turn.video_prompt,
        story.characters_json,
        story.scene_json,
        turn.created_at,
      )
      updateTask.run(versionId, turn.video_prompt, turn.id)
    }

    const path: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = story.current_turn_id
    while (cursor) {
      if (seen.has(cursor)) throw new Error(`Cycle detected in story ${story.id}`)
      seen.add(cursor)
      const turn = turnById.get(cursor)
      if (!turn) throw new Error(`Missing current/path turn ${cursor} for story ${story.id}`)
      path.unshift(turn.id)
      cursor = turn.parent_turn_id
    }

    for (const turnId of path) {
      const latestTask = sqlite
        .prepare('SELECT id FROM video_tasks WHERE turn_id = ? ORDER BY version DESC LIMIT 1')
        .get(turnId) as { id: string } | undefined
      insertOverride.run(
        branchId,
        turnId,
        versionByTurn.get(turnId),
        latestTask?.id ?? null,
        story.updated_at,
      )
    }
  })

  sqlite.exec('CREATE UNIQUE INDEX stories_draft_number_unique ON stories(draft_number)')
}

function rebuildSelections(sqlite: Database.Database) {
  const invalid = sqlite.prepare(`
    SELECT selections.id
    FROM selections
    JOIN story_turns source ON source.id = selections.turn_id
    JOIN story_turns target ON target.id = selections.next_turn_id
    WHERE selections.next_turn_id IS NOT NULL
      AND (target.parent_turn_id <> source.id OR target.story_id <> source.story_id)
    LIMIT 1
  `).get() as { id: string } | undefined
  if (invalid) throw new Error(`Selection ${invalid.id} has an inconsistent next_turn_id`)

  sqlite.exec(`
    CREATE TABLE selections_p1 (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES story_branches(id) ON DELETE CASCADE,
      user_direction TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('preset', 'custom')),
      choice_id TEXT,
      intent_key TEXT NOT NULL,
      next_turn_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('generating', 'complete', 'failed')),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO selections_p1 (
      id, turn_id, branch_id, user_direction, source, choice_id, intent_key,
      next_turn_id, status, error, created_at, updated_at
    )
    SELECT selections.id, selections.turn_id, stories.active_branch_id,
      selections.user_direction, selections.source, selections.choice_id,
      lower(trim(selections.user_direction)), selections.next_turn_id,
      selections.status, selections.error, selections.created_at, selections.updated_at
    FROM selections
    JOIN story_turns ON story_turns.id = selections.turn_id
    JOIN stories ON stories.id = story_turns.story_id;
    DROP INDEX IF EXISTS selections_turn_unique;
    DROP TABLE selections;
    ALTER TABLE selections_p1 RENAME TO selections;
    CREATE UNIQUE INDEX selections_branch_turn_intent_unique
      ON selections(branch_id, turn_id, intent_key);
    CREATE INDEX selections_turn_idx ON selections(turn_id);
    CREATE INDEX selections_branch_idx ON selections(branch_id);
  `)
}
