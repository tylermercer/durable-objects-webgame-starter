# Gamepad Controller Support

> [!NOTE]
> **Draft.** Not yet reviewed or approved — expect this to change before implementation starts.

## Scope

Today every entry in `ConsoleContext.peers` is a phone that joined over signaling and talks over a WebRTC `GameTransport`. This adds a second kind of peer — a physical gamepad plugged into the console's own machine — without touching the DO, signaling, or WebRTC at all, since a local gamepad has no network hop to make.

Two tiers, meant to land separately:

- **Tier 1** (this doc's main focus): hardware gamepads show up in `ctx.peers` alongside phones, using the browser's Gamepad API. Console-local only — no phone involved.
- **Tier 2** (sketched, not built until a real game asks for it): a prebuilt on-screen virtual-gamepad UI a phone controller can opt into, so a game that only wants "gamepad-shaped input" can treat a phone and a physical pad the same way.

Both tiers are additive. A game that does nothing stays exactly as it is today — `ctx.peers` contains only phones, same as now.

## 1. Where this plugs in: `GameTransport` is already transport-agnostic

`ControllerPeer.pc` is typed as `GameTransport` — `sendInput`, `addInputListener`, `connectionState`, `mode`, `close`. Nothing in that interface, or in how `ConsoleApp`/games consume it, assumes an `RTCPeerConnection` underneath. Games already only touch the interface, never the concrete transport. That's the seam a local, non-networked implementation of `GameTransport` can slot into cleanly — a gamepad peer isn't a special case games need to know about, it's just another `pc`.

The one real gap: `ControllerPeer` was shaped around a *remote* device (`state`, `status: PlayerConnectionStatus` like `"grace-period"`, `lastTouch`). A gamepad peer doesn't reconnect over a network, doesn't have a signaling connection to drop, and isn't a `TouchMessage` producer. None of that breaks anything — those fields just don't apply and can be left at sensible constants (`status: "live"`, `lastTouch: undefined`) — but it's worth naming so nobody goes looking for a "gamepad grace period."

## 2. `LocalGamepadTransport`: a `GameTransport` with no network underneath

```ts
// src/transport/gamepad-transport.ts
import type { GameTransport, InputMessage, ControlMessage, TransportMode } from "./transport";

export type GamepadStateMessage = {
  type: "gamepad-state";
  buttons: number[]; // analog value 0–1 per button, standard mapping index order
  axes: number[];    // -1–1 per axis
  t: number;
};

export class LocalGamepadTransport implements GameTransport {
  readonly mode: TransportMode = "local";
  readonly connectionState: RTCPeerConnectionState = "connected"; // no ICE, always "connected"

  private inputListeners = new Set<(msg: InputMessage) => void>();
  private pollHandle: number | null = null;
  private lastButtons: number[] = [];
  private lastAxes: number[] = [];

  constructor(private gamepadIndex: number) {
    this.startPolling();
  }

  private startPolling() {
    const tick = () => {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if (gp) {
        const buttons = gp.buttons.map(b => b.value);
        const axes = [...gp.axes];
        if (changed(buttons, this.lastButtons) || changed(axes, this.lastAxes)) {
          this.lastButtons = buttons;
          this.lastAxes = axes;
          const msg: GamepadStateMessage = { type: "gamepad-state", buttons, axes, t: performance.now() };
          for (const l of this.inputListeners) l(msg);
        }
      }
      this.pollHandle = requestAnimationFrame(tick);
    };
    this.pollHandle = requestAnimationFrame(tick);
  }

  sendInput() {}       // nowhere to send — this peer *is* the input source
  sendControl() {}     // no-op; see §3 for why a game rarely needs this anyway
  sendControlCoalesced() {}
  addInputListener(l: (msg: InputMessage) => void) {
    this.inputListeners.add(l);
    return () => this.inputListeners.delete(l);
  }
  addControlListener() { return () => {}; }
  onModeChange() { return () => {}; }
  close() {
    if (this.pollHandle !== null) cancelAnimationFrame(this.pollHandle);
    this.inputListeners.clear();
  }
}

function changed(a: number[], b: number[]) {
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}
```

`TransportMode` (`transport.ts`) needs a third value, `"local"`, alongside `"p2p"` / `"relay"` — used purely for UI ("local" badge instead of "live"/"relay") and never something a game branches on. `GamepadStateMessage` joins the `InputMessage` union the same way `TouchMessage` does today.

Emitting on-change rather than every frame keeps this consistent with how `InputStateSync` already throttles continuous state, without introducing a second cadence knob — a change on any button/axis is rare enough per-frame that no additional rate limiting is needed on top.

## 3. Wiring into `ConsoleApp`: gamepads join like peers, not like a subsystem

```ts
// src/host/console.ts, additions to ConsoleApp
private setupGamepadListeners() {
  window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
    if (!this.acceptsGamepads()) return; // §4
    const id = `gamepad-${e.gamepad.index}`;
    const controller: ControllerState = {
      id,
      name: `Gamepad ${e.gamepad.index + 1}`,
      color: PLAYER_COLORS[this.controllers.size % PLAYER_COLORS.length],
      isFirstPlayer: false,
      pc: new LocalGamepadTransport(e.gamepad.index),
      orchestrator: null,
      state: "live",
      status: "live",
      signalingConnected: true, // n/a, but keeps status math happy
    };
    this.controllers.set(id, controller);
    this.peerNotifier.notifyJoined(controller);
    this.peerNotifier.notifyReady(controller); // no handshake to wait for
    this.updateControllerUI();
  });

  window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
    this.removeController(`gamepad-${e.gamepad.index}`); // existing method, unchanged
  });
}
```

This reuses `addController`'s sibling machinery (`peers` map, `peerNotifier`, `updateControllerUI`) verbatim — a game listening on `onPeerJoined` cannot tell whether the new peer came from a QR-code join or a USB cable.

Two caveats worth flagging rather than solving here:
- **Index reuse**: browsers renumber `gamepad.index` after a disconnect in ways that aren't fully consistent cross-browser. Keying `id` on index alone means a replugged pad can look like a "new" peer rather than a rejoin. `gamepad.id` (the device string) could be folded in for a closer approximation, but true rejoin semantics (à la the phone rejoin-token doc) aren't in scope here — this is a nice-to-have follow-on once someone hits it in practice.
- **Activation gesture**: per spec, `navigator.getGamepads()` only reports a pad's state after a button has been pressed on it at least once (privacy mitigation, same family as autoplay restrictions). `gamepadconnected` still fires immediately, so the peer can join right away, but its first `gamepad-state` message may be delayed until a button press. Worth a one-line "press any button to activate" hint in the controller list UI for the `"local"` mode badge.

## 4. Declaring what a game wants: `controllerTypes` replaces `maxPlayers`

`ConsoleGameModule.maxPlayers` today is really "phone max" wearing a generic name — it only ever gates signaling joins, which (pre-Tier-1) were the only kind of controller that existed. Rather than bolt `controllerTypes` on alongside it, this folds `maxPlayers` into `controllerTypes.phone.max` and removes the standalone field. Nothing outside this repo depends on the contract yet, so there's no migration path to preserve.

```ts
// src/contract/gameTypes.ts
export interface ControllerTypeRange {
  min?: number;
  max?: number;
}

export interface ConsoleGameModule {
  createGame(ctx: ConsoleContext): ConsoleGameInstance;
  /** Omitted = phone-only, unlimited — today's behavior, unchanged. */
  controllerTypes?: {
    phone?: ControllerTypeRange;
    gamepad?: ControllerTypeRange;
  };
}
```

```ts
// src/examples/registry.ts
export interface GameEntry {
  label: string;
  controllerTypes?: ConsoleGameModule["controllerTypes"];
  console: () => Promise<ConsoleGameModule | any>;
  controller: () => Promise<ControllerGameModule | any>;
}

export const EXAMPLES: Record<string, GameEntry> = {
  "touch-demo": { label: "Touch Demo", console: ..., controller: ... }, // unbounded, unchanged
  "liars-dice": { label: "Liar's Dice", controllerTypes: { phone: { max: 6 } }, console: ..., controller: ... },
  "uno": { label: "Uno", controllerTypes: { phone: { max: 6 } }, console: ..., controller: ... },
  "othello": { label: "Othello", controllerTypes: { phone: { max: 2 } }, console: ..., controller: ... },
  "gamepad-demo": { label: "Gamepad Demo", controllerTypes: { gamepad: {} }, console: ..., controller: ... }, // §5
};
```

`gameSource.ts`'s `getGameMaxPlayers()` becomes `getGameControllerTypes()`, returning the whole object instead of a bare number — same shape swap as `registry.ts`.

On the console side, everywhere `this.maxPlayers` was read gets sourced from `controllerTypes.phone?.max` instead:

```ts
// src/host/console.ts
controllerTypes: ConsoleGameModule["controllerTypes"] = null;

private get phoneMax(): number | null {
  return this.controllerTypes?.phone?.max ?? null;
}
private acceptsGamepads(): boolean {
  return !!this.controllerTypes?.gamepad;
}
```

`this.controllerTypes` is set from `getGameControllerTypes()` in the constructor and re-set from `gameMod.controllerTypes` in `initGame()` — the same two spots `this.maxPlayers` was previously assigned from `getGameMaxPlayers()` and `gameMod.maxPlayers`. The player-limit badge, the room-full notice, and the `this.api.join(callbacks, token, undefined, this.phoneMax ?? undefined)` call (§ signaling, below) all swap `this.maxPlayers` for `this.phoneMax` verbatim — no logic changes, just the source of the number.

`setupGamepadListeners()` is registered once at `init()` time, but `acceptsGamepads()` gates the `gamepadconnected` handler the same way `phoneMax` already gates the signaling join — so a touch-only game doesn't suddenly grow gamepad peers just because someone plugged one in, and switching games mid-session (`initGame()`'s existing `this.activeGame?.destroy?.()` path) is the natural place to also purge any live gamepad peers.

