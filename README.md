# pen-capture

A throwaway iPad page that records handwriting with the Apple Pencil (position, pressure and
timing for every point, in stroke order) so it can be replayed later, stroke by stroke.
It is static (Vite + TypeScript, no server) and is published with GitHub Pages.

**Never commit captured writing here.** This repo is public. Saved JSON files belong somewhere
private. `.gitignore` already blocks `*.json` apart from the project's config files.

## Status: spike

This version only answers whether the iPad can do it at all. A full editor (select/replace,
markers, preview, autosave) comes after the spike passes.

## Spike checklist (about 30 minutes, iPad Safari)

Open the Pages URL and write a line with the Pencil. The readout bar turns green or red:

| Check | Pass |
| --- | --- |
| `pointerType` | `pen` while writing with the Pencil (a finger shows `touch` and must not draw) |
| stroke min–max | Pressure range wider than 0.2 when you press lightly, then hard |
| samples / event | Above 1 (coalesced events work) |
| samples / s | 120 or more |

Also check by hand:

- A finger drag scrolls the sheet and draws nothing. The Pencil writes without scrolling.
- **Select** mode: tapping a stroke with the Pencil turns that stroke pink (the readout shows its number).
- **Save…** opens the share sheet (AirDrop / Save to Files). **Download** and **Copy JSON** are fallbacks.
- **Add lines** extends the sheet. **Undo** removes the last stroke.

## Develop

```sh
npm ci
npm run dev       # http://localhost:5173, also on the LAN if the firewall allows
npm run build     # type-check + build to dist/
```

The code is organized for the full editor:
`src/project.ts` (saved format), `src/sheet.ts` (ruling and drawing), `src/capture.ts` (pen input),
`src/main.ts` (toolbar and wiring).

## Deploy

Push to `main`. `.github/workflows/pages.yml` builds and publishes `dist/`.
One-time setup: repo Settings → Pages → Source → **GitHub Actions**.

## Saved format (v1)

```json
{
  "format": "letter-capture", "version": 1,
  "sheet": { "width": 360, "rule": 32, "gutter": 24, "topBlankLines": 1 },
  "height": 1280, "device": "<user agent>", "created": "<ISO time>",
  "strokes": [ { "points": [[x, y, pressure, t_ms], ...] } ]
}
```

Coordinates are logical units on a 360-wide sheet. `t` is milliseconds since the page loaded.
