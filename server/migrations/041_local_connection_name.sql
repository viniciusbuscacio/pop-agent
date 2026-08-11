-- Local hands became the internal Pop Local Access library in 0.2.6.
-- Queued messages keep the ephemeral selector only until they are delivered.
ALTER TABLE queued_messages RENAME COLUMN hands_connection_id TO local_connection_id;
