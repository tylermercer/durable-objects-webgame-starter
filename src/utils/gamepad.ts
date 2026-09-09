export function getButtonLabel(
  msg: { buttonLabel?: string; buttonLabels?: string[] },
  index: number
): string | undefined {
  if (Array.isArray(msg.buttonLabels) && msg.buttonLabels[index] !== undefined) {
    return msg.buttonLabels[index];
  }
  return undefined;
}

export function isButtonLabelPressed(
  msg: {
    type?: string;
    button?: number;
    value?: number;
    pressed?: boolean;
    buttons?: number[];
    buttonLabel?: string;
    buttonLabels?: string[];
    firing?: boolean;
  },
  targetLabel: string
): boolean {
  // 1. Direct gamepad-button or message event with explicit matching buttonLabel
  if (msg.buttonLabel === targetLabel) {
    if (typeof msg.pressed === "boolean") {
      return msg.pressed;
    }
    if (typeof msg.value === "number") {
      return msg.value > 0.5;
    }
    if (msg.firing !== undefined && targetLabel === "FIRE") {
      return msg.firing;
    }
    if (Array.isArray(msg.buttons)) {
      return msg.buttons.some((b) => (b ?? 0) > 0.5);
    }
    return true;
  }

  // 2. Check buttonLabels array and buttons values by index
  if (Array.isArray(msg.buttonLabels) && Array.isArray(msg.buttons)) {
    const index = msg.buttonLabels.indexOf(targetLabel);
    if (index !== -1) {
      return (msg.buttons[index] ?? 0) > 0.5;
    }
  }

  // 3. Fallback for legacy messages without buttonLabels configuration
  if (!msg.buttonLabels || msg.buttonLabels.length === 0) {
    if (targetLabel === "FIRE") {
      if (typeof msg.firing === "boolean") return msg.firing;
      if (Array.isArray(msg.buttons)) return msg.buttons.slice(0, 8).some((b) => (b ?? 0) > 0.5);
    }
    if (targetLabel === "JUMP") {
      if (Array.isArray(msg.buttons)) return msg.buttons.slice(0, 8).some((b) => (b ?? 0) > 0.5);
    }
  }

  return false;
}
