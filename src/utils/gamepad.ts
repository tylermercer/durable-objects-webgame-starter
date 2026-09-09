export function isButtonLabelPressed(
  msg: {
    type?: string;
    buttons?: Record<string, number> | unknown;
    [key: string]: unknown;
  },
  targetLabel: string
): boolean {
  if (msg && typeof msg.buttons === "object" && msg.buttons !== null && !Array.isArray(msg.buttons)) {
    const val = (msg.buttons as Record<string, number>)[targetLabel];
    return typeof val === "number" ? val > 0.5 : false;
  }
  return false;
}
