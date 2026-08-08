-- Which chat wrote which Files path (pop-agent.spec §6, §14 "Files as a plain
-- folder"): an append-only log, not a catalog. It records history -- "chat X
-- wrote Files/foo.pdf at T" -- so it never has to be right about where a file
-- is NOW, and a rename cannot desynchronize it.
--
-- Deliberately NO foreign key on chat_id: deleting a chat removes the chat,
-- not the record that it once produced a file. History survives its author.

CREATE TABLE file_provenance (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX file_provenance_by_chat ON file_provenance (chat_id);
CREATE INDEX file_provenance_by_path ON file_provenance (path);
