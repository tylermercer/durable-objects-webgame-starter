import type { ConsoleContext, ConsoleGameInstance } from "@contract/gameTypes";
import type { GamepadStateMessage } from "@transport/transport";

export const controllerTypes = {
  gamepad: {},
};

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  const container = document.createElement("div");
  container.className = "gamepad-demo-console";
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    background: #0f111a;
    color: #e2e8f0;
    font-family: sans-serif;
    padding: 24px;
    box-sizing: border-box;
  `;

  const header = document.createElement("h2");
  header.textContent = "Gamepad Demo";
  header.style.marginBottom = "16px";
  container.appendChild(header);

  const status = document.createElement("p");
  status.textContent = "Plug in or connect a gamepad to test input.";
  status.style.marginBottom = "24px";
  container.appendChild(status);

  const padsContainer = document.createElement("div");
  padsContainer.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: center;
    width: 100%;
  `;
  container.appendChild(padsContainer);

  ctx.viewport.container.appendChild(container);

  const padStateMap = new Map<string, { buttons: number[]; axes: number[] }>();
  const unsubscribes = new Set<() => void>();

  function setupPeer(peer: any) {
    if (peer.pc) {
      const unsub = peer.pc.addInputListener((msg: any) => {
        if (msg.type === "gamepad-state") {
          padStateMap.set(peer.id, { buttons: msg.buttons, axes: msg.axes });
        }
      });
      unsubscribes.add(unsub);
    }
  }

  for (const peer of ctx.peers.values()) {
    setupPeer(peer);
  }

  const unsubReady = ctx.onPeerReady((peer) => {
    setupPeer(peer);
  });

  const unsubLeft = ctx.onPeerLeft((id) => {
    padStateMap.delete(id);
  });

  return {
    render: () => {
      padsContainer.innerHTML = "";
      if (ctx.peers.size === 0) {
        status.textContent = "No gamepads detected. Connect a gamepad and press any button.";
      } else {
        status.textContent = `${ctx.peers.size} gamepad(s) connected.`;
      }

      for (const peer of ctx.peers.values()) {
        const card = document.createElement("div");
        card.style.cssText = `
          background: #1e2230;
          border: 2px solid ${peer.color};
          border-radius: 8px;
          padding: 16px;
          width: 280px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        `;

        const title = document.createElement("h3");
        title.textContent = peer.name;
        title.style.margin = "0 0 12px 0";
        card.appendChild(title);

        const state = padStateMap.get(peer.id) ?? { buttons: [], axes: [] };

        const axesHeader = document.createElement("div");
        axesHeader.textContent = `Axes (${state.axes.length}):`;
        axesHeader.style.fontWeight = "bold";
        axesHeader.style.fontSize = "12px";
        card.appendChild(axesHeader);

        const axesList = document.createElement("div");
        axesList.style.cssText = "display: flex; gap: 8px; font-family: monospace; font-size: 12px; margin-bottom: 12px;";
        state.axes.forEach((val, idx) => {
          const axisEl = document.createElement("span");
          axisEl.textContent = `A${idx}: ${val.toFixed(2)}`;
          axesList.appendChild(axisEl);
        });
        card.appendChild(axesList);

        const buttonsHeader = document.createElement("div");
        buttonsHeader.textContent = `Buttons (${state.buttons.length}):`;
        buttonsHeader.style.fontWeight = "bold";
        buttonsHeader.style.fontSize = "12px";
        card.appendChild(buttonsHeader);

        const buttonsGrid = document.createElement("div");
        buttonsGrid.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px; font-family: monospace; font-size: 11px;";
        state.buttons.forEach((val, idx) => {
          const btnEl = document.createElement("span");
          btnEl.style.cssText = `
            padding: 2px 6px;
            border-radius: 4px;
            background: ${val > 0.1 ? peer.color : "#2d3348"};
            color: ${val > 0.1 ? "#000000" : "#ffffff"};
            font-weight: ${val > 0.1 ? "bold" : "normal"};
          `;
          btnEl.textContent = `B${idx}: ${val.toFixed(1)}`;
          buttonsGrid.appendChild(btnEl);
        });
        card.appendChild(buttonsGrid);

        padsContainer.appendChild(card);
      }
    },
    destroy: () => {
      unsubReady();
      unsubLeft();
      for (const unsub of unsubscribes) unsub();
      container.remove();
    },
  };
}
