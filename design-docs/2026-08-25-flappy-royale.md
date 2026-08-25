# Flappy Royale (multiplayer Flappy Bird)

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-24-core-architecture.md`, `2026-08-24-additional-primitives.md`,
`2026-08-25-example-switcher-and-liars-dice.md`

## Goal

Add a third entry to the `EXAMPLES` registry introduced in
`2026-08-25-example-switcher-and-liars-dice.md`: a multiplayer Flappy Bird
where every connected controller flies its own bird against a shared,
deterministic pipe field rendered on the console, and the last bird flying
wins.

This is a same-shape follow-on to that doc's Phase 2 (Liar's Dice): a new
`src/examples/<id>/` module registered in `registry.ts`, proving the
`createGame` contract and the switcher seam hold for a real-time
reflex game, not just a turn-based one. **It does not touch
`gameSource.ts`, `src/logic/`, `DemoSwitcher.astro`, or
`src/scripts/console.ts`/`controller.ts`.**

If Phase 1 and Phase 2 of the prior doc aren't merged yet, this is blocked
on both — the registry and `createGame` contract need to exist first.

## Non-goals

- No changes to `src/lib/GameSession.ts`, `src/lib/signaling-api.ts`, or the
  capnweb RPC protocol beyond what Phase 1/2 of the prior doc already added
  (`rejoinToken`, `saveGameState`/`loadGameState`).
- No physics/collision library — a handful of circle/rect checks is enough
  for pipe gaps and the ground.
- No spectator mode, no matchmaking across rooms — one room is one round.

## Module layout

```
src/examples/flappy-royale/
├── types.ts        # BirdState, PipeState, RoundState, message shapes
├── sim.ts           # pure functions: physics step, collision, pipe spawn
├── console.ts        # createGame({ session, peers }) -> { tick, render }
└── controller.ts      # createGame({ peerConnection }) -> flap button
```

`sim.ts` must have no dependency on `PeerConnection`, the DO client, canvas,
or any DOM API — same rule as `liars-dice/rules.ts` — so the tick math can
be unit tested with plain inputs/outputs.

## Game behavior

### Round shape

One room plays one round at a time: every controller connected when the
console starts the round gets a bird; a bird that hits a pipe or the ground
is eliminated but keeps watching; the round ends when zero or one birds
remain, and the console shows results before offering "play again."

### Input: a flap is a discrete event

A flap has no meaningful "state" between presses — it's an instantaneous
impulse — so it does **not** use `InputStateSync` (that's for things like a
held joystick). Controller sends a discrete event on the existing `input`
channel pattern, same shape family as the demo's `{type:'touch', ...}`:

```ts
{ type: "flap" }
```

sent on `pointerdown`/touch-start of a single full-screen button. The
`input` channel's unreliable delivery is fine here — a dropped flap just
means the player mistimed a jump, no different from a dropped frame of
input in any other real-time game; there's no state to desync.

### Simulation: fixed-tick loop

`createFixedTickLoop` at 60Hz drives `sim.ts`:

```ts
createFixedTickLoop({
  tickRate: 60,
  onTick: (dt) => nextState = stepRound(currentState, pendingFlaps, dt),
  onRender: (alpha) => drawRound(ctx, currentState, nextState, alpha),
});
```

- `onTick`: for each live bird, apply gravity, apply an upward impulse for
  any flap received since the last tick (queued from `input`-channel
  messages, then cleared), advance pipe positions, spawn new pipes past the
  spawn threshold, and run collision checks (§ Collision).
- `onRender(alpha)`: interpolate bird y-position and pipe x-position
  between the previous and current tick state for smooth 60fps drawing
  even though physics only updates per tick.

Flaps are batched per-tick rather than applied the instant a message
arrives, so a burst of flaps between ticks doesn't stack multiple impulses
into one step — same reasoning `InputStateSync` uses for continuous input,
applied here to a discrete-event queue instead.

### Pipe generation: seeded and persisted

Pipe gap height/position and spawn timing come from `createRng(seed)`
(`src/utils/rng.ts`). The seed is chosen once at round start and persisted
via `saveGameState` immediately, so a console refresh mid-round
regenerates the identical pipe sequence up to the same tick count rather
than reshuffling the field — matching the pattern
`2026-08-25-example-switcher-and-liars-dice.md` §2b uses for dice rolls.
`sim.ts` exposes pipe generation as a pure function of `(seed, tickIndex)`
so "replay from a persisted seed" is just re-running ticks, not a special
code path.

### Collision and elimination

Collision is checked in `sim.ts` as pure geometry (bird hitbox vs. pipe
rects vs. ground), no DOM/canvas involved. On collision:

- The bird is marked eliminated in the authoritative console-side state
  (it stops receiving gravity/flap updates but its last position is kept
  for the death-frame render).
- The console sends that player a one-shot `{type:'died', place}` via
  plain `sendControl` (not coalesced) — a must-arrive event, same pattern
  as identity assignment and Liar's Dice's private dice reveal.
- All controllers receive the updated live/eliminated roster as part of the
  regular state broadcast (below), so a controller can show "3 birds left"
  without needing its own `died` message to infer it.

### State broadcast: coalesced, per tick is too often

Every live bird's y-position, every pipe's x-position, and the current
live-player count change every tick — sending all of that reliably every
tick would flood the `control` channel. Two tiers:

- **High-frequency, latest-value-wins**: console pushes a compact snapshot
  (`{birds: [...], pipes: [...]}`) to each controller via
  `sendControlCoalesced('roundState', snapshot)`, at whatever rate the
  coalescing sender's microtask flush allows — a dropped/superseded frame
  is fine since the next one supersedes it.
- **One-shot, must-arrive**: round start, a given player's own elimination,
  and round-end/winner use plain `sendControl` — see collision handling
  above and round-end handling below.

Controllers only need `roundState` to render a simple "you're alive / dead,
N birds left" status (the real game view is the console's shared screen);
they don't run their own physics.

### Reconnects

Use the `rejoinToken` pattern from `join()` (§3 of the primitives
addendum): a controller that refreshes or has its phone lock mid-round
rejoins with the same `id`, and the console keeps that bird in its
eliminated-or-alive state rather than spawning a new bird or losing the
slot. A reconnecting controller that was already eliminated just resumes
watching; one that was still alive keeps its bird exactly where the
authoritative console-side simulation left it (the console never paused
the bird for a disconnected controller — no free pass for dropping input).

### Persistence

`saveGameState`/`loadGameState` store: the round's pipe seed, current tick
index (so a console refresh can fast-forward pipe generation to the right
point rather than resuming from tick 0 with mismatched pipes vs. what
controllers already saw), and each player's alive/eliminated status and
score. This is small enough to stay well under the ~2MB cap in a single
key — no sharding needed unless a later feature (persistent leaderboard
across rounds) is added.

### Round end

When zero or one bird remains alive, the console freezes the tick loop's
gravity/collision step (rendering keeps running for the results screen),
computes placements, and sends each controller a one-shot
`{type:'roundOver', place, winnerId}` via `sendControl`. The console shows
a "play again" affordance that starts a fresh round (new seed, all
connected controllers get birds again — including anyone who joined mid
previous round as a spectator).

## Registry entry

Add to `src/examples/registry.ts` (no other file in the registry/switcher
seam changes):

```ts
"flappy-royale": {
  label: "Flappy Royale",
  console: () => import("@examples/flappy-royale/console"),
  controller: () => import("@examples/flappy-royale/controller"),
},
```

## README updates

- Under "Trying the examples," add a one-line entry: *flappy-royale:
  real-time simulation with per-player elimination, seeded/replayable
  procedural generation, and 60Hz tick-vs-render separation.*
- If the flap-batching-per-tick approach (discrete events feeding a
  fixed-tick sim, as distinct from `InputStateSync`'s continuous-state
  model) is useful as a third worked pattern beyond
  `2026-08-24-additional-primitives.md`, add a short cross-reference from
  that doc to `src/examples/flappy-royale/` rather than duplicating the
  explanation — same approach Liar's Dice's doc took for its own patterns.

## Acceptance criteria

- Selecting "Flappy Royale" from the switcher runs a full round — flap,
  collide, eliminate, round-end — across at least 2 controllers, rendered
  live on the console.
- A controller refresh mid-round rejoins with its bird's alive/eliminated
  state intact (via `rejoinToken`), not as a new bird.
- A console refresh mid-round resumes with the same pipe field (via the
  persisted seed + tick index), not a re-shuffled one.
- `sim.ts` has no imports from `PeerConnection`/DO/DOM/canvas and is
  unit-testable as pure functions.
- `gameSource.ts`, `src/logic/`, and `DemoSwitcher.astro` are unchanged by
  this doc.
- README updated per the section above.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- Exact flap impulse / gravity constants (feel/difficulty tuning) aren't
  specified — pick reasonable defaults and flag them as tunable in the PR
  description.
- Whether eliminated birds' bodies stay visible on the console as
  "ragdolled" sprites or simply freeze in place isn't specified — pick
  whichever is simpler given the existing canvas rendering in
  `touch-demo/console.ts`, and flag the choice.
- Behavior when a controller joins **after** a round has already started
  (spectate until next round vs. some other affordance) isn't specified
  beyond "spectator" being acceptable — flag the exact UI chosen.
