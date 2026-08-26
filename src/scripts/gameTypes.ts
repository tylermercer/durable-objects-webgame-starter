export interface ConsoleGameInstance {
  tick?: (dt: number) => void;
  render?: (alpha: number) => void;
  destroy?: () => void;
}

export interface ControllerGameInstance {
  destroy?: () => void;
}
