export interface PeerNotifier<T extends { id: string } = { id: string }> {
  onPeerJoined(cb: (peer: T) => void): () => void;
  onPeerReady(cb: (peer: T) => void): () => void;
  onPeerLeft(cb: (id: string) => void): () => void;
  notifyJoined(peer: T): void;
  notifyReady(peer: T): void;
  notifyLeft(id: string): void;
}

/**
 * Creates an event-based notifier for player joins, ready transport, and departures.
 */
export function createPeerNotifier<T extends { id: string } = { id: string }>(): PeerNotifier<T> {
  const joinedListeners = new Set<(peer: T) => void>();
  const readyListeners = new Set<(peer: T) => void>();
  const leftListeners = new Set<(id: string) => void>();

  return {
    onPeerJoined(cb: (peer: T) => void) {
      joinedListeners.add(cb);
      return () => joinedListeners.delete(cb);
    },
    onPeerReady(cb: (peer: T) => void) {
      readyListeners.add(cb);
      return () => readyListeners.delete(cb);
    },
    onPeerLeft(cb: (id: string) => void) {
      leftListeners.add(cb);
      return () => leftListeners.delete(cb);
    },
    notifyJoined(peer: T) {
      for (const cb of Array.from(joinedListeners)) cb(peer);
    },
    notifyReady(peer: T) {
      for (const cb of Array.from(readyListeners)) cb(peer);
    },
    notifyLeft(id: string) {
      for (const cb of Array.from(leftListeners)) cb(id);
    },
  };
}
