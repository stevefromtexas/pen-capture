// Keeping the work safe.
// - Autosave: each letter's project *and* undo history go into IndexedDB after every change.
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

// Several letters can live side by side. IndexedDB keys (localStorage keys get a
// "letter-capture:" prefix when IndexedDB is unavailable):
//   letters       the list: [{ id, name, updated }]
//   active        id of the letter being edited
//   letter:<id>   that letter's project + undo history
//   current       the active letter again, written just before opening the Preview, which
//                 reads it (older versions kept their only letter here; it's migrated)

export interface LetterInfo {
  id: string;
  name: string;
  /** ISO time of the last save. */
  updated: string;
}

const DB = "letter-capture";
const STORE = "state";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** localStorage key for a fallback key. "current" keeps the name the Preview reads. */
const localKey = (key: string) => (key === "current" ? "letter-capture:state" : `letter-capture:${key}`);

async function get(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (typeof value === "string") return value;
  } catch {
    /* IndexedDB unavailable: fall through */
  }
  try {
    return localStorage.getItem(localKey(key));
  } catch {
    return null;
  }
}

async function put(key: string, value: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // localStorage holds about 5 MB; a long letter with its history may not fit, in which
    // case this throws and the toolbar says NOT SAVED (Backup still works).
    localStorage.setItem(localKey(key), value);
  }
}

async function remove(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* fall through */
  }
  try {
    localStorage.removeItem(localKey(key));
  } catch {
    /* nothing to remove */
  }
}

let letters: LetterInfo[] = [];

const saveIndex = () => put("letters", JSON.stringify(letters));
const newLetterId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The letter list, in the order they were made. */
export const listLetters = (): LetterInfo[] => letters.map((l) => ({ ...l }));

/**
 * Loads the letter list and the active letter. On first run after the multi-letter update,
 * the single autosaved letter becomes "Letter 1".
 */
export async function openLetters(): Promise<{ active: string; saved: Saved | null }> {
  try {
    letters = JSON.parse((await get("letters")) ?? "[]") as LetterInfo[];
  } catch {
    letters = [];
  }
  if (letters.length === 0) {
    const old = await get("current");
    const id = newLetterId();
    letters = [{ id, name: "Letter 1", updated: new Date().toISOString() }];
    if (old) await put(`letter:${id}`, old);
    await saveIndex();
    await put("active", id);
  }
  let active = (await get("active")) ?? letters[0].id;
  if (!letters.some((l) => l.id === active)) active = letters[0].id;
  return { active, saved: await loadLetter(active) };
}

/** A letter's saved state, or null if it's new or unreadable. */
export async function loadLetter(id: string): Promise<Saved | null> {
  const text = await get(`letter:${id}`);
  try {
    return text ? parseState(text) : null;
  } catch (err) {
    console.warn("couldn't read letter", id, err);
    return null;
  }
}

export async function setActive(id: string): Promise<void> {
  await put("active", id);
}

/** Adds an empty letter and makes it active. */
export async function createLetter(name: string): Promise<LetterInfo> {
  const info = { id: newLetterId(), name, updated: new Date().toISOString() };
  letters.push(info);
  await saveIndex();
  await setActive(info.id);
  return { ...info };
}

export async function renameLetter(id: string, name: string): Promise<void> {
  const l = letters.find((x) => x.id === id);
  if (l) l.name = name;
  await saveIndex();
}

/** Deletes a letter for good (the caller confirms first and picks what to show next). */
export async function deleteLetter(id: string): Promise<void> {
  letters = letters.filter((l) => l.id !== id);
  await saveIndex();
  await remove(`letter:${id}`);
}

async function saveLetter(id: string, state: Saved): Promise<void> {
  await put(`letter:${id}`, stateJson(state));
  const l = letters.find((x) => x.id === id);
  if (l) {
    l.updated = new Date().toISOString();
    await saveIndex();
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Saves right now, and hands the letter to the Preview. Throws if nothing could be saved. */
export async function saveNow(id: string, state: Saved): Promise<void> {
  clearTimeout(timer);
  await saveLetter(id, state);
  await put("current", stateJson(state));
}

/** Saves shortly after the last change (changes come in bursts while writing). */
export function saveSoon(id: string, state: () => Saved, status: (ok: boolean) => void): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    saveLetter(id, state())
      .then(() => status(true))
      .catch((err) => {
        console.warn("autosave failed", err);
        status(false);
      });
  }, 600);
}

/** Cancels a pending autosave (when switching letters, after saving the old one explicitly). */
export function cancelPending(): void {
  clearTimeout(timer);
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
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "letter";
export const backupName = (name: string) => `${slug(name)}-backup-${stamp()}.json`;
export const exportName = (name: string) => `${slug(name)}-${stamp()}.json`;

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
