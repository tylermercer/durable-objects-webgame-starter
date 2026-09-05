import { describe, expect, it, beforeEach, vi } from "vitest";
import { isController } from "./isController";
import { buildJoinUrl } from "./buildJoinUrl";

describe("isController utility", () => {
  it("returns false when window is undefined or no code query parameter exists", () => {
    vi.stubGlobal("window", {
      location: { search: "?game=input-demo" }
    });
    expect(isController()).toBe(false);
  });

  it("returns true when code query parameter is present", () => {
    vi.stubGlobal("window", {
      location: { search: "?code=ABC12&game=input-demo" }
    });
    expect(isController()).toBe(true);
  });
});

describe("buildJoinUrl utility", () => {
  it("constructs join URL keeping origin, pathname, and adding code parameter", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/play/input-demo" }
    });

    const url = buildJoinUrl("http://localhost:4321", "XYZ99");
    expect(url).toBe("http://localhost:4321/play/input-demo?code=XYZ99");
  });
});
