-- Conversations the owner wants kept at the top of the active list and
-- protected from the bulk "archive others" action.
ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_chats_list_order
  ON chats (archived, pinned DESC, updated_at DESC, id DESC);
