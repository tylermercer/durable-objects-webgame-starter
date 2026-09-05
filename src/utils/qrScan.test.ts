import { describe, it, expect } from "vitest";
import { parseAndValidateJoinUrl } from "./qrScan";

describe("parseAndValidateJoinUrl", () => {
  const currentOrigin = "https://example.com";

  it("validates a well-formed join URL from the same origin", () => {
    const input = "https://example.com/play/input-demo?code=2A3B4";
    const res = parseAndValidateJoinUrl(input, currentOrigin);

    expect(res.valid).toBe(true);
    expect(res.code).toBe("2A3B4");
    expect(res.targetUrl).toBe("https://example.com/play/input-demo?code=2A3B4");
  });

  it("handles uppercase/lowercase code normalization", () => {
    const input = "https://example.com/?code=abc12";
    const res = parseAndValidateJoinUrl(input, currentOrigin);

    expect(res.valid).toBe(true);
    expect(res.code).toBe("ABC12");
  });

  it("rejects relative URLs without room code", () => {
    const input = "https://example.com/play/input-demo";
    const res = parseAndValidateJoinUrl(input, currentOrigin);

    expect(res.valid).toBe(false);
    expect(res.error).toBe("QR code does not contain a room code");
  });

  it("rejects QR codes from a different origin", () => {
    const input = "https://malicious.com/?code=2A3B4";
    const res = parseAndValidateJoinUrl(input, currentOrigin);

    expect(res.valid).toBe(false);
    expect(res.error).toBe("QR code is for a different site");
  });

  it("rejects empty or non-string input", () => {
    expect(parseAndValidateJoinUrl("", currentOrigin).valid).toBe(false);
    expect(parseAndValidateJoinUrl(null as any, currentOrigin).valid).toBe(false);
  });
});