**Threading it into `GameSession`.** Since the wire param was always phone-specific in practice, this renames it end to end rather than leaving a generically-named `maxPlayers` param that now sits next to a more precisely-named `controllerTypes` concept on the console side:

```ts
// src/lib/signaling-api.ts
export interface ConsoleApi extends RpcTarget {
  join(
    callbacks: ConsoleCallbacks,
    consoleToken?: string,
    gracePeriodMs?: number,
    phoneMax?: number // was maxPlayers
  ): ...
}
```

`GameSession.ts` follows suit: `self.maxPlayers` → `self.phoneMax`, the `"maxPlayers"` storage key → `"phoneMax"`, and the join-time check —

```ts
// src/lib/GameSession.ts, inside makeControllerApi().join()
if (self.phoneMax !== null && self.rejoinTokens.size >= self.phoneMax) {
  logger.warn(`Controller join rejected: phone limit of ${self.phoneMax} reached`);
  throw new Error(`Room is full. Maximum limit of ${self.phoneMax} players reached.`);
}
```

— is otherwise identical to what's there today. This is the mechanism that actually enforces the phone side of `controllerTypes`: it's a hard reject at the DO, not just a UI badge.

**Gamepads still don't get this for free.** They never call `GameSession.join()` — no DO, no signaling, that's Tier 1's whole premise — so `controllerTypes.gamepad.max` has no equivalent server-side check to plug into. `acceptsGamepads()` only gates whether gamepads are admitted *at all*, not a count. A numeric cap would need its own local check in `setupGamepadListeners()` (count existing gamepad peers in `this.controllers` before creating another), which is a few lines but a genuinely different code path from the phone case — worth calling out so `controllerTypes.gamepad.max` isn't assumed to be enforced just because `controllerTypes.phone.max` is. `min` for either kind (start-blocking until enough controllers are present) stays UI-layer, same as it effectively is for phones today.

