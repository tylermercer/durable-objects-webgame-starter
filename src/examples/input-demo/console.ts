import type { ConsoleContext, ConsoleGameInstance } from "@contract/gameTypes";

export const controllerTypes = {
  phone: {},
  gamepad: {},
};

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0f111a;
    color: #e2e8f0;
    font-family: sans-serif;
    box-sizing: border-box;
  `;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    display: block;
  `;
  wrapper.appendChild(canvas);

  const uiOverlay = document.createElement("div");
  uiOverlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px;
    box-sizing: border-box;
    overflow-y: auto;
  `;
  wrapper.appendChild(uiOverlay);

  const header = document.createElement("h2");
  header.textContent = "Input Demo";
  header.style.cssText = "margin: 0 0 8px 0; text-shadow: 0 2px 4px rgba(0,0,0,0.8);";
  uiOverlay.appendChild(header);

  const status = document.createElement("p");
  status.textContent = "Touch phone screen to track dots, or connect a gamepad to test inputs.";
  status.style.cssText = "margin: 0 0 16px 0; text-align: center; text-shadow: 0 1px 3px rgba(0,0,0,0.8); opacity: 0.9;";
  uiOverlay.appendChild(status);

  const padsContainer = document.createElement("div");
  padsContainer.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: center;
    width: 100%;
  `;
  uiOverlay.appendChild(padsContainer);

  ctx.viewport.container.appendChild(wrapper);

  const ctx2d = canvas.getContext("2d");

  function resizeCanvas(size: { width: number; height: number }) {
    if (size.width > 0 && size.height > 0) {
      canvas.width = size.width * window.devicePixelRatio;
      canvas.height = size.height * window.devicePixelRatio;
    }
  }

  resizeCanvas(ctx.viewport.initialSize);
  const unsubscribeResize = ctx.viewport.onResize(resizeCanvas);

  const padStateMap = new Map<string, { buttons: number[]; axes: number[] }>();
  const cardElementsMap = new Map<string, {
    card: HTMLDivElement;
    axisEls: HTMLSpanElement[];
    btnEls: HTMLSpanElement[];
  }>();
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
    const existing = cardElementsMap.get(id);
    if (existing) {
      existing.card.remove();
      cardElementsMap.delete(id);
    }
  });

  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {
      // 1. Render touch dots on canvas
      if (ctx2d) {
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);

        for (const controller of ctx.peers.values()) {
          if (
            controller.lastTouch &&
            controller.lastTouch.phase !== "end" &&
            controller.lastTouch.phase !== "cancel"
          ) {
            const x = controller.lastTouch.x * canvas.width;
            const y = controller.lastTouch.y * canvas.height;

            ctx2d.beginPath();
            ctx2d.arc(x, y, 20 * window.devicePixelRatio, 0, Math.PI * 2);
            ctx2d.fillStyle = controller.color;
            ctx2d.globalAlpha = 0.7;
            ctx2d.fill();

            ctx2d.beginPath();
            ctx2d.arc(x, y, 35 * window.devicePixelRatio, 0, Math.PI * 2);
            ctx2d.strokeStyle = controller.color;
            ctx2d.globalAlpha = 0.4;
            ctx2d.lineWidth = 3 * window.devicePixelRatio;
            ctx2d.stroke();

            ctx2d.globalAlpha = 1.0;
            ctx2d.fillStyle = "#ffffff";
            ctx2d.font = `${14 * window.devicePixelRatio}px sans-serif`;
            ctx2d.textAlign = "center";
            ctx2d.fillText(controller.name, x, y - 25 * window.devicePixelRatio);
          }
        }
      }

      // 2. Render gamepad status cards for connected gamepad peers
      const gamepadPeers = Array.from(ctx.peers.values()).filter(
        (p) => p.id.startsWith("gamepad-") || p.pc?.mode === "local" || padStateMap.has(p.id)
      );

      if (gamepadPeers.length === 0) {
        status.textContent = "Touch phone screen to track dots, or connect a gamepad to test inputs.";
      } else {
        status.textContent = `${gamepadPeers.length} gamepad(s) connected. Touch phone screen to track dots.`;
      }

      // Clean up cards for peers no longer present
      const currentIds = new Set(gamepadPeers.map((p) => p.id));
      for (const [id, el] of cardElementsMap.entries()) {
        if (!currentIds.has(id)) {
          el.card.remove();
          cardElementsMap.delete(id);
        }
      }

      for (const peer of gamepadPeers) {
        const state = padStateMap.get(peer.id) ?? { buttons: [], axes: [] };
        let cardObj = cardElementsMap.get(peer.id);

        if (!cardObj) {
          const card = document.createElement("div");
          card.style.cssText = `
            background: rgba(30, 34, 48, 0.85);
            backdrop-filter: blur(4px);
            border: 2px solid ${peer.color};
            border-radius: 8px;
            padding: 16px;
            width: 280px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.4);
          `;

          const title = document.createElement("h3");
          title.textContent = peer.name;
          title.style.margin = "0 0 12px 0";
          card.appendChild(title);

          const axesHeader = document.createElement("div");
          axesHeader.textContent = `Axes (${state.axes.length}):`;
          axesHeader.style.fontWeight = "bold";
          axesHeader.style.fontSize = "12px";
          card.appendChild(axesHeader);

          const axesList = document.createElement("div");
          axesList.style.cssText = "display: flex; gap: 8px; font-family: monospace; font-size: 12px; margin-bottom: 12px;";
          card.appendChild(axesList);

          const buttonsHeader = document.createElement("div");
          buttonsHeader.textContent = `Buttons (${state.buttons.length}):`;
          buttonsHeader.style.fontWeight = "bold";
          buttonsHeader.style.fontSize = "12px";
          card.appendChild(buttonsHeader);

          const buttonsGrid = document.createElement("div");
          buttonsGrid.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px; font-family: monospace; font-size: 11px;";
          card.appendChild(buttonsGrid);

          padsContainer.appendChild(card);

          cardObj = { card, axisEls: [], btnEls: [] };
          cardElementsMap.set(peer.id, cardObj);
        }

        // Efficiently update axis elements
        const axesList = cardObj.card.children[2] as HTMLDivElement;
        while (cardObj.axisEls.length < state.axes.length) {
          const idx = cardObj.axisEls.length;
          const axisEl = document.createElement("span");
          axesList.appendChild(axisEl);
          cardObj.axisEls.push(axisEl);
        }
        state.axes.forEach((val, idx) => {
          if (cardObj.axisEls[idx]) {
            cardObj.axisEls[idx].textContent = `A${idx}: ${val.toFixed(2)}`;
          }
        });

        // Efficiently update button elements
        const buttonsGrid = cardObj.card.children[4] as HTMLDivElement;
        while (cardObj.btnEls.length < state.buttons.length) {
          const idx = cardObj.btnEls.length;
          const btnEl = document.createElement("span");
          buttonsGrid.appendChild(btnEl);
          cardObj.btnEls.push(btnEl);
        }
        state.buttons.forEach((val, idx) => {
          const btnEl = cardObj.btnEls[idx];
          if (btnEl) {
            btnEl.style.cssText = `
              padding: 2px 6px;
              border-radius: 4px;
              background: ${val > 0.1 ? peer.color : "#2d3348"};
              color: ${val > 0.1 ? "#000000" : "#ffffff"};
              font-weight: ${val > 0.1 ? "bold" : "normal"};
            `;
            btnEl.textContent = `B${idx}: ${val.toFixed(1)}`;
          }
        });
      }
    },
    destroy: () => {
      unsubscribeResize();
      unsubReady();
      unsubLeft();
      for (const unsub of unsubscribes) unsub();
      wrapper.remove();
    },
  };
}
