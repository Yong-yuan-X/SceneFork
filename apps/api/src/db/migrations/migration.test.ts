import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { createDatabase } from '../database.js'

test('P1 migration preserves a real P0 story and is idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scenefork-p0-migration-'))
  const databasePath = path.join(directory, 'p0.db')
  const sqlite = new Database(databasePath)
  createP0Schema(sqlite)
  seedP0Data(sqlite)
  sqlite.close()

  const migrated = createDatabase(databasePath)
  const defaultBranches = migrated.sqlite.prepare(
    "SELECT COUNT(*) AS value FROM story_branches WHERE story_id = '10000000-0000-4000-8000-000000000001'",
  ).get() as { value: number }
  assert.equal(defaultBranches.value, 1)
  const branchHead = migrated.sqlite.prepare(`
    SELECT head_turn_id FROM story_branches
    WHERE story_id = '10000000-0000-4000-8000-000000000001'
  `).get() as { head_turn_id: string }
  assert.equal(branchHead.head_turn_id, '30000000-0000-4000-8000-000000000002')
  const task = migrated.sqlite.prepare(`
    SELECT id, provider_task_id, version, local_path, cover_path, prompt_snapshot
    FROM video_tasks WHERE id = '60000000-0000-4000-8000-000000000001'
  `).get() as Record<string, unknown>
  assert.equal(task.provider_task_id, 'wan-p0-task')
  assert.equal(task.version, 1)
  assert.equal(task.local_path, 'preserved-video.mp4')
  assert.equal(task.cover_path, null)
  assert.equal(task.prompt_snapshot, 'A cinematic prompt long enough for the P0 fixture video task.')
  assert.equal((migrated.sqlite.prepare('SELECT COUNT(*) AS value FROM turn_content_versions').get() as { value: number }).value, 2)
  assert.equal((migrated.sqlite.prepare('SELECT COUNT(*) AS value FROM selections').get() as { value: number }).value, 1)
  migrated.close()

  const reopened = createDatabase(databasePath)
  assert.equal((reopened.sqlite.prepare('SELECT COUNT(*) AS value FROM story_branches').get() as { value: number }).value, 1)
  assert.equal((reopened.sqlite.prepare('SELECT COUNT(*) AS value FROM turn_content_versions').get() as { value: number }).value, 2)
  assert.equal((reopened.sqlite.prepare('SELECT COUNT(*) AS value FROM __drizzle_migrations WHERE id = 1').get() as { value: number }).value, 1)
  assert.equal((reopened.sqlite.prepare('SELECT COUNT(*) AS value FROM __drizzle_migrations WHERE id = 2').get() as { value: number }).value, 1)
  assert.equal((reopened.sqlite.prepare("SELECT COUNT(*) AS value FROM pragma_table_info('video_tasks') WHERE name = 'cover_path'").get() as { value: number }).value, 1)
  assert.equal((reopened.sqlite.prepare("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'index' AND name = 'selections_turn_unique'").get() as { value: number }).value, 0)
  reopened.close()
})

function createP0Schema(sqlite: Database.Database) {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE stories (
      id TEXT PRIMARY KEY, original_idea TEXT NOT NULL, title TEXT NOT NULL,
      characters_json TEXT NOT NULL, scene_json TEXT NOT NULL,
      current_turn_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX stories_current_turn_idx ON stories(current_turn_id);
    CREATE TABLE story_turns (
      id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      parent_turn_id TEXT, title TEXT NOT NULL, story_text TEXT NOT NULL,
      summary TEXT NOT NULL, video_prompt TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX story_turns_story_idx ON story_turns(story_id);
    CREATE TABLE choices (
      id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, label TEXT NOT NULL, direction TEXT NOT NULL
    );
    CREATE UNIQUE INDEX choices_turn_position_unique ON choices(turn_id, position);
    CREATE INDEX choices_turn_idx ON choices(turn_id);
    CREATE TABLE selections (
      id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      user_direction TEXT NOT NULL, source TEXT NOT NULL,
      choice_id TEXT, next_turn_id TEXT, status TEXT NOT NULL, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX selections_turn_unique ON selections(turn_id);
    CREATE TABLE video_tasks (
      id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, status TEXT NOT NULL, provider_task_id TEXT,
      provider_status TEXT, last_polled_at TEXT, request_id TEXT NOT NULL,
      resolution TEXT NOT NULL, duration INTEGER NOT NULL, error TEXT,
      temporary_video_url TEXT, local_path TEXT, media_type TEXT, mock_outcome TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE UNIQUE INDEX video_tasks_turn_version_unique ON video_tasks(turn_id, version);
    CREATE UNIQUE INDEX video_tasks_provider_task_unique ON video_tasks(provider_task_id);
    CREATE INDEX video_tasks_status_idx ON video_tasks(status);
  `)
}

function seedP0Data(sqlite: Database.Database) {
  const created = '2026-01-01T00:00:00.000Z'
  sqlite.prepare(`INSERT INTO stories VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    '10000000-0000-4000-8000-000000000001',
    'P0 original idea',
    'Second turn',
    JSON.stringify([{ name: 'Traveler', description: 'A persistent explorer.' }]),
    JSON.stringify({ location: 'Old city', visual_style: 'Cinematic realism' }),
    '30000000-0000-4000-8000-000000000002',
    created,
    created,
  )
  const insertTurn = sqlite.prepare(`INSERT INTO story_turns VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  insertTurn.run(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    null,
    'First turn',
    'The traveler reaches an old city and discovers a sealed gate in the rain.',
    'The traveler reaches the city.',
    'A cinematic prompt long enough for the P0 fixture video task.',
    created,
  )
  insertTurn.run(
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Second turn',
    'The gate opens and the traveler follows a trail of blue lights underground.',
    'The traveler enters the city.',
    'A second cinematic prompt long enough for the fixture continuation.',
    created,
  )
  for (let position = 1; position <= 4; position += 1) {
    sqlite.prepare('INSERT INTO choices VALUES (?, ?, ?, ?, ?)').run(
      `40000000-0000-4000-8000-00000000000${position}`,
      '30000000-0000-4000-8000-000000000001',
      position,
      `Choice ${position}`,
      `Direction ${position}`,
    )
  }
  sqlite.prepare('INSERT INTO selections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Direction 1',
    'preset',
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'complete',
    null,
    created,
    created,
  )
  sqlite.prepare('INSERT INTO video_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    '60000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    1,
    'succeeded',
    'wan-p0-task',
    'SUCCEEDED',
    created,
    'p0-request',
    '1280*720',
    5,
    null,
    null,
    'preserved-video.mp4',
    'video/mp4',
    null,
    created,
    created,
    created,
  )
}
