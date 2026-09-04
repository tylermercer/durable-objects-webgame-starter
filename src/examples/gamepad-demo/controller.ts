import type { ControllerGameInstance } from "@contract/gameTypes";

export function createGame(): ControllerGameInstance {
  const container = document.getElementById("touch-surface");
  if (container) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: #0f111a; color: #ffffff; font-family: sans-serif; text-align: center; padding: 20px;">
        <h2>Gamepad Demo</h2>
        <p>This demo uses local physical gamepads connected directly to the console machine.</p>
      </div>
    `;
  }
  return {
    destroy: () => {
      if (container) container.innerHTML = "";
    },
  };
}
