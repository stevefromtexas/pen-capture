// Keeping the work safe.
// - Autosave: the project *and* its undo history go into IndexedDB after every change.
//   (IndexedDB rather than localStorage: a whole letter with its history can pass
//   localStorage's ~5 MB limit.) Safari may clear site data after weeks unused, hence:
// - Backup: the same state as a file through the share sheet (AirDrop, Save to Files).
// - Import: loads a Backup or an Export file.
// - Export: just the project, for the game's converter (goes to art/letter/raw/).

import { History } from "./history";
import { migrate, toJson, type Project } from "./project";

export interface Saved {
  project: Project;
  history: { done: History["done"]; undone: History["undone"] };
}

const DB = "letter-capture";
const STORE = "state";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Fallback when IndexedDB is unavailable (some private or locked-down browsers). */
const LOCAL_KEY = "letter-capture:state";

/** The last autosaved state, or null (nothing saved, or storage unavailable). */
export async function load(): Promise<Saved | null> {
  let text: unknown = null;
  try {
    const db = await openDb();
    text = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    console.info("IndexedDB unavailable, trying localStorage", err);
  }
  try {
    if (typeof text !== "string") text = localStorage.getItem(LOCAL_KEY);
    return typeof text === "string" ? parseState(text) : null;
  } catch (err) {
    console.warn("autosave load failed", err);
    return null;
  }
}

async function store(text: string): Promise<void> {
  try {
    await storeDb(text);
  } catch {
    // localStorage holds about 5 MB; a long letter with its history may not fit, in which
    // case this throws and the toolbar says NOT SAVED (Backup still works).
    localStorage.setItem(LOCAL_KEY, text);
  }
}

async function storeDb(text: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(text, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Saves right now (before leaving for the Preview page). Throws if nothing could be saved. */
export async function saveNow(state: Saved): Promise<void> {
  clearTimeout(timer);
  await store(stateJson(state));
}

/** Saves shortly after the last change (changes come in bursts while writing). */
export function saveSoon(state: () => Saved, status: (ok: boolean) => void): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    store(stateJson(state()))
      .then(() => status(true))
      .catch((err) => {
        console.warn("autosave failed", err);
        status(false);
      });
  }, 600);
}

export function stateJson(s: Saved): string {
  return JSON.stringify({ project: JSON.parse(toJson(s.project)), history: s.history });
}

/** Reads a Backup (project + history) or a plain project file (Export, or the spike's v1). */
export function parseState(text: string): Saved {
  const raw = JSON.parse(text) as { project?: unknown; history?: Saved["history"] };
  if (raw && typeof raw === "object" && "project" in raw) {
    const h = History.from(raw.history);
    return { project: migrate(raw.project), history: { done: h.done, undone: h.undone } };
  }
  return { project: migrate(raw), history: { done: [], undone: [] } };
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
export const backupName = () => `letter-backup-${stamp()}.json`;
export const exportName = () => `letter-${stamp()}.json`;

/**
 * Hands a file to the user: the share sheet where available (iPad Safari over HTTPS),
 * otherwise a normal download. Returns false if both failed.
 */
export async function saveFile(name: string, text: string): Promise<boolean> {
  const file = new File([text], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return true; // the user closed the sheet
    }
  }
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return true;
  } catch {
    return false;
  }
}

/** Opens a file picker and returns the chosen file's text, or null if cancelled. */
export function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
