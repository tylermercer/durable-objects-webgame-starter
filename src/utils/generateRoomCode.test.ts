import { describe, expect, it } from "vitest";
import { generateRoomCode } from "./generateRoomCode";

const ALLOWED_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const FORBIDDEN_CHARS = ["0", "O", "1", "I", "L"];

describe("generateRoomCode", () => {
  it("generates a code of default length 5", () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(5);
  });

  it("generates a code of specified length", () => {
    const code6 = generateRoomCode(6);
    expect(code6).toHaveLength(6);

    const code8 = generateRoomCode(8);
    expect(code8).toHaveLength(8);
  });

  it("only contains unambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode(6);
      for (const char of code) {
        expect(ALLOWED_ALPHABET).toContain(char);
        expect(FORBIDDEN_CHARS).not.toContain(char);
      }
    }
  });

  it("generates unique room codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateRoomCode(5));
    }
    expect(codes.size).toBeGreaterThan(90);
  });
});
