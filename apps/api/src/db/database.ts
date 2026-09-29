import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export function createDatabase(databasePath: string) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  }

  const sqlite = new Database(databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  migrate(sqlite)

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  }
}

function migrate(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      original_idea TEXT NOT NULL,
      title TEXT NOT NULL,
      characters_json TEXT NOT NULL,
      scene_json TEXT NOT NULL,
      current_turn_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS stories_current_turn_idx ON stories(current_turn_id);

    CREATE TABLE IF NOT EXISTS story_turns (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      parent_turn_id TEXT,
      title TEXT NOT NULL,
      story_text TEXT NOT NULL,
      summary TEXT NOT NULL,
      video_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS story_turns_story_idx ON story_turns(story_id);

    CREATE TABLE IF NOT EXISTS choices (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      direction TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS choices_turn_position_unique ON choices(turn_id, position);
    CREATE INDEX IF NOT EXISTS choices_turn_idx ON choices(turn_id);

    CREATE TABLE IF NOT EXISTS selections (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      user_direction TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('preset', 'custom')),
      choice_id TEXT,
      next_turn_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('generating', 'complete', 'failed')),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS selections_turn_unique ON selections(turn_id);

    CREATE TABLE IF NOT EXISTS video_tasks (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('submitting', 'queued', 'running', 'saving', 'succeeded', 'failed', 'submission_unknown')),
      provider_task_id TEXT,
      provider_status TEXT,
      last_polled_at TEXT,
      request_id TEXT NOT NULL,
      resolution TEXT NOT NULL,
      duration INTEGER NOT NULL,
      error TEXT,
      temporary_video_url TEXT,
      local_path TEXT,
      media_type TEXT,
      mock_outcome TEXT CHECK(mock_outcome IN ('success', 'failure', 'unknown')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS video_tasks_turn_version_unique ON video_tasks(turn_id, version);
    CREATE UNIQUE INDEX IF NOT EXISTS video_tasks_provider_task_unique ON video_tasks(provider_task_id);
    CREATE INDEX IF NOT EXISTS video_tasks_status_idx ON video_tasks(status);
  `)
}

export type SceneForkDatabase = ReturnType<typeof createDatabase>
