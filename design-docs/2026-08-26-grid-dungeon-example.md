# Grid Dungeon (world-primitives example)

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-24-core-architecture.md`, `2026-08-24-additional-primitives.md`,
`2026-08-25-example-switcher-and-liars-dice.md`, `2026-08-26-world-primitives.md`

## Goal

Add a fourth entry to the `EXAMPLES` registry: a small top-down dungeon
room where each controller moves its own player around a tile grid with a
joystick, and the console renders everyone on a camera that keeps all
players in view. There's no combat, no win condition, no items — the point
is exercising `TileGrid`, `Camera`, and `EntityRegistry` together the way
`flappy-royale` exercised the fixed-tick loop and seeded RNG, not to be a
finished game.

This is a same-shape follow-on to `2026-08-25-flappy-royale.md`: a new
`src/examples/<id>/` module registered in `registry.ts`, proving
`2026-08-26-world-primitives.md`'s three primitives compose in a real
example before anything is built on top of them for real. **It does not
touch `gameSource.ts`, `src/logic/`, `DemoSwitcher.astro`,
`src/host/console.ts`/`controller.ts`, or any file under `src/utils/`
beyond adding the three primitives' own files if they haven't landed yet.**

If `2026-08-26-world-primitives.md` isn't merged yet, this is blocked on it
— `TileGrid`, `Camera`, and `EntityRegistry` need to exist first.

## Non-goals

- No combat, no enemies, no items, no win/lose condition — this is a
  movement-and-camera demo, not a game. (A real dungeon-crawler is the
  eventual co-op project this template is feeding into, built separately
  on top of the template rather than as this example.)
- No procedural room generation — a single hand-authored fixed layout is
  enough to demonstrate walkability and pathing; procgen is explicitly out
  of scope per `2026-08-26-world-primitives.md`'s Scope section.
- No `findPath` in the player-movement path — players move by direct
  joystick input, not click-to-move. `findPath` is exercised instead by a
  couple of simple wandering NPCs (§ NPCs), since a real usage of
  pathfinding needs *something* to path toward.

## Module layout

```
src/examples/grid-dungeon/
├── types.ts        # PlayerState, NpcState, RoomState, message shapes
├── room.ts          # pure functions: room layout, tick step (movement, NPC wander)
├── console.ts        # createGame({ session, peers }) -> { tick, render }
└── controller.ts      # createGame({ peerConnection }) -> joystick UI
```

`room.ts` must have no dependency on `PeerConnection`, the DO client,
canvas, or any DOM API — same rule as `liars-dice/rules.ts` and
`flappy-royale/sim.ts` — so tick logic is unit-testable with plain
inputs/outputs. It may depend on `TileGrid`, `Camera`, `EntityRegistry`,
and `createRng`, since those are themselves DOM-free.

## Game behavior

### Room layout

One fixed 20×15 `TileGrid<{ walkable: boolean }>`, hand-authored as a
literal array in `room.ts` (a simple bordered room with a few interior
wall segments) — no generation, no persistence of the layout itself since
it never changes. `createRoomGrid()` returns a fresh grid each call so
tests don't share mutable state.

### Players: continuous input via joystick

Movement is exactly the "continuous input" case `InputStateSync`
(`2026-08-24-additional-primitives.md` §1) exists for — a joystick
position is a snapshot, not a discrete event, and a dropped snapshot is
just one stale frame corrected by the next. Controller renders a
fixed-position virtual joystick, and streams `{x, y}` in `[-1, 1]` via
`InputStateSync` at 20Hz, same as that doc's worked example.

Each connected controller gets a `PlayerState` entity in an
`EntityRegistry<PlayerState>` on join, at a fixed spawn tile. `onTick`
reads each player's latest joystick vector, proposes a new position
(`position + vector * speed * dt`), and only commits it if the destination
tile is walkable per the room's `TileGrid` — a proposed move into a wall
tile simply doesn't apply that tick rather than needing any bounce/slide
logic for this demo.

### NPCs: the one thing that needs `findPath`

Two or three stationary-until-provoked NPCs (`NpcState`, also in the same
`EntityRegistry` or a second one — Jules's call, see Open Questions) pick a
random walkable tile as a destination every few seconds via `createRng`,
call `TileGrid.findPath` from their current tile to it, and walk the
returned path one tile per N ticks. This is the smallest possible use of
pathfinding that still exercises it against real wall geometry, rather
than a synthetic test-only call.

### Camera: following the group, not one player

The console is the shared screen, not any one player's screen, so the
camera should keep everyone visible rather than centering on a single
"primary" player. Each tick, `onRender` calls `camera.update(players.map(p
=> p.position))` — the multi-target bounding-box behavior
`2026-08-26-world-primitives.md` §2 calls out specifically as the
motivating case for taking an array rather than a single point. NPCs are
excluded from the camera's targets (they don't need to stay on-screen the
way players do); only rendered if inside the current viewport.

### State broadcast

Same two-tier split as `flappy-royale`: player positions and NPC positions
change every tick, so the console pushes them to controllers via
`sendControlCoalesced('roomState', snapshot)` (controllers only need this
for a simple "N players nearby" status — the real view is the console's
shared screen, same as flappy-royale). There are no one-shot must-arrive
events in this example (no eliminations, no round-end) — if `sendControl`
ends up unused, that's fine and worth noting in the PR rather than forcing
an artificial use of it.

### Reconnects

Use the `rejoinToken` pattern (`2026-08-24-additional-primitives.md` §3):
a controller that refreshes keeps its existing `PlayerState` entity and
position rather than respawning at the start tile. This is a good real
test of `EntityRegistry` + rejoin interacting — the entity's `id` needs to
be the stable player `id` from `join()`, not a fresh id minted per
connection.

### Persistence

Not required for this example — the room layout is static and
regenerating fresh `PlayerState`/`NpcState` entities on a console restart
is acceptable for a movement demo. If it's cheap to wire up
`saveGameState`/`loadGameState` for player positions while touching this
code anyway, that's a reasonable bonus, but skip it if it adds meaningful
scope — this doc's job is proving the three world primitives compose, not
exercising persistence again (`flappy-royale` already covers that).

## Registry entry

Add to `src/examples/registry.ts`:

```ts
"grid-dungeon": {
  label: "Grid Dungeon",
  console: () => import("@examples/grid-dungeon/console"),
  controller: () => import("@examples/grid-dungeon/controller"),
},
```

## README updates

- Under "Trying the examples," add a one-line entry in the existing style:
  *grid-dungeon: tile-grid movement and collision, multi-target camera
  following, and NPC pathfinding via `TileGrid`/`Camera`/`EntityRegistry`.*
- Cross-reference from `2026-08-26-world-primitives.md` to
  `src/examples/grid-dungeon/` as the worked example, same approach
  `flappy-royale`'s doc took for `2026-08-24-additional-primitives.md`.

## Acceptance criteria

- Selecting "Grid Dungeon" from the switcher shows a room on the console;
  each connected controller's joystick moves its own player, blocked
  correctly by wall tiles.
- The camera keeps all connected players in frame as they move apart, up
  to the room's own bounds (players can walk to the edge of the room
  without the camera trying to show space outside the grid).
- At least one NPC visibly paths around a wall segment, not through it.
- A controller refresh mid-session keeps that player's position (via
  `rejoinToken` + stable entity `id`) rather than respawning it.
- `room.ts` has no imports from `PeerConnection`/DO/DOM/canvas and is
  unit-testable as pure functions, same bar as `flappy-royale/sim.ts`.
- `gameSource.ts`, `src/logic/`, and `DemoSwitcher.astro` are unchanged by
  this doc.
- README updated per the section above.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- Whether NPCs live in the same `EntityRegistry<PlayerState | NpcState>`
  (with a `kind` discriminant) or a separate second registry isn't
  specified — either demonstrates the primitive; pick whichever reads
  cleaner against `room.ts`'s tick function and flag the choice.
- Exact room dimensions/layout, player speed, and NPC wander
  interval/tick-per-tile are unspecified — pick reasonable defaults and
  flag them as tunable, same as flappy-royale's physics constants.
- Whether the camera should have `smoothing` set below 1 (eased follow) or
  snap instantly isn't specified — either is a reasonable default for a
  demo; flag the choice.
