import { buildJoinUrl } from "../utils/buildJoinUrl";

export { buildJoinUrl };

export function loadConsoleGame() {
  return import("@logic/console");
}

export function loadControllerGame() {
  return import("@logic/controller");
}

export function getGameControllerTypes() {
  return undefined;
}
