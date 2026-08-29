import type { ConsoleContext, ConsoleGameInstance, ControllerPeer } from "@contract/gameTypes";
import type { GameTransport } from "@transport/transport";
import { createRng } from "@utils/rng";
import { Deck } from "@utils/deck";
import { TurnOrder } from "@utils/turnOrder";
import { RoundFlow } from "@utils/roundFlow";
import { createStore } from "@react/reactStore";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { UnoConsole } from "./UnoConsole";
import { CARD_COLORS, createUnoDeck, drawPenaltyOf, hasPlayableCard, isPlayable, isWild } from "./rules";
import type {
  CardColor,
  PersistedUnoState,
  PlayerPublicInfo,
  PublicUnoState,
  UnoCard,
  UnoControlMessage,
  UnoPhase,
} from "./types";

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  let deck: Deck<UnoCard> = new Deck<UnoCard>([], createRng(1));
  let hands: Map<string, UnoCard[]> = new Map();
  let turnOrder: TurnOrder = new TurnOrder([]);
  let roundFlow: RoundFlow<UnoPhase> = new RoundFlow<UnoPhase>("waiting");
  let activeColor: CardColor | null = null;
  let roundSeed = Math.floor(Math.random() * 2147483647);
  let winner: { id: string; name: string } | null = null;

  const attachedListeners = new Map<string, GameTransport>();
  const knownPlayerIds = new Set<string>();

  function getFirstPlayerId(): string | null {
    for (const peer of ctx.peers.values()) {
      if (peer.isFirstPlayer && (peer.status === "live" || peer.status === "live-relay" || peer.state === "connected")) {
        return peer.id;
      }
    }
    for (const peer of ctx.peers.values()) {
      if (peer.status === "live" || peer.status === "live-relay" || peer.state === "connected") return peer.id;
    }
    return null;
  }

  function isConnected(peer: ControllerPeer): boolean {
    return peer.status ? (peer.status === "live" || peer.status === "live-relay") : peer.state === "connected";
  }

  function sendHand(peer: ControllerPeer, hand: UnoCard[]) {
    peer.pc?.sendControl({ type: "yourHand", hand } as unknown as UnoControlMessage);
  }

  function startNextGame() {
    const activePlayerIds = Array.from(ctx.peers.keys());
    if (activePlayerIds.length < 2) {
      roundFlow.transition("waiting");
      broadcastState();
      persistState();
      return;
    }

    roundSeed = Math.floor(Math.random() * 2147483647);
    deck = new Deck<UnoCard>(createUnoDeck(), createRng(roundSeed));
    hands = new Map();
    for (const id of activePlayerIds) {
      hands.set(id, deck.drawMany(7));
    }

    // Redraw if the opening card is a Wild Draw Four; otherwise play it as-is
    // (including other action cards, which have no special first-turn effect
    // in this simplified ruleset — see design-docs/2026-08-28-002).
    let starter = deck.draw();
    while (starter && starter.value === "wild4") {
      deck.discard(starter);
      starter = deck.draw();
    }
    if (starter) {
      deck.discard(starter);
      activeColor = starter.color === "wild"
        ? CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)]
        : (starter.color as CardColor);
    }

    turnOrder = new TurnOrder(activePlayerIds);
    winner = null;
    roundFlow.transition("playing");

    for (const [id, hand] of hands) {
      const peer = ctx.peers.get(id);
      if (peer) sendHand(peer, hand);
    }

    broadcastState();
    persistState();
  }

  function applyEffectAndAdvance(card: UnoCard) {
    const penalty = drawPenaltyOf(card);
    if (penalty > 0) {
      turnOrder.advance(); // move to the victim
      const victimId = turnOrder.current();
      if (victimId) {
        const victimHand = hands.get(victimId) ?? [];
        victimHand.push(...deck.drawMany(penalty));
        hands.set(victimId, victimHand);
        const victimPeer = ctx.peers.get(victimId);
        if (victimPeer) sendHand(victimPeer, victimHand);
      }
      turnOrder.advance(); // skip the victim's turn
      return;
    }

    if (card.value === "reverse") {
      turnOrder.reverse();
      turnOrder.advance();
      if (turnOrder.all().length === 2) turnOrder.advance(); // 2p: reverse acts as skip
      return;
    }

    turnOrder.advance();
    if (card.value === "skip") turnOrder.advance();
  }

  function handleControlMessage(fromId: string, msg: UnoControlMessage) {
    const peer = ctx.peers.get(fromId);
    if (!peer) return;

    if (msg.type === "requestSync") {
      const hand = hands.get(fromId);
      if (hand) sendHand(peer, hand);
      peer.pc?.sendControlCoalesced("gameState", { type: "gameState", state: getPublicUnoState() });
      return;
    }

    const firstPlayerId = getFirstPlayerId();

    if (msg.type === "requestStart") {
      if (fromId === firstPlayerId && roundFlow.is("waiting") && ctx.peers.size >= 2) {
        startNextGame();
      }
      return;
    }

    if (msg.type === "playAgain") {
      if (fromId === firstPlayerId && roundFlow.is("roundOver")) {
        startNextGame();
      }
      return;
    }

    if (!roundFlow.is("playing")) return;
    if (!turnOrder.isCurrent(fromId)) return;

    const hand = hands.get(fromId) ?? [];
    const topCard = deck.topOfDiscard();
    if (!topCard || !activeColor) return;

    if (msg.type === "playCard") {
      const cardIdx = hand.findIndex(c => c.id === msg.cardId);
      if (cardIdx === -1) return;
      const card = hand[cardIdx];
      if (!isPlayable(card, topCard, activeColor)) return;
      if (isWild(card) && !msg.chosenColor) return; // must choose a color for wild plays

      hand.splice(cardIdx, 1);
      hands.set(fromId, hand);
      deck.discard(card);
      activeColor = isWild(card) ? msg.chosenColor! : (card.color as CardColor);
      sendHand(peer, hand);

      if (hand.length === 0) {
        winner = { id: fromId, name: peer.name };
        roundFlow.transition("roundOver");
        broadcastState();
        persistState();
        return;
      }

      applyEffectAndAdvance(card);
      broadcastState();
      persistState();
    } else if (msg.type === "drawCard") {
      // Simplified rule: drawing is only allowed when the player has no
      // legal play, and the drawn card just joins the hand (no immediate
      // follow-up play) — see design-docs/2026-08-28-002.
      if (hasPlayableCard(hand, topCard, activeColor)) return;
      const drawn = deck.draw();
      if (drawn) {
        hand.push(drawn);
        hands.set(fromId, hand);
        sendHand(peer, hand);
      }
      turnOrder.advance();
      broadcastState();
      persistState();
    }
  }

  function getPublicUnoState(): PublicUnoState {
    const turnPlayerId = turnOrder.current();
    const turnPeer = turnPlayerId ? ctx.peers.get(turnPlayerId) : null;

    const players: PlayerPublicInfo[] = Array.from(ctx.peers.values()).map(peer => ({
      id: peer.id,
      name: peer.name,
      color: peer.color,
      cardCount: (hands.get(peer.id) ?? []).length,
      isTurn: peer.id === turnPlayerId,
      connected: isConnected(peer),
    }));

    return {
      phase: roundFlow.current(),
      topCard: deck.topOfDiscard() ?? null,
      activeColor,
      direction: turnOrder.toJSON().direction,
      drawPileCount: deck.remainingInDrawPile(),
      players,
      turnPlayerId,
      turnPlayerName: turnPeer ? turnPeer.name : null,
      winner,
      firstPlayerId: getFirstPlayerId(),
    };
  }

  const store = createStore<PublicUnoState>(getPublicUnoState());

  const root: Root = createRoot(ctx.viewport.container);
  root.render(
    React.createElement(UnoConsole, {
      store,
      ctx,
      onStartGame: () => startNextGame(),
    })
  );

  function broadcastState() {
    const state = getPublicUnoState();
    store.set(state);
    for (const peer of ctx.peers.values()) {
      if (peer.pc) {
        peer.pc.sendControlCoalesced("gameState", { type: "gameState", state });
      }
    }
  }

  function persistState() {
    if (!ctx.session) return;
    const stateToSave: PersistedUnoState = {
      deck: deck.toJSON(),
      hands: Object.fromEntries(hands),
      turnOrder: turnOrder.toJSON(),
      roundFlow: roundFlow.toJSON(),
      activeColor,
      roundSeed,
      winner,
    };
    ctx.session.saveGameState(stateToSave).catch(err => {
      console.error("Failed to persist game state:", err);
    });
  }

  if (ctx.session) {
    ctx.session.loadGameState().then(saved => {
      if (saved && typeof saved === "object") {
        const state = saved as PersistedUnoState;
        roundSeed = state.roundSeed ?? roundSeed;
        deck = Deck.fromJSON(state.deck ?? { drawPile: [], discardPile: [] }, createRng(roundSeed));
        hands = new Map(Object.entries(state.hands ?? {}));
        turnOrder = new TurnOrder([], state.turnOrder);
        roundFlow = new RoundFlow<UnoPhase>("waiting", state.roundFlow);
        activeColor = state.activeColor ?? null;
        winner = state.winner ?? null;
        broadcastState();
      }
    }).catch(err => {
      console.error("Failed to load persisted game state:", err);
    });
  }

  function syncRemovedPlayers() {
    for (const id of Array.from(knownPlayerIds)) {
      if (!ctx.peers.has(id)) {
        knownPlayerIds.delete(id);
        turnOrder.removePlayer(id);
        hands.delete(id);
      }
    }
    for (const id of ctx.peers.keys()) knownPlayerIds.add(id);
  }

  function syncPeersAndListeners() {
    for (const [id, pc] of Array.from(attachedListeners.entries())) {
      const peer = ctx.peers.get(id);
      if (!peer || !peer.pc || peer.pc !== pc || !isConnected(peer)) {
        attachedListeners.delete(id);
      }
    }

    for (const [id, peer] of ctx.peers) {
      const isLive = isConnected(peer);
      if (peer.pc && isLive && attachedListeners.get(id) !== peer.pc) {
        attachedListeners.set(id, peer.pc);
        peer.pc.addControlListener(msg => {
          handleControlMessage(id, msg as unknown as UnoControlMessage);
        });

        const hand = hands.get(id);
        if (hand) sendHand(peer, hand);
        peer.pc.sendControlCoalesced("gameState", { type: "gameState", state: getPublicUnoState() });
      }
    }
  }

  return {
    tick: () => {
      syncPeersAndListeners();
      if (roundFlow.is("playing")) syncRemovedPlayers();
      store.set(getPublicUnoState());
    },

    destroy: () => {
      root.unmount();
      ctx.viewport.container.innerHTML = "";
    },
  };
}
