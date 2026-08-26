// To transition to STATE 2 (once building your own game), replace the contents of this file with:
/*
export function loadConsoleGame() {
  return import("@logic/console");
}

export function loadControllerGame() {
  return import("@logic/controller");
}

export function buildJoinUrl(origin: string, code: string): string {
  return `${origin}/?code=${code}`;
}
*/

import { EXAMPLES, DEFAULT_EXAMPLE } from "../examples/registry";
import { getSelectedExampleId, exampleIdFromJoinUrl } from "../examples/switcherState";

export function loadConsoleGame() {
  const exampleId = getSelectedExampleId() ?? DEFAULT_EXAMPLE;
  return EXAMPLES[exampleId].console();
}

export function loadControllerGame(joinUrl: URL) {
  const exampleId = exampleIdFromJoinUrl(joinUrl) ?? DEFAULT_EXAMPLE;
  return EXAMPLES[exampleId].controller();
}

export function buildJoinUrl(origin: string, code: string): string {
  const exampleId = getSelectedExampleId() ?? DEFAULT_EXAMPLE;
  return `${origin}/?code=${code}&game=${encodeURIComponent(exampleId)}`;
}
