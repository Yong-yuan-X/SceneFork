-- Persist each generated video's first-frame thumbnail for reuse across P1 views.
ALTER TABLE video_tasks ADD COLUMN cover_path TEXT;
