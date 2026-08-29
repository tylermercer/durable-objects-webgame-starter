import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ConnectionOrchestrator } from "./connectionOrchestrator";
import { PeerConnection } from "./peer-connection";
import { RelayConnection } from "./relay-connection";

class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: any = null;
  ondatachannel: any = null;

  createDataChannel() {
    return {
      onmessage: null,
      readyState: "open",
      send: () => {},
      close: () => {},
    };
  }

  async createOffer() {
    return { type: "offer" as const, sdp: "mock sdp offer" };
  }

  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}

  close() {
    this.connectionState = "closed";
  }
}

describe("ConnectionOrchestrator", () => {
  let originalRTC: any;

  beforeEach(() => {
    originalRTC = globalThis.RTCPeerConnection;
    (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
    vi.useFakeTimers();
  });

  afterEach(() => {
    (globalThis as any).RTCPeerConnection = originalRTC;
    vi.useRealTimers();
  });

  it("initializes as PeerConnection in default mode and fires onTransportChange", () => {
    const onTransportChange = vi.fn();
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange,
      }
    );

    expect(orchestrator.transport).toBeInstanceOf(PeerConnection);
    expect(onTransportChange).toHaveBeenCalledWith(orchestrator.transport);
    expect(orchestrator.transport.mode).toBe("p2p");
    orchestrator.close();
  });

  it("initializes directly as RelayConnection when forcedTransport is 'relay'", () => {
    const onTransportChange = vi.fn();
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: "relay",
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange,
      }
    );

    expect(orchestrator.transport).toBeInstanceOf(RelayConnection);
    expect(onTransportChange).toHaveBeenCalledWith(orchestrator.transport);
    expect(orchestrator.transport.mode).toBe("relay");
    orchestrator.close();
  });

  it("promotes to RelayConnection on negotiation timeout (default 8000ms)", () => {
    const transportHistory: any[] = [];
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: (t) => transportHistory.push(t),
      }
    );

    expect(transportHistory.length).toBe(1);
    expect(transportHistory[0].mode).toBe("p2p");

    vi.advanceTimersByTime(7999);
    expect(orchestrator.transport.mode).toBe("p2p");

    vi.advanceTimersByTime(1);
    expect(transportHistory.length).toBe(2);
    expect(orchestrator.transport).toBeInstanceOf(RelayConnection);
    expect(orchestrator.transport.mode).toBe("relay");
    orchestrator.close();
  });

  it("does not promote on negotiation timeout if P2P connects before timeout", () => {
    const transportHistory: any[] = [];
    const onStateChange = vi.fn();

    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: (t) => transportHistory.push(t),
        onStateChange,
      }
    );

    const innerPC = (orchestrator.transport as PeerConnection).pc as unknown as MockRTCPeerConnection;
    innerPC.connectionState = "connected";
    innerPC.onconnectionstatechange?.();

    expect(onStateChange).toHaveBeenCalledWith("connected");

    vi.advanceTimersByTime(10000);
    expect(transportHistory.length).toBe(1);
    expect(orchestrator.transport.mode).toBe("p2p");
    orchestrator.close();
  });

  it("promotes on disconnect grace period timeout (default 4000ms) if disconnected", () => {
    const transportHistory: any[] = [];
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: (t) => transportHistory.push(t),
      }
    );

    const innerPC = (orchestrator.transport as PeerConnection).pc as unknown as MockRTCPeerConnection;
    innerPC.connectionState = "connected";
    innerPC.onconnectionstatechange?.();

    // Now disconnect
    innerPC.connectionState = "disconnected";
    innerPC.onconnectionstatechange?.();

    vi.advanceTimersByTime(3999);
    expect(orchestrator.transport.mode).toBe("p2p");

    vi.advanceTimersByTime(1);
    expect(orchestrator.transport.mode).toBe("relay");
    orchestrator.close();
  });

  it("recovers from disconnected state if reconnected before grace period expires", () => {
    const transportHistory: any[] = [];
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: (t) => transportHistory.push(t),
      }
    );

    const innerPC = (orchestrator.transport as PeerConnection).pc as unknown as MockRTCPeerConnection;
    innerPC.connectionState = "connected";
    innerPC.onconnectionstatechange?.();

    // Disconnect
    innerPC.connectionState = "disconnected";
    innerPC.onconnectionstatechange?.();

    vi.advanceTimersByTime(2000);

    // Reconnect
    innerPC.connectionState = "connected";
    innerPC.onconnectionstatechange?.();

    vi.advanceTimersByTime(5000);
    expect(orchestrator.transport.mode).toBe("p2p");
    orchestrator.close();
  });

  it("promotes immediately on failed state", () => {
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: vi.fn(),
      }
    );

    const innerPC = (orchestrator.transport as PeerConnection).pc as unknown as MockRTCPeerConnection;
    innerPC.connectionState = "failed";
    innerPC.onconnectionstatechange?.();

    expect(orchestrator.transport.mode).toBe("relay");
    orchestrator.close();
  });

  it("suppresses auto-promotion when forcedTransport is 'rtc'", () => {
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: "rtc",
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: vi.fn(),
      }
    );

    // Negotiation timeout pass
    vi.advanceTimersByTime(10000);
    expect(orchestrator.transport.mode).toBe("p2p");

    // Failed state
    const innerPC = (orchestrator.transport as PeerConnection).pc as unknown as MockRTCPeerConnection;
    innerPC.connectionState = "failed";
    innerPC.onconnectionstatechange?.();

    expect(orchestrator.transport.mode).toBe("p2p");
    orchestrator.close();
  });

  it("forcePromoteToRelay is idempotent", () => {
    const transportHistory: any[] = [];
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: (t) => transportHistory.push(t),
      }
    );

    expect(transportHistory.length).toBe(1);
    orchestrator.forcePromoteToRelay();
    expect(transportHistory.length).toBe(2);
    expect(orchestrator.transport.mode).toBe("relay");

    // Second call should be a no-op
    orchestrator.forcePromoteToRelay();
    expect(transportHistory.length).toBe(2);
    orchestrator.close();
  });

  it("handleRelayInput and handleRelayControl promote to relay and forward messages", () => {
    const onInputMessage = vi.fn();
    const onControlMessage = vi.fn();

    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: false,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: vi.fn(),
        onInputMessage,
        onControlMessage,
      }
    );

    expect(orchestrator.transport.mode).toBe("p2p");

    const inputPayload = { type: "touch", phase: "start", pointerId: 1, x: 0.5, y: 0.5, t: 100 };
    orchestrator.handleRelayInput(inputPayload);

    expect(orchestrator.transport.mode).toBe("relay");
    expect(onInputMessage).toHaveBeenCalledWith(inputPayload);

    const controlPayload = { type: "identity", name: "P1", color: "#FF0000" };
    orchestrator.handleRelayControl(controlPayload);

    expect(onControlMessage).toHaveBeenCalledWith(controlPayload);
    orchestrator.close();
  });

  it("close() prevents any late timer callbacks or signals from executing", () => {
    const onStateChange = vi.fn();
    const orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        forcedTransport: null,
        getApi: () => null,
      },
      {
        onSignal: vi.fn(),
        onTransportChange: vi.fn(),
        onStateChange,
      }
    );

    const pc = orchestrator.transport as PeerConnection;
    orchestrator.close();

    vi.advanceTimersByTime(10000);
    expect(orchestrator.transport.mode).toBe("p2p"); // closed P2P, never promoted to relay

    // Simulated event on closed inner PC
    (pc.pc as unknown as MockRTCPeerConnection).connectionState = "failed";
    (pc.pc as unknown as MockRTCPeerConnection).onconnectionstatechange?.();

    expect(onStateChange).not.toHaveBeenCalled();
  });
});