## 5. Validating the seam: a `gamepad-demo` example

Before any real game depends on this, it needs the same kind of end-to-end smoke test Touch Demo already serves for the phone path — the README's "try the demo as-is" onboarding step exists precisely so the console→DO→controller pipe gets confirmed before anyone touches game logic. `gamepad-demo` (`src/examples/gamepad-demo/console.ts`) would need no controller-side code at all: `controllerTypes: { gamepad: {} }`, and a console view drawing live button/axis bars per connected pad straight off `ctx.peers`. Cheap to build, and it's the thing that actually proves §2–4 work together before Tier 2 builds on top of them.

## 6. Tier 2 (contingent on Tier 1 landing and a game wanting it): phones as virtual gamepads

The original framing was a `PhoneController`/`GamepadController` interface pair, with `PhoneGamepadController` implementing both. Worth naming the lighter alternative this codebase's existing patterns point toward: rather than a new interface hierarchy, converge on the **message shape** `LocalGamepadTransport` already established (§2). A phone that wants to present as a gamepad just needs controller-side code that renders a D-pad/stick UI, tracks its own button/axis state, and pushes `GamepadStateMessage`s over the real `GameTransport` (`sendInput`, or `InputStateSync` for the continuous axis values) — exactly the shape a `LocalGamepadTransport` peer emits locally. On the console side, a game reading `gamepad-state` messages off `ctx.peers` genuinely cannot tell a phone-as-gamepad from a physical pad, without any new class hierarchy needed — `GameTransport` was already the unifying interface.

