import { describe, it, expect } from "vitest";
import { isValidBid, countMatchingDice, resolveChallenge } from "./rules";
import type { Bid } from "./types";

describe("Liar's Dice Rules Engine", () => {
  describe("isValidBid", () => {
    it("accepts valid initial bid within total dice in play", () => {
      expect(isValidBid(null, { count: 1, face: 3 }, 10)).toBe(true);
      expect(isValidBid(null, { count: 10, face: 6 }, 10)).toBe(true);
    });

    it("rejects invalid face or count ranges", () => {
      expect(isValidBid(null, { count: 0, face: 3 }, 10)).toBe(false);
      expect(isValidBid(null, { count: 11, face: 3 }, 10)).toBe(false);
      expect(isValidBid(null, { count: 2, face: 0 }, 10)).toBe(false);
      expect(isValidBid(null, { count: 2, face: 7 }, 10)).toBe(false);
      expect(isValidBid(null, { count: 1.5, face: 3 }, 10)).toBe(false);
    });

    it("requires higher count OR same count higher face for subsequent bids", () => {
      const currentBid: Bid = { count: 2, face: 4, bidderId: "p1", bidderName: "Alice" };

      // Lower count -> false
      expect(isValidBid(currentBid, { count: 1, face: 5 }, 10)).toBe(false);

      // Same count, lower face -> false
      expect(isValidBid(currentBid, { count: 2, face: 3 }, 10)).toBe(false);

      // Same count, same face -> false
      expect(isValidBid(currentBid, { count: 2, face: 4 }, 10)).toBe(false);

      // Same count, higher face -> true
      expect(isValidBid(currentBid, { count: 2, face: 5 }, 10)).toBe(true);

      // Higher count, lower face -> true
      expect(isValidBid(currentBid, { count: 3, face: 1 }, 10)).toBe(true);
    });
  });

  describe("countMatchingDice", () => {
    it("correctly counts matching dice across all hands", () => {
      const hands = {
        p1: [1, 4, 4, 5, 6],
        p2: [4, 2, 3, 4, 1],
      };

      expect(countMatchingDice(hands, 4)).toBe(4);
      expect(countMatchingDice(hands, 1)).toBe(2);
      expect(countMatchingDice(hands, 6)).toBe(1);
      expect(countMatchingDice(hands, 2)).toBe(1);
    });

    it("works with array of arrays input", () => {
      const hands = [
        [3, 3, 3],
        [2, 3, 4]
      ];
      expect(countMatchingDice(hands, 3)).toBe(4);
    });
  });

  describe("resolveChallenge", () => {
    const playerNames = { p1: "Alice", p2: "Bob" };
    const bid: Bid = { count: 3, face: 5, bidderId: "p1", bidderName: "Alice" };

    it("resolves challenge as successful when actual count is less than bid count (bidder loses)", () => {
      const hands = {
        p1: [5, 5, 1],
        p2: [2, 3, 4]
      }; // Total 5s = 2 (< 3)

      const result = resolveChallenge(bid, "p2", "Bob", hands, playerNames);
      expect(result.challengeSuccess).toBe(true);
      expect(result.loserId).toBe("p1");
      expect(result.loserName).toBe("Alice");
      expect(result.actualCount).toBe(2);
    });

    it("resolves challenge as failed when actual count is >= bid count (challenger loses)", () => {
      const hands = {
        p1: [5, 5, 1],
        p2: [5, 3, 4]
      }; // Total 5s = 3 (>= 3)

      const result = resolveChallenge(bid, "p2", "Bob", hands, playerNames);
      expect(result.challengeSuccess).toBe(false);
      expect(result.loserId).toBe("p2");
      expect(result.loserName).toBe("Bob");
      expect(result.actualCount).toBe(3);
    });
  });
});
