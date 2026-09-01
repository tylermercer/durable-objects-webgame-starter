# Room Lifetime and Cleanup

**Date:** 2026-09-01
**Status:** Proposed
**Depends on:** kicked-token persistence work (`kickedTokens` on `GameSession`, in progress) — not a hard blocker, but this doc assumes that field exists so it's included in the cleanup scope.

## Motivation

`GameSession` persists room state (`rejoinTokens`, `nextPlayerNumber`, `gracePeriodMs`, `maxPlayers`, and soon `kickedTokens`) to durable storage via `ctx.storage`, and rehydrates it on cold start (`doHydrate()`). This is correct and necessary — it's what lets a controller survive a DO eviction/cold-start without losing their identity.

But nothing ever deletes this storage. A room code, once created, persists in Cloudflare's durable storage indefinitely. The only existing cleanup (`alarm()`'s grace-period purge) removes a single disconnected player's `rejoinToken` 45 seconds after they leave — it never touches the room itself. Cloudflare does not auto-delete Durable Object storage; it's billed and retained until the application explicitly clears it.

For a template meant to host many short-lived party-game sessions, this means storage grows without bound: every room code anyone has ever generated (including ones abandoned mid-`init.ts` testing, or a game that never had a second session) sits in storage forever.

## Goals

- A room that's been fully unoccupied (no console, no controllers connected) for a long, generous period gets its durable storage wiped automatically.
- A room that's actively in use — even a single-session game lasting many hours — is never at risk of cleanup, regardless of how long it's been since the last *join* event specifically.
- No behavior change to the existing 45-second per-player disconnect grace period; this is a separate, much longer-scoped mechanism layered on top of it.
- Reuse the existing single-alarm scheduling pattern (`alarm()` already computes the soonest of several pending deadlines) rather than introducing a second alarm mechanism — Durable Objects support only one pending alarm at a time.

## Non-goals

- No wrangler.jsonc / migrations changes. This only adds new storage keys under the existing `GameSession` class — see the AGENTS.md update below for why that's not a migration-worthy change.
- No per-room configurable expiry window (analogous to `gracePeriodMs`/`maxPlayers` being settable via `join()`). Ship a single repo-wide constant first; making it configurable can be a follow-up if a real use case shows up.
- No proactive cleanup sweep across rooms from outside the DO (e.g., a cron job enumerating all room IDs). Cloudflare doesn't provide a built-in way to enumerate DO instances by name, and this design doesn't need one — each room cleans up after itself via its own alarm.

## Current behavior (baseline)

