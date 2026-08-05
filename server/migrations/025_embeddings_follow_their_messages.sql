-- Embeddings die with their messages (found 05/08).
--
-- message_embeddings keys on the implicit rowid of messages, which SQLite
-- cannot target with a foreign key -- so deleting a chat cascaded through
-- messages and left every embedding behind. An audit after deleting all 115
-- chats found 878 of them, orphaned.
--
-- Inert in search (every reader JOINs messages), but not harmless: SQLite
-- recycles rowids, so a NEW message can inherit a dead message's rowid and
-- with it a stale vector -- ranked by text it never contained. The repo now
-- deletes embeddings inside the same transaction as the chat; this sweeps
-- what existing installs already leaked.
DELETE FROM message_embeddings
 WHERE message_rowid NOT IN (SELECT rowid FROM messages);
