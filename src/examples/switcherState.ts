import { EXAMPLES, DEFAULT_EXAMPLE, type ExampleId } from "./registry";

export function getSelectedExampleId(): ExampleId {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return DEFAULT_EXAMPLE;

  const id = document.querySelector("[data-game]")?.getAttribute("data-game");
  return id && id in EXAMPLES ? (id as ExampleId) : DEFAULT_EXAMPLE;
}

export function exampleIdFromJoinUrl(url: URL): ExampleId | undefined {
  const [, prefix, id] = url.pathname.split("/");
  return prefix === "play" && id in EXAMPLES ? (id as ExampleId) : undefined;
}
