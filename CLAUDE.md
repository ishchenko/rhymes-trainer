# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

No build step. The entire app is a single `index.html` file — open it directly in a browser or serve it over HTTP (required for microphone access in Safari/iOS):

```bash
npx serve .
```

Then open `http://localhost:3000`. For iPad testing, use the local network IP shown by `serve`.

## Architecture

Single-file React app (`index.html`) using React 18 via CDN + Babel standalone (no bundler). All logic is in one `<script type="text/babel">` block.

**Screen flow:** `input` → `record` → `segment` → `practice`

**App state** lives in the root `App` component and is persisted to `localStorage` (`pt-session`, `pt-poems`). Audio blobs are stored in IndexedDB via the `DB` helper (key = `poem.id`).

**Key architectural decisions:**

- `audioBuffer` (decoded `AudioBuffer`) is loaded lazily in `App` via `useEffect` when the screen changes to `segment` or `practice`. It's decoded from the IndexedDB blob.
- Segment dividers are stored as proportional positions (0–1), converted to absolute times only in `saveAndNext`. Both are persisted in session state.
- `trimStart`/`trimEnd` (also 0–1) clip the recording's active region — passed into `playSegment`/`playSequence` as outer bounds.

**SegmentScreen** uses CSS Grid (`1fr min(600px,100%) 1fr`) to make the waveform canvas full-width while keeping header and line list constrained to 600px. Canvas draws only waveform/fills/shading; draggable handles are DOM elements with `position:absolute` over the canvas. Drag events are attached to `document` (not canvas) to avoid losing the pointer on fast moves. A `stateRef` pattern keeps drag handlers free of stale closures.

**PracticeScreen** schedules all segments upfront with Web Audio API (`when` offsets). All source nodes are stored in `srcsRef[]` so `stopAll()` can cancel every scheduled segment immediately. `repeatAllRef`/`repeatSelRef` are kept in sync with state via `useEffect` so `onended` callbacks read current values. `stoppingRef` prevents the repeat loop from restarting when `stopAll()` triggers `onended`.

**Palette** is defined in the `C` constant at the top of the script. `segColors` is a separate array of `rgba(...)` prefixes (without closing paren) used by appending opacity strings like `color + '0.18)'`.
