-- Forensic history of every title a chat ever had (popy.spec §14, aw's
-- append-only chat_titles ported): who named it (auto|manual), at which user
-- turn, and when. Cheap to keep, priceless when asking "why is this chat
-- called that?".

CREATE TABLE chat_titles (
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  turn       INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_chat_titles_chat ON chat_titles(chat_id, created_at);
