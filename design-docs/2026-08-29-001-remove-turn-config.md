# Remove TURN Configuration

**Date:** 2026-08-28
**Status:** Proposed
**Depends on:** `2026-08-28-004-relay-fallback-transport.md` (relay fallback transport — implemented)

## Motivation

`2026-08-28-004-relay-fallback-transport.md` added a DO-relayed `GameTransport` fallback that activates both when initial WebRTC negotiation fails to connect and when a previously-connected pair degrades mid-session. That fallback is now implemented and has been confirmed working. It covers exactly the case TURN existed for in this template — a P2P path that STUN alone can't establish or sustain — without requiring deployers to operate a TURN server they trust.

With DO-relay in place, TURN configuration is redundant: it's an alternate relay path that adds infrastructure burden (an externally-hosted TURN server, credentials management) without adding capability the template doesn't already have. Removing it simplifies the connection-establishment logic (fewer code paths to reason about and test) and removes a footgun for deployers who configure TURN but don't fully trust or maintain it, which was the original motivation for building DO-relay in the first place.

## Goals

- Remove all TURN-related configuration, code paths, and documentation from the template.
- Leave connection establishment as: STUN-assisted P2P attempt, then DO-relay fallback (on negotiation timeout or post-connect degradation), per `004`.
- No behavior change to the relay fallback logic itself — this doc only removes the now-unnecessary TURN branch that could previously run before or alongside it.

## Non-goals

- Re-litigating the relay fallback design itself (grace timers, `GameTransport` interface, DO relay RPC methods) — that's settled by `004` and working in production/testing.
- Adding TURN back as an optional advanced feature. If a future user has a specific reason to want it, that's a separate proposal with its own justification, not a revival of this config surface by default.

## Changes

### 1. Environment variables

Remove from the template and its documentation:
- `PUBLIC_TURN_URLS`
- `PUBLIC_TURN_USERNAME`
- `PUBLIC_TURN_CREDENTIAL`

Remove any `.env.example`/`wrangler` config entries and init-script prompts that reference these.

### 2. `PeerConnection` / ICE configuration

In `src/transport/peer-connection.ts`, the `RTCPeerConnection` constructor's `iceServers` config is simplified to STUN-only (a public STUN server, as already used today for candidate discovery). Remove the branch that conditionally appends a `turn:` entry built from the env vars above.

### 3. Negotiation-timeout fallback

`004`'s negotiation-timeout logic currently allows TURN to be attempted (if configured) as an intermediate step before the timeout expires and DO-relay takes over. With TURN removed, this simplifies to: attempt STUN-based P2P negotiation; if not `connected` by the timeout, go straight to `RelayConnection`. No functional loss — DO-relay was already the effective backstop in practice since TURN was never confidently deployed.

### 4. Mid-session degradation promotion

No change to this path — it doesn't reference TURN today. Confirmed as-is.

### 5. Documentation

- README: remove the "TURN Relay Configuration (Optional)" section entirely.
- The README never gained a section describing `004`'s fallback behavior in the first place — that's added here as part of this work, rather than edited from existing text. Add a section (e.g. "Connection fallback," placed near or replacing where "TURN Relay Configuration" currently sits) covering:
  - The two triggers for falling back to DO-relay: initial negotiation timeout, and post-connect degradation (`disconnected`/`failed` past the grace timer).
  - That fallback is DO-relay only — no external server or configuration required, since it reuses the existing signaling WebSocket/RPC session to the `GameSession` DO.
  - That the swap is transparent to game logic via the shared `GameTransport` interface (`PeerConnection`/`RelayConnection`), so `src/logic/console.ts`/`controller.ts` don't need to branch on transport mode.
  - A brief note on channel semantics under relay (delivery becomes reliable/ordered for both `input` and `control`, which is a strict upgrade and requires no game-logic changes).
- Design docs: no changes to `004` itself; this doc supersedes only the TURN-coexistence language in its Open Questions section (the question of whether TURN and DO-relay should coexist is resolved: they don't — TURN is removed).

### 6. Init script

`scripts/init.ts` (or `scripts/eject.ts`, whichever currently prompts for TURN server details, if either does) has that prompt removed.

## Migration notes for existing deployments

Deployers who already configured `PUBLIC_TURN_URLS`/`PUBLIC_TURN_USERNAME`/`PUBLIC_TURN_CREDENTIAL` in their own fork can simply remove those secrets/vars after pulling this change — the code will no longer read them regardless, so leaving them set is harmless but unnecessary.

## Testing

- Re-run the existing relay-fallback test coverage/debug-toggle from `004` to confirm negotiation-timeout and mid-session-degradation promotion both still work with TURN removed from the `iceServers` config.
- Confirm `pnpm astro check`/`pnpm build` pass with the env vars removed (no dangling references).
- Spot check `scripts/init.ts` no longer prompts for TURN details end-to-end.
- Review the new README "Connection fallback" section against the actual `004` implementation for accuracy (grace timer duration, trigger conditions), since it's being written after the fact rather than alongside the original implementation.

## Open questions

- None outstanding — this is a subtractive change with `004` already validated as the sole fallback path.
