import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => {
  return {
    DurableObject: class DurableObject {
      constructor(public ctx: any, public env: any) {}
    }
  };
});

import { GameSession } from "./GameSession";

describe("GameSession Durable Object", () => {
  it("rejects non-websocket upgrade requests with status 426", async () => {
    const state = {} as any;
    const env = {} as any;
    const session = new GameSession(state, env);

    const request = new Request("http://localhost/api/signaling?code=TEST1&role=console");
    const response = await session.fetch(request);

    expect(response.status).toBe(426);
    const text = await response.text();
    expect(text).toContain("Expected Upgrade: websocket");
  });

  it("rejects websocket requests with invalid role with status 400", async () => {
    const state = {} as any;
    const env = {} as any;
    const session = new GameSession(state, env);

    const request = new Request("http://localhost/api/signaling?code=TEST1&role=invalid", {
      headers: { Upgrade: "websocket" }
    });
    const response = await session.fetch(request);

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("Invalid role");
  });
});
