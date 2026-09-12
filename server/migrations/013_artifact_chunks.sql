-- Semantic index over the user's files (docs/specs/Spec-Pop-General.md §7/§14, decision of 31/07):
-- extracted text, chunked, one embedding per chunk, so the agent can learn
-- from what lives in Files. Same shape as message_embeddings: a Float32Array
-- BLOB and a brute-force cosine in JS -- one user's files are thousands of
-- chunks, not millions. The FK cascade drops a file's chunks with its record,
-- which is also how a deleted folder's files go.

CREATE TABLE artifact_chunks (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  chunk       INTEGER NOT NULL,
  text        TEXT NOT NULL,
  vector      BLOB NOT NULL,
  PRIMARY KEY (artifact_id, chunk)
);
