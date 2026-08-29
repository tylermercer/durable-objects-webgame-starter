import { describe, expect, it, vi } from "vitest";
import { mintMeteredCredentials } from "./turn-credentials";

describe("mintMeteredCredentials", () => {
  it("returns null if env vars are missing", async () => {
    expect(await mintMeteredCredentials({})).toBeNull();
    expect(await mintMeteredCredentials({ METERED_APP_DOMAIN: "test" })).toBeNull();
    expect(await mintMeteredCredentials({ METERED_SECRET_KEY: "secret" })).toBeNull();
  });

  it("calls Metered API and constructs iceServers on success", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({ username: "user123", password: "pass123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    globalThis.fetch = fetchSpy as any;

    try {
      const res = await mintMeteredCredentials({
        METERED_APP_DOMAIN: "mygame",
        METERED_SECRET_KEY: "mysecret"
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://mygame.metered.live/api/v1/turn/credential?secretKey=mysecret",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ expiryInSeconds: 14400, label: "webgame" })
        })
      );

      expect(res).toEqual({
        expiryInSeconds: 14400,
        iceServers: [
          {
            urls: [
              "turn:mygame.metered.live:80",
              "turn:mygame.metered.live:443",
              "turns:mygame.metered.live:443"
            ],
            username: "user123",
            credential: "pass123"
          }
        ]
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns null if fetch fails or response is not ok", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("Error", { status: 500 })) as any;

    try {
      const res = await mintMeteredCredentials({
        METERED_APP_DOMAIN: "mygame",
        METERED_SECRET_KEY: "mysecret"
      });
      expect(res).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
