# Console & Controller API Reference

This document defines the interface contracts for console and controller game modules, execution contexts, platform interfaces, network message schemas, and virtual gamepad components.

## Table of Contents

- [Game Entrypoint Contracts](#game-entrypoint-contracts)
  - [ConsoleGameModule](#consolegamemodule)
  - [ConsoleGameInstance](#consolegameinstance)
  - [ControllerGameModule](#controllergamemodule)
  - [ControllerGameInstance](#controllergameinstance)
  - [ControllerTypeRange](#controllertyperange)
  - [GamepadControllerConfig](#gamepadcontrollerconfig)
- [Execution Context Interfaces](#execution-context-interfaces)
  - [ConsoleContext](#consolecontext)
  - [ConsoleStorage](#consolestorage)
  - [ControllerContext](#controllercontext)
- [Platform Interfaces](#platform-interfaces)
  - [GameViewport](#gameviewport)
  - [ViewportSize](#viewportsize)
  - [ControllerPeer](#controllerpeer)
  - [PlayerConnectionStatus](#playerconnectionstatus)
  - [GameTransport](#gametransport)
  - [TransportMode](#transportmode)
  - [ConsoleApi](#consoleapi)
- [Message Schemas](#message-schemas)
  - [Input Message Types](#input-message-types)
  - [Control Message Types](#control-message-types)
- [Virtual Gamepad Component](#virtual-gamepad-component)
  - [createVirtualGamepad](#createvirtualgamepad)
  - [VirtualGamepadOptions](#virtualgamepadoptions)
  - [VirtualGamepadInstance](#virtualgamepadinstance)

---

## Game Entrypoint Contracts

### ConsoleGameModule

The interface exported by a console game entrypoint (`src/logic/console.ts`).

```typescript
export interface ConsoleGameModule {
  createGame(ctx: ConsoleContext): ConsoleGameInstance;
  controllerTypes?: {
    phone?: ControllerTypeRange;
    gamepad?: GamepadControllerConfig;
  };
}
```

#### Properties & Methods

- `createGame(ctx: ConsoleContext): ConsoleGameInstance`
  - **Description**: Instantiates and initializes the console game simulation and rendering.
  - **Parameters**: `ctx` — The console execution context supplied by the platform host.
  - **Returns**: A `ConsoleGameInstance` object containing lifecycle hook callbacks.
- `controllerTypes` *(optional)*
  - **Description**: Declares player count constraints and supported controller input modalities.
  - **Properties**:
    - `phone` *(optional)*: Player count range constraints for phone-based web controllers.
    - `gamepad` *(optional)*: Player count range constraints and button label configurations for local physical gamepads, keyboard controllers, and generic virtual gamepads.

---

### ConsoleGameInstance

The lifecycle object returned by `ConsoleGameModule.createGame`.

```typescript
export interface ConsoleGameInstance {
  tick?: (dt: number) => void;
  render?: (alpha: number) => void;
  destroy?: () => void;
}
```

#### Properties & Methods

- `tick?(dt: number): void`
  - **Description**: Fixed-step simulation tick callback.
  - **Parameters**: `dt` — Time elapsed since previous tick in seconds.
  - **Contract**: Invoked by the platform game loop at a fixed rate (e.g. 30 Hz). State progression and authoritative simulation logic occur here.
- `render?(alpha: number): void`
  - **Description**: Frame rendering callback.
  - **Parameters**: `alpha` — Interpolation factor between 0.0 and 1.0 representing fractional tick progress.
  - **Contract**: Invoked on every animation frame. Rendering logic interpolates visual positions using `alpha` without mutating fixed simulation state.
- `destroy?(): void`
  - **Description**: Cleanup hook invoked when the console game is stopped, restarted, or unmounted.
  - **Contract**: Releases DOM resources, removes event listeners, unmounts rendering engines, and cancels active timers.

---

### ControllerGameModule

The interface exported by a controller game entrypoint (`src/logic/controller.ts`).

```typescript
export interface ControllerGameModule {
  createGame(ctx: ControllerContext): ControllerGameInstance;
}
```

#### Properties & Methods

- `createGame(ctx: ControllerContext): ControllerGameInstance`
  - **Description**: Instantiates and initializes the controller UI and input handling.
  - **Parameters**: `ctx` — The controller execution context supplied by the platform host.
  - **Returns**: A `ControllerGameInstance` object.

---

### ControllerGameInstance

The lifecycle object returned by `ControllerGameModule.createGame`.

```typescript
export interface ControllerGameInstance {
  destroy?: () => void;
}
```

#### Properties & Methods

- `destroy?(): void`
  - **Description**: Cleanup hook invoked when the controller is disconnected, kicked, or unmounted.
  - **Contract**: Removes event listeners, stops local input synchronization timers, and tears down local DOM elements.

---

### ControllerTypeRange

Defines numeric range constraints for supported controller types.

```typescript
export interface ControllerTypeRange {
  min?: number;
  max?: number;
}
```

#### Properties

- `min` *(optional)*: Minimum number of players required for this controller modality.
- `max` *(optional)*: Maximum number of players supported for this controller modality.

---

### GamepadControllerConfig

Extends `ControllerTypeRange` with gamepad-specific configuration including custom button labels.

```typescript
export interface GamepadControllerConfig extends ControllerTypeRange {
  buttonLabels?: string[];
}
```

#### Properties

- `min` *(optional)*: Minimum number of gamepad players required.
- `max` *(optional)*: Maximum number of gamepad players supported.
- `buttonLabels` *(optional)*: Custom button label strings configured by the console for action buttons (e.g. `["FIRE", "BOOST"]`).

---

## Execution Context Interfaces

### ConsoleContext

The execution context object passed to `ConsoleGameModule.createGame`.

```typescript
export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  roomCode: string;
  peers: Map<string, ControllerPeer>;
  viewport: GameViewport;
  storage: ConsoleStorage;
  onPeerJoined: (cb: (peer: ControllerPeer) => void) => () => void;
  onPeerReady: (cb: (peer: ControllerPeer) => void) => () => void;
  onPeerLeft: (cb: (id: string) => void) => () => void;
}
```

#### Properties & Methods

- `session`: `RpcStub<ConsoleApi> | null` — Cap'n Web RPC session stub connected to the signaling Durable Object, or `null` if signaling is offline.
- `roomCode`: `string` — The uppercase room code identifier for the current session.
- `peers`: `Map<string, ControllerPeer>` — Live map of peer IDs to `ControllerPeer` objects representing all currently registered controllers.
- `viewport`: `GameViewport` — The DOM container and viewport management interface for game rendering.
- `storage`: `ConsoleStorage` — Interface for local room simulation state persistence (`saveRoomState`, `getSavedRoomState`, `clearSavedRoomState`).
- `onPeerJoined(cb: (peer: ControllerPeer) => void): () => void` — Subscribes a callback to peer registration events (fired when a peer joins signaling). Returns an unsubscribe function.
- `onPeerReady(cb: (peer: ControllerPeer) => void): () => void` — Subscribes a callback to peer readiness events (fired when a transport connection `pc` is established). Returns an unsubscribe function.
- `onPeerLeft(cb: (id: string) => void): () => void` — Subscribes a callback to peer departure events (fired when a peer disconnects or is purged). Returns an unsubscribe function.

---

### ConsoleStorage

The storage interface provided via `ctx.storage` on the `ConsoleContext`.

```typescript
export interface ConsoleStorage {
  saveRoomState: (data: unknown) => void;
  getSavedRoomState: <T = unknown>() => T | null;
  clearSavedRoomState: () => void;
}
```

#### Properties & Methods

- `saveRoomState(data: unknown): void` — Serializes and persists simulation state in local storage namespaced to the current room code.
- `getSavedRoomState<T = unknown>(): T | null` — Retrieves and deserializes saved simulation state for the current room code, or returns `null` if not found.
- `clearSavedRoomState(): void` — Removes saved simulation state for the current room code from local storage.

---

### ControllerContext

The execution context object passed to `ControllerGameModule.createGame`.

```typescript
export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer: () => boolean;
}
```

#### Properties & Methods

- `peerConnection`: `GameTransport | null` — The active bidirectional transport connection to the console host, or `null` if not connected.
- `isFirstPlayer()`: `() => boolean` — Returns `true` if this controller instance is designated as the first player / room host, `false` otherwise.

---

## Platform Interfaces

### GameViewport

Provides DOM lifecycle and size monitoring for console game rendering.

```typescript
export interface GameViewport {
  container: HTMLElement;
  initialSize: ViewportSize;
  onResize: (callback: (size: ViewportSize) => void) => () => void;
}
```

#### Properties & Methods

- `container`: `HTMLElement` — An empty DOM container element exclusively allocated to the active game instance.
- `initialSize`: `ViewportSize` — CSS pixel dimensions of `container` when `createGame` was called.
- `onResize(callback: (size: ViewportSize) => void): () => void` — Subscribes to container size changes (e.g. window resize, orientation change). Returns an unsubscribe function.

---

### ViewportSize

Dimensions in CSS pixels.

```typescript
export interface ViewportSize {
  width: number;
  height: number;
}
```

---

### ControllerPeer

Represents a controller endpoint attached to the console host.

```typescript
export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  isFirstPlayer?: boolean;
  pc: GameTransport | null;
  state: string;
  status?: PlayerConnectionStatus;
  lastTouch?: TouchMessage;
}
```

#### Properties

- `id`: `string` — Unique identifier for the peer.
- `name`: `string` — Display name assigned to the controller player.
- `color`: `string` — Hex color assigned to the controller player.
- `isFirstPlayer` *(optional)*: `boolean` — True if designated as the room host / first player.
- `pc`: `GameTransport | null` — Transport connection interface for communicating with this controller, or `null` if pending setup.
- `state`: `string` — Connection state string (matches `status`).
- `status` *(optional)*: `PlayerConnectionStatus` — Detailed network connection state.
- `lastTouch` *(optional)*: `TouchMessage` — The most recent touch message received from this peer.

---

### PlayerConnectionStatus

Union type representing the network status of a connected controller.

```typescript
export type PlayerConnectionStatus =
  | "live"          // Signaling active and direct P2P WebRTC data channel open
  | "live-relay"    // Signaling active and fallback Durable Object relay transport active
  | "reconnecting"  // Signaling active, WebRTC renegotiation in progress
  | "grace-period"  // Signaling disconnected, within server grace window
  | "gone";         // Disconnected past grace period, peer purged
```

---

### GameTransport

Abstract transport interface providing channel-based communication between console and controller endpoints.

```typescript
export interface GameTransport {
  readonly mode: TransportMode;
  readonly connectionState: RTCPeerConnectionState;
  sendInput(msg: unknown): void;
  sendControl(msg: ControlMessage): void;
  sendControlCoalesced(key: string, msg: unknown): void;
  addInputListener(listener: (msg: InputMessage) => void): () => void;
  addControlListener(listener: (msg: ControlMessage) => void): () => void;
  onModeChange(listener: (mode: TransportMode) => void): () => void;
  close(): void;
}
```

#### Properties & Methods

- `readonly mode`: `TransportMode` — Active underlying transport mechanism (`"p2p"`, `"relay"`, or `"local"`).
- `readonly connectionState`: `RTCPeerConnectionState` — Current WebRTC peer connection state.
- `sendInput(msg: unknown): void` — Transmits an unreliable/unordered input message over the input channel.
- `sendControl(msg: ControlMessage): void` — Transmits a reliable/ordered message over the control channel.
- `sendControlCoalesced(key: string, msg: unknown): void` — Queues state updates on the control channel with "latest value wins" semantics per key to prevent backlogs.
- `addInputListener(listener: (msg: InputMessage) => void): () => void` — Registers a handler for incoming input channel messages. Returns an unsubscribe function.
- `addControlListener(listener: (msg: ControlMessage) => void): () => void` — Registers a handler for incoming control channel messages. Returns an unsubscribe function.
- `onModeChange(listener: (mode: TransportMode) => void): () => void` — Registers a handler triggered when transport mode transitions (e.g. P2P to relay). Returns an unsubscribe function.
- `close(): void` — Closes the transport connection and cleans up associated resources.

---

### TransportMode

```typescript
export type TransportMode = "p2p" | "relay" | "local";
```

- `"p2p"`: Direct WebRTC peer-to-peer data channel.
- `"relay"`: Cloudflare Durable Object WebSocket relay connection.
- `"local"`: In-memory local transport (for local keyboard/gamepads on the console host).

---

### ConsoleApi

Cap'n Web RPC interface for signaling operations, accessible via `ctx.session` on the console context.

```typescript
export interface ConsoleApi extends RpcTarget {
  join(
    callbacks: ConsoleCallbacks,
    consoleToken?: string,
    gracePeriodMs?: number,
    phoneMax?: number
  ): Promise<{
    controllers: { id: string; name: string }[];
    firstPlayerId: string | null;
    consoleToken: string;
  }> | {
    controllers: { id: string; name: string }[];
    firstPlayerId: string | null;
    consoleToken: string;
  };
  kickController(id: string): void | Promise<void>;
  sendSignal(to: string, signal: RTCSignal): void;
  relayInput(to: string, payload: unknown): void;
  relayControl(to: string, payload: unknown): void;
}
```

#### Methods

- `join(callbacks, consoleToken?, gracePeriodMs?, phoneMax?)`: Registers the console with the Durable Object room session and receives initial room state.
- `kickController(id: string)`: Forces removal of the specified controller from the room session.
- `sendSignal(to: string, signal: RTCSignal)`: Relays WebRTC SDP or ICE candidate signals to the target controller.
- `relayInput(to: string, payload: unknown)`: Relays an input channel payload via DO fallback.
- `relayControl(to: string, payload: unknown)`: Relays a control channel payload via DO fallback.

---

## Message Schemas

### Input Message Types

Input messages are transmitted via `sendInput` and received via `addInputListener`.

```typescript
export type InputMessage =
  | TouchMessage
  | GamepadButtonsInputMessage
  | JoystickInputMessage
  | UnknownInputMessage;
```

#### TouchMessage

```typescript
export interface TouchMessage {
  type: "touch";
  phase: "start" | "move" | "end" | "cancel";
  pointerId: number;
  x: number; // Normalized coordinate 0.0 to 1.0
  y: number; // Normalized coordinate 0.0 to 1.0
  t: number; // Timestamp (performance.now())
}
```

#### GamepadButtonsInputMessage

```typescript
export interface GamepadButtonsInputMessage {
  type: "buttons";
  buttons: Record<string, number>; // Keys are button labels, values are numbers indicating pressed state (0.0 to 1.0)
  t: number;                      // Timestamp (performance.now())
}
```

#### JoystickInputMessage

```typescript
export interface JoystickInputMessage {
  type: "joystick";
  x: number;              // Normalized vector X axis (-1.0 to 1.0)
  y: number;              // Normalized vector Y axis (-1.0 to 1.0)
  t: number;              // Timestamp (performance.now())
}
```

#### UnknownInputMessage

```typescript
export type UnknownInputMessage = {
  type: string;
} & Record<string, unknown>;
```

---

### Control Message Types

Control messages are transmitted via `sendControl` / `sendControlCoalesced` and received via `addControlListener`.

```typescript
export type ControlMessage =
  | IdentityMessage
  | PingMessage
  | PongMessage
  | UnknownControlMessage;
```

#### IdentityMessage

```typescript
export interface IdentityMessage {
  type: "identity";
  name: string;  // Assigned player display name
  color: string; // Assigned hex color code
}
```

#### PingMessage

```typescript
export interface PingMessage {
  type: "ping";
  t: number; // Send timestamp (performance.now())
}
```

#### PongMessage

```typescript
export interface PongMessage {
  type: "pong";
  t: number; // Echoed timestamp (performance.now())
}
```

#### UnknownControlMessage

```typescript
export type UnknownControlMessage = {
  type: string;
} & Record<string, unknown>;
```

---

## Virtual Gamepad Component

The prebuilt generic virtual gamepad UI component (`src/components/VirtualGamepad.ts`) for mobile touch controllers that present as virtual gamepads.

### createVirtualGamepad

```typescript
export function createVirtualGamepad(options: VirtualGamepadOptions): VirtualGamepadInstance;
```

#### Parameters

- `options`: `VirtualGamepadOptions` — Configuration options for mounting the virtual gamepad UI.

#### Returns

- `VirtualGamepadInstance` — Instance object containing a cleanup `destroy()` method.

---

### VirtualGamepadOptions

```typescript
export interface VirtualGamepadOptions {
  container: HTMLElement;
  peerConnection: GameTransport | null;
  buttonLabels?: string[];
  title?: string;
  description?: string;
}
```

#### Properties

- `container`: `HTMLElement` — DOM element in which to mount the virtual gamepad.
- `peerConnection`: `GameTransport | null` — Transport connection used to send `buttons` and `joystick` input messages to the console host.
- `buttonLabels` *(optional)*: `string[]` — Labels for action buttons (defaults to `["FIRE", "BOOST"]`).
- `title` *(optional)*: `string` — Title header text (defaults to `"Virtual Gamepad"`).
- `description` *(optional)*: `string` — Subtitle/description text (defaults to `"Use joystick and buttons to play"`).

---

### VirtualGamepadInstance

```typescript
export interface VirtualGamepadInstance {
  destroy: () => void;
}
```

#### Methods

- `destroy()`: Cleans up event listeners, web haptics instance, and removes the gamepad element from `container`.
