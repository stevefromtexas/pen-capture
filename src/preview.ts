// The Preview: the game's own ink playback, a Rust app built by the game repo's
// scripts/build-ink-preview.sh into public/preview/. It's a separate full page (not an
// iframe, where macroquad's page-wide input and WebGL handling are less predictable).
// It reads the project from the editor's autosave, so nothing is passed between pages
// except, on the way back, the id of the stroke it was drawing (?stroke=ID).

import * as storage from "./storage";

/** Saves the current state, then goes to the preview page. */
export async function openPreview(letterId: string, state: storage.Saved): Promise<void> {
  try {
    await storage.saveNow(letterId, state);
  } catch {
    alert("Couldn't save before previewing (storage unavailable). Use Backup to keep your work.");
    return;
  }
  location.href = "./preview/index.html";
}

/** The stroke the preview handed back, if the editor was opened from it. Clears the URL. */
export function strokeFromPreview(): number | null {
  const params = new URLSearchParams(location.search);
  const id = Number(params.get("stroke"));
  if (params.has("stroke")) history.replaceState(null, "", location.pathname);
  return Number.isInteger(id) && id > 0 ? id : null;
}
