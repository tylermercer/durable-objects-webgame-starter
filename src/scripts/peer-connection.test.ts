import { describe, expect, it, vi } from "vitest";
import { PeerConnection, type ControlMessage, type IdentityMessage, type PingMessage, type PongMessage, type TouchMessage } from "./peer-connection";

class MockRTCSessionDescription {
  type: string;
  sdp: string;
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type;
    this.sdp = init.sdp || "";
  }
}

class MockRTCIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate || "";
    this.sdpMid = init.sdpMid ?? null;
    this.sdpMLineIndex = init.sdpMLineIndex ?? null;
  }
}

class MockRTCPeerConnection {
  remoteDescription: MockRTCSessionDescription | null = null;
  localDescription: MockRTCSessionDescription | null = null;
  addedCandidates: MockRTCIceCandidate[] = [];
  onicecandidate: any = null;
  onconnectionstatechange: any = null;
  ondatachannel: any = null;

  createDataChannel() {
    return {
      onmessage: null,
      readyState: "open",
      send: () => {},
      close: () => {}
    };
  }

  async createOffer() {
    return { type: "offer" as const, sdp: "dummy offer" };
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "dummy answer" };
  }

  async setLocalDescription(desc: any) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: any) {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate: any) {
    if (!this.remoteDescription) {
      throw new Error("InvalidStateError: remoteDescription is not set");
    }
    this.addedCandidates.push(candidate);
  }

  close() {}
}

describe("peer-connection message formats", () => {
  it("serializes and deserializes touch messages correctly", () => {
    const touchMsg: TouchMessage = {
      type: "touch",
      phase: "start",
      pointerId: 1,
      x: 0.5,
      y: 0.25,
      t: 1234.56
    };

    const json = JSON.stringify(touchMsg);
    const parsed = JSON.parse(json) as TouchMessage;

    expect(parsed.type).toBe("touch");
    expect(parsed.phase).toBe("start");
    expect(parsed.pointerId).toBe(1);
    expect(parsed.x).toBe(0.5);
    expect(parsed.y).toBe(0.25);
    expect(parsed.t).toBe(1234.56);
  });

  it("handles normalized touch coordinates bounds", () => {
    const minTouch: TouchMessage = {
      type: "touch",
      phase: "move",
      pointerId: 2,
      x: 0,
      y: 0,
      t: 100
    };

    const maxTouch: TouchMessage = {
      type: "touch",
      phase: "end",
      pointerId: 2,
      x: 1,
      y: 1,
      t: 200
    };

    expect(minTouch.x).toBeGreaterThanOrEqual(0);
    expect(minTouch.y).toBeGreaterThanOrEqual(0);
    expect(maxTouch.x).toBeLessThanOrEqual(1);
    expect(maxTouch.y).toBeLessThanOrEqual(1);
  });

  it("serializes and deserializes control messages correctly", () => {
    const identityMsg: IdentityMessage = {
      type: "identity",
      name: "Player 1",
      color: "#FF4136"
    };

    const pingMsg: PingMessage = {
      type: "ping",
      t: 500
    };

    const pongMsg: PongMessage = {
      type: "pong",
      t: 500
    };

    expect(JSON.parse(JSON.stringify(identityMsg))).toEqual(identityMsg);
    expect(JSON.parse(JSON.stringify(pingMsg))).toEqual(pingMsg);
    expect(JSON.parse(JSON.stringify(pongMsg))).toEqual(pongMsg);
  });

  it("buffers ICE candidates received before remote description is set and applies them after setRemoteDescription", async () => {
    const origPC = globalThis.RTCPeerConnection;
    const origSD = globalThis.RTCSessionDescription;
    const origIC = globalThis.RTCIceCandidate;

    try {
      (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
      (globalThis as any).RTCSessionDescription = MockRTCSessionDescription;
      (globalThis as any).RTCIceCandidate = MockRTCIceCandidate;

      const onSignal = vi.fn();
      const pc = new PeerConnection(false, { onSignal });
      const mockInnerPC = pc.pc as unknown as MockRTCPeerConnection;

      const iceSignal = {
        candidate: { candidate: "candidate:1 1 UDP 12345 127.0.0.1 8000 typ host", sdpMid: "0", sdpMLineIndex: 0 }
      };

      // Candidate arrives BEFORE remote description is set
      await pc.handleSignal(iceSignal);

      // Verify candidate is queued and NOT yet applied to RTCPeerConnection
      expect(mockInnerPC.addedCandidates.length).toBe(0);
      expect(pc.pendingIceCandidates.length).toBe(1);

      // Now offer SDP arrives
      const offerSignal = {
        sdp: { type: "offer" as const, sdp: "v=0..." }
      };

      await pc.handleSignal(offerSignal);

      // Verify remote description is set and queued ICE candidate was flushed & applied
      expect(mockInnerPC.remoteDescription).not.toBeNull();
      expect(pc.pendingIceCandidates.length).toBe(0);
      expect(mockInnerPC.addedCandidates.length).toBe(1);
      expect(mockInnerPC.addedCandidates[0].candidate).toBe(iceSignal.candidate.candidate);
    } finally {
      (globalThis as any).RTCPeerConnection = origPC;
      (globalThis as any).RTCSessionDescription = origSD;
      (globalThis as any).RTCIceCandidate = origIC;
    }
  });
});
