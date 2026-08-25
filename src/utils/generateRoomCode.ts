const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Generates a random unambiguous room code (default 5 characters).
 * Excludes ambiguous characters (0, O, 1, I, L).
 */
export function generateRoomCode(length: number = 5): string {
  let code = "";
  const cryptoObj = typeof window !== "undefined" ? window.crypto : globalThis.crypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      code += ALPHABET[bytes[i] % ALPHABET.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  }
  return code;
}
