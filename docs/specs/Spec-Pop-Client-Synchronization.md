# Pop Agent — cache-first client synchronization

**Status:** normative
**Related:** [Frontend](Spec-Pop-Frontend.md), [Events](Spec-Pop-Events-Synchronization.md), [Security](Spec-Pop-Security.md)

## Presentation and authority

The server remains authoritative. An authenticated app renders the last valid
in-memory or persistent snapshot immediately, then reconciles content in place.
No document reload, route remount, cleared list or cleared form is part of data
refresh. With no snapshot, show loading structure, never a false empty result.
Preserve scroll, selection, drafts and conflict/save-before-load protections.
Cached permissions and connection states never grant authority.

## One finite queue

Each authenticated app lifetime starts one full round: open and archived chat
lists, each non-archived conversation's displayed transcript snapshot one at a time, then
every server-backed Settings resource one at a time. The currently requested
destination takes priority. Navigation promotes/deduplicates its read rather
than restarting the whole round. A foreground lane may bypass one already
running background read; background work itself remains sequential.

Opening a conversation shows its available cache immediately and performs a
silent, prioritized revision check. This check alone never animates the refresh
wheel. If the verified snapshot is unchanged, do not download it or show sync
activity. Show activity only for an actual changed/missing transcript or missing
attachment content. Deduplicate checks across remounts and discard navigation
results after leaving the screen or ending the session. Check failures retain
the last-good content and expose retryable queue errors without a polling loop.

Archived transcript contents are excluded from startup, manual full refresh and
reconnect/event background reads. Keep the archive list available, but fetch an
archived transcript only when opened. An archived conversation currently on
screen may refresh normally. Preserve existing cached transcripts; an ignored
invalidation must cause verification when that conversation is reopened.

The existing refresh wheel spins while reads are pending. Clicking it requests
one full data round, with concurrent requests sharing that round. Data-only
refresh never navigates/reloads the document. An explicit click also checks PWA
software; applying a new build or its explicit fresh-shell recovery may reload
as specified in Installation. Once the finite work succeeds
or fails, the wheel stops. Individual reads have deadlines; failures preserve
last-good data, allow later items to finish and expose a retryable error.
Neither failures nor route mounts start an indefinite polling cycle.
Each manual click keeps the indicator active for at least one slow one-second
revolution (respect reduced-motion preferences), even for an immediate no-change
result. This presentation floor never delays starting network work; longer work
keeps the indicator active until completion.

Full means verifying all in-scope resources, not downloading them unconditionally.
Read the revision manifest first. Within the authenticated app lifetime, retain
the verified revision of each successful snapshot independently. An unchanged
round with successfully warmed, verified snapshots makes only the manifest request.
Evicting a transcript from RAM does not invalidate its revision or restart its
background download; foreground navigation restores the cache or reads the server. Read
only changed, missing or invalidated snapshots, preserving chat-before-Settings
ordering and navigation priority. A failed item does not invalidate successful
items. Record the revision observed before its read, never a newer revision
observed afterward. Manifest failure preserves content and reports a retryable
error without starting a blind full download.

Revision verification is session-memory state, not proof inferred from an old
disk cache. A cold app start or new server epoch revalidates the in-scope data;
cached content stays visible throughout. Reconnect uses the same deduplicated
revision-aware round as the refresh wheel.

Warmup is read-only. It never sends messages, migrates a pending send, downloads
attachment bodies, signs in providers, tests paid connections, creates backups
or starts software updates. A transcript snapshot is the same bounded tail
returned for the chat screen; it is not a promise of a complete offline archive.

## Events and recovery

Connect the session-wide SSE channel before acknowledging synchronization.
Events update/persist local projections or invalidate specific resource keys.
Settings changes made by another client or server operation must invalidate
the corresponding snapshots. Live fragments do not trigger HTTP polling.

After reconnect or suspension, compare an authenticated revision manifest and
read resources changed during the gap. A server-process epoch change requires
a fresh full round. Never infer disconnection from hours without chat messages.
Do not acknowledge a revision that changed while its snapshot was in flight.

Keep the existing 25-second idle SSE heartbeat. It is a five-byte comment, not
a full sync or a new connection, and applies only while a client stream exists.
Browser suspension may stop the stream; restoration uses the recovery path.

## Persistence and safety

Persist last-valid chat lists, transcript text and allowlisted Settings data
without time-based expiry. Browser quota/eviction and explicit logout can remove
it. Never persist provider secrets, passkey material, transient operations or
an authoritative online status. Preserve cache on failed refresh. Storage
failure must not break the online app or cause an eviction/redownload loop.
Logout/login boundaries invalidate asynchronous reads and writes.

PWA software updates, health probes and polling for an explicitly busy remote
operation remain distinct from data synchronization. They must not repeatedly
refetch all Settings or chats.

## Verification

Cover cache-first rendering, empty-cache loading, finite ordering, navigation
priority, duplicate requests, deadlines, logout races, reconnect revisions,
event compatibility, draft preservation and refresh without document reload.

API requests bypass service-worker runtime handlers; the client owns network
failure and reconnect recovery. Optional provider subscription allowance failures
remain visible in their provider card with retry and last-good data, without
marking chat or Settings synchronization as failed.

## Bounded client memory

Retain at most 15 transcript caches or 300 MiB of estimated content in RAM,
whichever is reached first. Estimate immutable DTO content without allocating
whole-transcript serialization copies. This is a content budget, not a browser
heap cap. The visible conversation, active runs and queued sends are protected;
if protected histories alone exceed the budget, preserve them until eligible.
Evict the least recently visited eligible transcript, preserving lists, drafts,
run/queue state and persistent/server history. New unvisited warmup snapshots
must not displace recently visited conversations solely because they arrived later.

Start with the server's bounded recent tail. Earlier messages load in pages on
upward scrolling or the accessible Load earlier messages action, with retry and
scroll-anchor preservation. Navigation/cancellation/newer snapshots invalidate
late page results. Canonical refresh reconciles the pages explicitly loaded by
the reader, without downloading the entire archive preemptively.

Serialize persistent chat-cache writes and coalesce waiting snapshots by key.
A cache read is read-only; it never rewrites the transcript just to touch an
access timestamp. Session teardown drops pending writes. Eviction preserves
persistent snapshots where browser quota permits and never clears the app.

Streaming delivery has a 100 ms fallback independent of animation frames and
flushes synchronously at 256 queued fragments or 256 KiB of estimated serialized
content, even when background timers are throttled. Preserve every event and
sequence order; terminal events flush preceding fragments. A single incoming
fragment may exceed the threshold and must be delivered immediately. Stop clears
both frame and timer callbacks and retained fragments.
