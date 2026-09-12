-- Pending input normally steers the live pi loop. /queue preserves the older
-- behavior explicitly, so the durable row must remember which path its sender
-- chose across edits, reconnects and server restarts.
ALTER TABLE queued_messages
  ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'steer'
  CHECK (delivery_mode IN ('steer', 'follow_up'));
