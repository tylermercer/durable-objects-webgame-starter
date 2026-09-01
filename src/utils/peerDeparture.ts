export interface DepartureEvents {
  /** Ids present last tick, fully absent from ctx.peers this tick (kicked or grace-period-purged). */
  departed: string[];
}

export interface PeerNotifier<T extends { id: string } = { id: string }> {
  onPeerJoined(cb: (peer: T) => void): () => void;
  onPeerLeft(cb: (id: string) => void): () => void;
  notifyJoined(peer: T): void;
  notifyLeft(id: string): void;
  /** Polling diff fallback for environments without explicit event hooks */
  checkDiff(peers: Map<string, T>): { departed: string[] };
}

/**
 * Creates an event-based notifier for player joins and departures.
 */
export function createPeerNotifier<T extends { id: string } = { id: string }>(
  initialPeers?: Map<string, T>
): PeerNotifier<T> {
  const joinedListeners = new Set<(peer: T) => void>();
  const leftListeners = new Set<(id: string) => void>();
  const knownIds = new Set<string>(initialPeers ? Array.from(initialPeers.keys()) : []);

  return {
    onPeerJoined(cb: (peer: T) => void) {
      joinedListeners.add(cb);
      return () => joinedListeners.delete(cb);
    },
    onPeerLeft(cb: (id: string) => void) {
      leftListeners.add(cb);
      return () => leftListeners.delete(cb);
    },
    notifyJoined(peer: T) {
      knownIds.add(peer.id);
      for (const cb of Array.from(joinedListeners)) cb(peer);
    },
    notifyLeft(id: string) {
      if (knownIds.has(id)) {
        knownIds.delete(id);
        for (const cb of Array.from(leftListeners)) cb(id);
      }
    },
    checkDiff(peers: Map<string, T>) {
      const departed: string[] = [];
      for (const id of Array.from(knownIds)) {
        if (!peers.has(id)) {
          knownIds.delete(id);
          departed.push(id);
          for (const cb of Array.from(leftListeners)) cb(id);
        }
      }
      for (const [id, peer] of peers) {
        if (!knownIds.has(id)) {
          knownIds.add(id);
          for (const cb of Array.from(joinedListeners)) cb(peer);
        }
      }
      return { departed };
    },
  };
}

/**
 * Diffs a tracked set of known player ids against the live ctx.peers map.
 * Call once per tick. Mutates `knownIds` in place to the new baseline.
 * Only reports *full* removal — grace-period (still-present-but-disconnected)
 * peers are not departures; see PlayerConnectionStatus for that distinction.
 */
export function diffDepartedPeers(
  knownIds: Set<string>,
  peers: Map<string, { id: string }>
): DepartureEvents {
  const departed: string[] = [];
  for (const id of knownIds) {
    if (!peers.has(id)) {
      departed.push(id);
      knownIds.delete(id);
    }
  }
  for (const id of peers.keys()) {
    knownIds.add(id);
  }
  return { departed };
}
