-- Web Push subscriptions (docs/specs/Spec-Pop-General.md §14).
--
-- One row per browser that opted in. The endpoint is the unique id the push
-- service gave the browser; the keys let us encrypt a payload only that
-- browser can read. A subscription that the push service later rejects (410
-- Gone) is deleted on the next send.

CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
