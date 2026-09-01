export interface DepartureEvents {
  /** Ids present last tick, fully absent from ctx.peers this tick (kicked or grace-period-purged). */
  departed: string[];
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
