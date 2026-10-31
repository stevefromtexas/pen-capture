# pen-capture

An iPad page for writing a letter with the Apple Pencil, keeping every stroke's order, timing
and pressure so it can be replayed later, stroke by stroke. It's a static Vite + TypeScript
site published with GitHub Pages.

**Never commit captured writing here.** This repo is public. Save your files somewhere
private. `.gitignore` already blocks `*.json` apart from the project's config files.

## Workflow

1. Draft the words on paper first.
2. **Write** the letter. Only the Pencil writes; a finger scrolls. The sheet grows by itself
   (or tap **Add lines**).
3. Fix anything, any time:
   - **Undo / Redo**: unlimited, and kept across reloads.
   - **Select**: tap strokes (tap again to unselect) or drag a box. Then:
     - **Delete**.
     - **Replace**: deletes the selection and puts a pink cursor in its place. What you
       write next takes exactly its place in the playback order.
     - **Insert after**: puts the cursor after the selection without deleting anything
       (for a missed i-dot or a forgotten word).
     - **Stop inserting** goes back to writing at the end.
   - **Markers**: drag from the left margin to put a paragraph line between lines of
     writing. Tap a marker to select it, then **Make page break** / **Make paragraph** or
     **Delete**; drag it to move it. A marker snaps to a clean gap. Strokes on the wrong side
     of a marker turn amber; move the marker or fix those strokes.
4. **Preview** plays the letter through the game's own playback (same smoothing, line
   weight and speed). It opens as its own page; **Back to editor** selects the stroke that
   was being drawn, so you can jump straight to something that looked off.
5. **Backup** often (the share sheet: AirDrop or Save to Files). Safari can clear site data
   after a few weeks unused. **Import** loads a Backup or an Export.
6. **Export** when done (repeatable; it deletes nothing). The file goes into the game repo's
   private `art/letter/raw/`.

Autosave runs after every change (IndexedDB, falling back to localStorage). If the toolbar
says **NOT SAVED**, use Backup.

**Pen stats** (collapsed under the toolbar) shows the spike's checks: pointer type,
pressure, samples per event and per second.

## Develop

```sh
npm ci
npm run dev       # http://localhost:5173
npm test          # logic tests (vitest)
npm run build     # type-check, tests, build to dist/
```

- `src/project.ts`: the saved format (v2, migrates v1)
- `src/history.ts`: undo/redo commands
- `src/sequence.ts`: insertion cursor, delete, replace
- `src/markers.ts`: marker anchoring, snapping, conflicts
- `src/hit.ts`: picking strokes
- `src/storage.ts`: autosave, Backup, Import, Export
- `src/sheet.ts`: drawing
- `src/capture.ts`: pen input
- `src/preview.ts`: going to and from the Preview
- `src/main.ts`: modes and toolbar

`window.letterCapture` exposes read-only state for automated checks and Safari's inspector.

**The Preview** (`public/preview/`) is built from the game repo by
`scripts/build-ink-preview.sh`. Its output is checked so nothing identifying ends up here.
Rebuild it after any change to the game's ink code or `content/ink.ron`, then commit the
three files.

## Deploy

Push to `main`. `.github/workflows/pages.yml` builds and publishes `dist/`.

## Saved format (v2)

```json
{
  "format": "letter-capture", "version": 2,
  "sheet": { "width": 360, "rule": 32, "gutter": 24, "topBlankLines": 1 },
  "height": 1280, "device": "<user agent>", "created": "<ISO time>", "nextId": 42,
  "strokes": [ { "id": 1, "points": [[x, y, pressure, t_ms], ...] } ],
  "markers": [ { "id": 7, "kind": "paragraph", "after": 6, "y": 85 } ]
}
```

- Coordinates are logical units on a 360-wide sheet; `t` is milliseconds since the page loaded.
- Ids are stable. A marker's meaning is `after` (its place in the stroke order:
  `null` = before the first stroke); `y` is only where its line is drawn.
- A Backup wraps this as `{ "project": …, "history": … }` to keep the undo history.
