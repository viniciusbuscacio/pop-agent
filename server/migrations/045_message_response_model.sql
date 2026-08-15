-- Every assistant row records the concrete provider/model pair that produced
-- it. NULL keeps historical rows honest: older messages predate this metadata
-- and must not inherit the chat's current model after a later switch.
ALTER TABLE messages ADD COLUMN response_provider TEXT;
ALTER TABLE messages ADD COLUMN response_model TEXT;
