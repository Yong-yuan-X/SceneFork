-- SceneFork P1. Executed once and tracked in __drizzle_migrations.
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

-- selections is rebuilt by the TypeScript migration after default branch IDs exist.
