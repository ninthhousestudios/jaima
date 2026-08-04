# ജയ്മാ.com

Devotional site dedicated to Amma. Digital temple, not a blog or personal site.

## Commands

- `npm run dev` — dev server (localhost:4321)
- `npm run build` — production build to `public/`
- `npm run preview` — preview production build

## Architecture

Single-page app, two states: **threshold** (entry animation) → **room** (main experience). No routing.

- `src/pages/index.astro` — sole page; HTML structure, all CSS (scoped + global), script entry point
- `src/layouts/Base.astro` — html shell, global reset
- `src/components/` — vanilla TS modules, each owning one concern:
  - `particles.ts` — Three.js canvas overlay (petals, light motes, incense smoke)
  - `lotus-nav.ts` — SVG bloom nav, mode state machine; exports `Mode` type
  - `photo-mode.ts` — photo cycling with crossfade
  - `japa-mode.ts` — Lalita Trishati streaming/manual, script toggle
  - `garland-mode.ts` — SVG garland overlay (v1)
  - `teachings-mode.ts` — Amma quotes
  - `sound-mode.ts` — scaffold, no audio assets yet
  - `tab-mantra.ts` — random Lalita name in browser tab title on blur

## Key conventions

- All mode overlays use class `mode-overlay` and id `mode-{name}`. The lotus nav toggles `.active` on them.
- Photos live in `static/images/photos/`. Mantra data in `static/data/` (one name per line, 300 lines each).
- `static/` is Astro's publicDir (copied verbatim to build output). `public/` is outDir (build artifact, gitignored).
- CSS lives in `index.astro` — scoped styles for page structure, `is:global` block for component styles (lotus, modes).
- No framework (React/Vue/etc). Components are plain TS that create and manage their own DOM.

## Deploy

GitLab Pages via CI. Push to `master` → builds and deploys to `ജയ്മാ.com`.
Remote: `pages-gitlab` (gitlab.com:j0sh4rp3/pages.git).

## Design doc

`docs/design.md` — full design spec including v2 plans (garland physics, arati flame, sahasranama).
