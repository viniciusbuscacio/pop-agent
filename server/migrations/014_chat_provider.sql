-- Multi-provider phase 1 (pop-agent.spec §15): model identity is the pair
-- (provider, model). Chats gain a provider column; empty means "the global
-- default". Rows that pinned a model before this column existed were
-- OpenRouter overrides, so they are backfilled as such.
ALTER TABLE chats ADD COLUMN provider TEXT NOT NULL DEFAULT '';
UPDATE chats SET provider = 'openrouter' WHERE model != '';
