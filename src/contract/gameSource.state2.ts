import type { ConsoleGameModule, ControllerGameModule } from "./gameTypes";
import { buildJoinUrl } from "../utils/buildJoinUrl";

export { buildJoinUrl };

export function loadConsoleGame(): Promise<ConsoleGameModule> {
  return import("@logic/console");
}

export function loadControllerGame(_joinUrl?: URL): Promise<ControllerGameModule> {
  return import("@logic/controller");
}

export function getGameControllerTypes() {
  return undefined;
}