This keeps Tier 2 scoped to one reusable piece: a prebuilt `GamepadControllerUI` component (`src/components/` or `src/react/`) that a game's `controller.ts` mounts instead of hand-rolling touch handling, plus the small translation shim from pointer events to button/axis values. No `ConsoleApp` or contract changes required beyond Tier 1's — a game opts in purely by using the shared UI on the controller side and reading `gamepad-state` messages on the console side. If a real multi-game need for a formal `GamepadController` abstraction (auto-detecting and normalizing across both) shows up later, that's a small follow-on doc once there's a second consumer to generalize from — consistent with this template's general preference for concrete examples before abstractions (see `src/examples/` existing for exactly that reason).

## 7. Out of scope / open questions

- **Haptics/rumble** (`GamepadHapticActuator`) — inconsistent across browsers, not needed for basic input support, worth a future doc if a game wants it.
- **Non-`"standard"` mappings** — `gamepad.mapping !== "standard"` pads exist (older/exotic hardware) and would report raw, unmapped button/axis indices. Fine to ignore for v1; `LocalGamepadTransport` just passes through whatever indices the browser reports.
- **Slot/seat assignment on a shared screen** — with phones, "who is this player" is obvious (their own device). With N gamepads plugged into one console, a game needs its own UI for "gamepad 1 is the red player," etc. Left to individual games, same as color assignment today.
- **> 4 simultaneous gamepads** — technically unbounded by this design, practically untested past the Gamepad API's usual 4-pad browser affordances.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/transport/transport.ts` | `"local"` added to `TransportMode`; `GamepadStateMessage` added to `InputMessage` (§2) |
| `src/transport/gamepad-transport.ts` | new — `LocalGamepadTransport` implementing `GameTransport` via Gamepad API polling (§2) |
| `src/contract/gameTypes.ts` | `maxPlayers` removed; `ConsoleGameModule.controllerTypes` added (§4) |
| `src/examples/registry.ts` | `GameEntry.maxPlayers` → `controllerTypes.phone.max` on existing entries; register `gamepad-demo` (§4–5) |
| `src/contract/gameSource.ts` | `getGameMaxPlayers()` → `getGameControllerTypes()` (§4) |
| `src/lib/signaling-api.ts` | `ConsoleApi.join()`'s `maxPlayers` param renamed `phoneMax` (§4) |
| `src/lib/GameSession.ts` | `self.maxPlayers` / `"maxPlayers"` storage key renamed `phoneMax`; join-rejection logic unchanged otherwise (§4) |
| `src/host/console.ts` | `this.maxPlayers` → `this.controllerTypes` + `phoneMax`/`acceptsGamepads()` getters; `setupGamepadListeners()`; gamepad peers created/removed through existing `controllers` map + `peerNotifier` (§3–4) |
| `src/examples/gamepad-demo/` | new — console-only smoke-test example, `controllerTypes: { gamepad: {} }` (§5) |
| *(Tier 2, later)* `src/components/GamepadControllerUI` | prebuilt phone-as-gamepad UI + `gamepad-state` translation shim (§6) |
