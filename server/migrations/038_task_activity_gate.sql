ALTER TABLE tasks ADD COLUMN run_only_with_new_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN activity_cursor INTEGER;

-- Task prompts are stored as user messages, but they are not user activity.
-- Keep their chats explicit so every activity-gated task can ignore them.
CREATE TABLE task_run_chats (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, chat_id),
  UNIQUE (chat_id)
);
CREATE INDEX idx_task_run_chats_task ON task_run_chats(task_id);

-- Recover old task-run chats without relying on titles alone: a scheduled run's
-- first user message is the task prompt verbatim.
INSERT OR IGNORE INTO task_run_chats (task_id, chat_id)
SELECT t.id, c.id
  FROM tasks t
  JOIN chats c ON c.title = t.title
 WHERE EXISTS (
   SELECT 1
     FROM messages m
    WHERE m.chat_id = c.id
      AND m.role = 'user'
      AND m.content = t.prompt
      AND m.rowid = (
        SELECT MIN(fm.rowid) FROM messages fm
         WHERE fm.chat_id = c.id AND fm.role = 'user'
      )
 );

-- Existing conversation-analysis tasks opt in on upgrade. Ordinary reminders,
-- reports and polling tasks retain their current time-only behaviour.
UPDATE tasks
   SET run_only_with_new_messages = 1
 WHERE schedule_kind = 'interval'
   AND (instr(prompt, 'memory_recent') > 0 OR instr(prompt, 'memory_search') > 0);
