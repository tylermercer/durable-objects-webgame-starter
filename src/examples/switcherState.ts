import { EXAMPLES, DEFAULT_EXAMPLE, type ExampleId } from "./registry";

export function getSelectedExampleId(): ExampleId {
  if (typeof window === "undefined") return DEFAULT_EXAMPLE;

  const urlParams = new URLSearchParams(window.location.search);
  const gameParam = urlParams.get("game");
  if (gameParam && gameParam in EXAMPLES) {
    return gameParam as ExampleId;
  }

  const selectEl = document.getElementById("demo-switcher-select") as HTMLSelectElement | null;
  if (selectEl && selectEl.value in EXAMPLES) {
    return selectEl.value as ExampleId;
  }

  const stored = localStorage.getItem("selected_example");
  if (stored && stored in EXAMPLES) {
    return stored as ExampleId;
  }

  return DEFAULT_EXAMPLE;
}

export function exampleIdFromJoinUrl(url: URL): ExampleId | undefined {
  const gameParam = url.searchParams.get("game");
  if (gameParam && gameParam in EXAMPLES) {
    return gameParam as ExampleId;
  }
  return undefined;
}
