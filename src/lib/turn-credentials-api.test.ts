import { describe, expect, it, vi } from "vitest";
import { GET as turnGET } from "../pages/api/turn-credentials";
import { GET as signalingGET } from "../pages/api/signaling";

describe("Astro API routes", () => {
  it("turn-credentials GET returns 400 when code parameter is missing", async () => {
    const request = new Request("http://localhost/api/turn-credentials");
    const url = new URL(request.url);
    const locals = {} as any;

    const response = await turnGET({ request, url, locals } as any);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Missing code");
  });

  it("signaling GET returns 400 when code parameter is missing", async () => {
    const request = new Request("http://localhost/api/signaling");
    const url = new URL(request.url);
    const locals = {} as any;

    const response = await signalingGET({ request, url, locals } as any);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Missing code");
  });

  it("turn-credentials GET forwards request to DO based on room code", async () => {
    const mockDoFetch = vi.fn(async () => Response.json({ iceServers: [] }));
    const mockGet = vi.fn(() => ({ fetch: mockDoFetch }));
    const mockIdFromName = vi.fn((code: string) => ({ id: code }));

    const locals = {
      runtime: {
        env: {
          GAME_SESSION: {
            idFromName: mockIdFromName,
            get: mockGet
          }
        }
      }
    } as any;

    const request = new Request("http://localhost/api/turn-credentials?code=abcd");
    const url = new URL(request.url);

    const response = await turnGET({ request, url, locals } as any);
    expect(mockIdFromName).toHaveBeenCalledWith("ABCD");
    expect(mockGet).toHaveBeenCalledWith({ id: "ABCD" });
    expect(mockDoFetch).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });
});
