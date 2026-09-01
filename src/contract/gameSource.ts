// To transition to STATE 2 (once building your own game), replace the contents of this file with src/contract/gameSource.state2.ts

import { EXAMPLES, DEFAULT_EXAMPLE } from "../examples/registry";
import { getSelectedExampleId, exampleIdFromJoinUrl } from "../examples/switcherState";
import { buildJoinUrl } from "../utils/buildJoinUrl";

export { buildJoinUrl };

export function loadConsoleGame() {
  const exampleId = getSelectedExampleId() ?? DEFAULT_EXAMPLE;
  return EXAMPLES[exampleId].console();
}

export function loadControllerGame(joinUrl: URL) {
  const exampleId = exampleIdFromJoinUrl(joinUrl) ?? DEFAULT_EXAMPLE;
  return EXAMPLES[exampleId].controller();
}

export function getGameMaxPlayers(): number | undefined {
  const exampleId = getSelectedExampleId() ?? DEFAULT_EXAMPLE;
  return EXAMPLES[exampleId]?.maxPlayers;
}
