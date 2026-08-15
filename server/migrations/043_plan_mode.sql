-- A queued turn keeps the tool-access policy chosen when it was sent. Mode
-- changes are FIFO barriers, so a plan turn can never inherit a normal run's
-- writable tool set (or vice versa).
ALTER TABLE queued_messages
  ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'normal'
    CHECK (execution_mode IN ('normal', 'plan'));
