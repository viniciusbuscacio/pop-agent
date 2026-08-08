-- Service completions belong to no conversation (completion-path fix 6).
--
-- Titles, summaries and voice cleanup spend real money that never reached
-- llm_runs because only chat runs were booked. The kind column separates
-- chat rows (default) from service rows; service rows use an empty chat_id
-- because the Usage screen aggregates by cost/model/period, never by chat.

ALTER TABLE llm_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
