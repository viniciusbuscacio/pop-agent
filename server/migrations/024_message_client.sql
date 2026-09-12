-- Where each message came from (decision of 04/08).
--
-- Per message, not per connection: a conversation moves between devices --
-- started on the phone, continued at the desk -- and the value is in reading
-- that back later. A connection only ever answers "where are we right now",
-- which is the one thing the user could simply have said.
--
-- NULL is honest for the 386 rows that predate this: we do not know where
-- they came from, and 'web' would be a guess written down as a fact. It is
-- also correct for every assistant and system message, which are born on the
-- server and came from no client at all.
--
-- The IP is stored and deliberately NOT put in the model's context: it
-- answers "who connected", which is an audit question, and nothing it could
-- say would change an answer. What goes in the context goes into every
-- conversation, the memory and the backups, forever.

ALTER TABLE messages ADD COLUMN client TEXT;
ALTER TABLE messages ADD COLUMN client_platform TEXT;
ALTER TABLE messages ADD COLUMN client_ip TEXT;
