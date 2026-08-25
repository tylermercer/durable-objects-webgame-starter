import type { Bid, ChallengeResult } from "./types";

/**
 * Checks if a proposed bid is valid given the current bid and the total dice in play.
 */
export function isValidBid(
  currentBid: Bid | null,
  newBid: { count: number; face: number },
  totalDiceInPlay: number
): boolean {
  if (!Number.isInteger(newBid.count) || !Number.isInteger(newBid.face)) {
    return false;
  }
  if (newBid.face < 1 || newBid.face > 6) {
    return false;
  }
  if (newBid.count < 1 || newBid.count > totalDiceInPlay) {
    return false;
  }

  if (!currentBid) {
    return true;
  }

  if (newBid.count > currentBid.count) {
    return true;
  }
  if (newBid.count === currentBid.count && newBid.face > currentBid.face) {
    return true;
  }

  return false;
}

/**
 * Counts total matching dice across all hands for a given face value.
 */
export function countMatchingDice(
  allHands: Record<string, number[]> | number[][],
  targetFace: number
): number {
  let total = 0;
  const hands = Array.isArray(allHands) ? allHands : Object.values(allHands);

  for (const hand of hands) {
    for (const die of hand) {
      if (die === targetFace) {
        total++;
      }
    }
  }

  return total;
}

/**
 * Resolves a challenge on the current bid.
 */
export function resolveChallenge(
  currentBid: Bid,
  challengerId: string,
  challengerName: string,
  allHands: Record<string, number[]>,
  playerNames: Record<string, string>
): ChallengeResult {
  const actualCount = countMatchingDice(allHands, currentBid.face);
  const challengeSuccess = actualCount < currentBid.count;

  const loserId = challengeSuccess ? currentBid.bidderId : challengerId;
  const loserName = playerNames[loserId] || (challengeSuccess ? currentBid.bidderName : challengerName);

  return {
    challengerId,
    challengerName,
    bidderId: currentBid.bidderId,
    bidderName: currentBid.bidderName,
    bid: currentBid,
    actualCount,
    challengeSuccess,
    loserId,
    loserName,
    allHands
  };
}