- `doHydrate()` (`src/lib/GameSession.ts:39-57`) loads `rejoinTokens`, `nextPlayerNumber`, `gracePeriodMs`, and `maxPlayers` from `ctx.storage` on first use after a cold start. Nothing is ever removed from storage except individual `rejoinTokens` entries.
- `alarm()` (`:129-164`) only handles the per-player grace period: for each disconnected controller whose `disconnectedAt` is more than `gracePeriodMs` in the past, it purges that player's token and queued messages, then reschedules the alarm for the next upcoming per-player deadline (`earliestNextDisconnect`).
- `handleClose(ws)` (`:484-527`) removes the closing session from `this.sessions` and, for a controller, marks its `rejoinToken` record as disconnected (starting that player's 45s countdown). It does not currently look at whether `this.sessions` is now completely empty.
- There is no concept anywhere in the class of "the room as a whole is idle."

## Design

### Track when the room becomes empty, not "last activity"

The naive approach — record a `lastActiveAt` timestamp on every message and expire after N hours of no writes — is wrong for this use case: a single long LAN-party session with people mid-game but nobody *joining* (the only event currently timestamped anywhere) would look "idle" and risk being wiped, even though people are actively connected and playing. Persisting a timestamp on every input/control-relay message to avoid that would be far too write-heavy (input flows at up to 60Hz).

Instead, track occupancy transitions, which are already infrequent, discrete events:

- Add `roomEmptySince: number | null` to `GameSession`, persisted alongside the other fields.
- Set it the moment `this.sessions` transitions from non-empty to empty, and clear it (`null`) the moment a new session joins. This means the expiry clock only ever runs while literally nobody is connected — a game that's been running continuously for 10 hours is never at risk, no matter how long ago the last `join()` was, because `sessions.size` has stayed above zero the whole time.

### Where to hook occupancy tracking

**On disconnect** — end of `handleClose(ws)` (`:484-527`), after `this.sessions.delete(ws)` and the existing role-specific handling, add:

```ts
if (this.sessions.size === 0) {
  this.roomEmptySince = Date.now();
  await this.persistRoomEmptySince();
  if (this.ctx?.storage?.setAlarm) {
    await this.ctx.storage.setAlarm(Date.now() + ROOM_ABANDONED_EXPIRY_MS);
  }
}
```

Note this doesn't need to reconcile with the existing per-player grace-period alarm scheduling in this same method — the alarm is a single shared slot, and `alarm()` itself (see below) is responsible for always rescheduling for whichever deadline is soonest, so a later grace-period purge can safely overwrite this alarm time without losing the room-expiry check (because `alarm()` recomputes both on every wake).

**On join** — both `makeConsoleApi().join()` (`:169-259`) and `makeControllerApi().join()` (`:355-...`) already add an entry to `this.sessions`. Add, in both, right after the `self.sessions.set(...)` call:

```ts
if (self.roomEmptySince !== null) {
  self.roomEmptySince = null;
  await self.persistRoomEmptySince();
}
```

### Extending `alarm()`

`alarm()` already computes `earliestNextDisconnect` from per-player grace periods and reschedules for it (`:129-164`). Add a parallel check:

```ts
if (this.roomEmptySince !== null) {
  const roomDeadline = this.roomEmptySince + ROOM_ABANDONED_EXPIRY_MS;
  if (Date.now() >= roomDeadline) {
    logger.info("Room has been empty past the abandonment threshold — wiping storage.");
    await this.ctx.storage.deleteAll();
    // deleteAll() also clears any pending alarm; reset in-memory state to
    // defaults so this instance behaves like a brand-new room if it somehow
    // receives another request before eviction.
    this.sessions = new Map();
    this.rejoinTokens = new Map();
    this.kickedTokens = new Set();
    this.consoleToken = null;
    this.gracePeriodMs = DISCONNECT_GRACE_PERIOD_MS;
    this.maxPlayers = null;
    this.nextPlayerNumber = 1;
    this.currentFirstPlayerId = null;
    this.roomEmptySince = null;
    return; // nothing left to reschedule
  } else if (earliestNextDisconnect === null || roomDeadline < earliestNextDisconnect) {
    earliestNextDisconnect = roomDeadline;
  }
}
```

This slots into the existing "compute the soonest deadline, then set one alarm for it" flow rather than adding a second alarm mechanism.

### `doHydrate()`

Add loading `roomEmptySince` the same way the other optional fields are loaded (`:46-57`):

```ts
const emptySince = await this.ctx.storage.get<number>("roomEmptySince");
if (emptySince !== undefined) this.roomEmptySince = emptySince;
```

### Choosing the threshold

Propose `ROOM_ABANDONED_EXPIRY_MS = 24 * 60 * 60 * 1000` (24 hours) as a new constant next to `DISCONNECT_GRACE_PERIOD_MS` (`:25`). This comfortably covers "everyone stepped away for a meal/overnight and is coming back to the same room code," while still reclaiming genuinely abandoned rooms (one-off template testing, a party that ended and never reused its code) within about a day.

### Interaction with `kickedTokens`

Since `deleteAll()` wipes every key under this DO, `kickedTokens` (once added per the earlier kick-persistence design) is cleaned up along with everything else — no separate handling needed. A room that's been dead for 24+ hours has no meaningful concept of "who was kicked" to preserve.

## Testing

- Fake-timer test: create a session, join and then disconnect a controller (and the console) so `sessions` becomes empty, advance time past `ROOM_ABANDONED_EXPIRY_MS`, trigger `alarm()`, and assert `ctx.storage.deleteAll` was called and in-memory state reset to defaults.
- Negative case: same setup, but have a controller `join()` again before the threshold elapses — assert `roomEmptySince` is cleared and `alarm()` at the original deadline does *not* wipe storage.
- Long-active-session case: join a console and controller, advance time well past `ROOM_ABANDONED_EXPIRY_MS` **without ever disconnecting them**, and assert storage is untouched — this is the key regression test for the "don't wipe an active game" requirement.
- Confirm a `join()` call against a post-`deleteAll()` DO instance behaves exactly like a fresh room (new `consoleToken` gets minted, `nextPlayerNumber` starts at 1, no stale `maxPlayers`/`gracePeriodMs` carried over) — this is effectively the same "does hydration-from-empty behave like day one" check as any other cold-start test, just triggered by self-deletion instead of a real eviction.

## Open questions

- Is 24 hours the right default? It's a guess calibrated to "overnight break," not measured against real usage. Easy to tune later since it's a single constant.
- Should there be a way for a console to explicitly end/close a room (rather than waiting out the timer) once a game is over? Out of scope here, but worth a future doc if hosts want a "close room" button that triggers immediate `deleteAll()`.
