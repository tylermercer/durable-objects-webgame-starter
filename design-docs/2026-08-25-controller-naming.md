# User-Selected Name on Controller Join

## Scope

A third addendum to `design-docs/2026-08-24-additional-primitives.md`. Today a controller's display name is entirely server-assigned: `GameSession.nextPlayerName()` hands out `"Player 1"`, `"Player 2"`, etc. in join order, and the console's later `"identity"` control message only ever echoes that same name back alongside an assigned color — it never lets the player choose anything. This adds a name field to the join flow, following the same "identity persists via the rejoin token" pattern already established for reconnects.

Additive and opt-in at the protocol level — a controller that never sends a name behaves exactly as today, auto-assigned `"Player N"`.

## 1. Where the name currently lives, and what changes

In `GameSession.makeControllerApi().join()`, a fresh join always calls `self.nextPlayerName()`. A rejoin always reuses `record.name` from the stored `ControllerRecord`. Neither path ever considers input from the client. The fix is to let the client optionally supply a name at either point:

```ts
// src/lib/signaling-api.ts
export interface ControllerApi extends RpcTarget {
  join(
    callbacks: ControllerCallbacks,
    rejoinToken?: string,
    name?: string // new
  ):
    | { id: string; name: string; consoleConnected: boolean; rejoinToken: string }
    | Promise<{ ... }>;
  sendSignal(signal: RTCSignal): void;
}
```

```ts
// src/lib/GameSession.ts — inside makeControllerApi().join()
join(callbacks: ControllerCallbacks, rejoinToken?: string, name?: string) {
  const cleanName = sanitizeName(name);
  let id: string, name_: string, token: string, isRejoin = false;

  if (rejoinToken && self.rejoinTokens.has(rejoinToken)) {
    const record = self.rejoinTokens.get(rejoinToken)!;
    id = record.id;
    name_ = cleanName ?? record.name; // allow renaming on rejoin
    record.name = name_;
    token = rejoinToken;
    record.disconnectedAt = null;
    isRejoin = true;
  } else {
    id = crypto.randomUUID();
    name_ = cleanName ?? self.nextPlayerName();
    token = rejoinToken || crypto.randomUUID();
    self.rejoinTokens.set(token, { id, name: name_, disconnectedAt: null });
  }
  // ... rest unchanged, using name_ in place of name
}
```

`sanitizeName` is a small shared helper (§3) — trim whitespace, cap length, reject empty-after-trim (treated as "no name supplied").

## 2. Broadcasting a rename

A join with a new name is already covered by the existing `onControllerJoined(id, name)` callback for first-time joins. A **rejoin** that changes the name is a new case — the console (and any other UI showing player names) needs to hear about it even though the player never "left." Add one callback:

```ts
// src/lib/signaling-api.ts
export interface ConsoleCallbacks extends RpcTarget {
  onControllerJoined(id: string, name: string): void;
  onControllerLeft(id: string): void;
  onSignal(from: string, signal: RTCSignal): void;
  onControllerRenamed(id: string, name: string): void; // new
}
```

`GameSession` fires this from the rejoin branch above whenever `cleanName` is present and differs from the previously stored name. Console's `ConsoleCallbacksHandler` handles it the same way `onControllerJoined` is handled today — update the matching `ControllerState.name` in `this.controllers` and re-render the controller list. Any in-progress game reading names out of `ctx.peers` picks up the change on its next render with no extra work, since it's the same shared `Map`.

## 3. Client-side: asking for a name, and remembering it

Add a small pre-connect step to `ControllerApp` (`src/scripts/controller.ts`) — a name entered before the signaling socket even opens, so it can ride along on the very first `join()` call rather than needing a follow-up rename round-trip for the common case.

```ts
// src/utils/deviceIdentity.ts (extends the util from the first-player-primitive doc)
const NAME_KEY = "playerName";

export function getSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // best-effort; a fresh prompt next time is an acceptable fallback
  }
}

export function sanitizeName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : null;
}
```

Reusing `deviceIdentity.ts` (introduced in the first-player-primitive doc for the rejoin token) keeps all of a device's persisted join-identity concerns — rejoin token *and* remembered name — in one small, testable module instead of scattering `localStorage` calls across files.

UI-wise, this needs one new pre-join screen in the controller markup: a text input prefilled from `getSavedName()`, with a "Join" button that calls `saveName(value)` and then proceeds into the existing `init()` → `connectSignaling()` flow, passing the name through to `join()`:

```ts
// src/scripts/controller.ts
this.api.join(callbacks, token, this.chosenName).then(res => { ... });
```

If a returning player already has a saved name, this screen can be skipped entirely (or shown briefly with the name prefilled and a "not you? edit" affordance) — same "don't make a returning player redo setup" instinct that motivated persisting the rejoin token in the first place.

## 4. Renaming mid-session (optional, cheap follow-on)

The mechanism above naturally supports renaming any time a controller reconnects (drop → grace period → rejoin with a new name), since that's the same code path as a first-time name. A player wanting to rename *without* dropping their connection is a smaller, separate feature — a `"renameRequest"` control-channel message the console forwards to the DO — and isn't included here since it's a distinct, non-essential UX addition rather than part of the core join flow. Worth a one-line mention only so it isn't confused with what this doc actually covers.

## 5. Validation scope

Sanitization here is deliberately minimal: trim, cap at ~20 characters, treat empty-after-trim as "no name given" (falls back to auto-generated `"Player N"`). No profanity filtering, no uniqueness enforcement across players in the same room (two "Alex"es is fine — `id` is still what everything keys off internally; the name is purely cosmetic). Anything stronger than that is a game/deployment-specific concern, not template scope.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/lib/signaling-api.ts` | `join()` gains optional `name` param on `ControllerApi`; `onControllerRenamed` added to `ConsoleCallbacks` (§1–2) |
| `src/lib/GameSession.ts` | fresh join uses supplied name if present; rejoin can update stored name and fires `onControllerRenamed` on change (§1–2) |
| `src/utils/deviceIdentity.ts` | `getSavedName()` / `saveName()` / `sanitizeName()`, alongside the rejoin-token helpers (§3) |
| `src/scripts/controller.ts` | pre-connect name-entry step, prefilled from saved name; passes name into `join()` (§3) |
| `src/scripts/console.ts` | handles `onControllerRenamed` — updates `ControllerState.name`, re-renders controller list (§2) |
