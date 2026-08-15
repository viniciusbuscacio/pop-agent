-- The composer's Plan toggle is one synchronized chat preference. Each sent
-- message still snapshots the selected mode into its own run/queue contract.
ALTER TABLE chats
  ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'normal'
    CHECK (execution_mode IN ('normal', 'plan'));
