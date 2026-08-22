# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Rooftop Runners" — a Subway-Surfers-style endless lane runner rendered entirely on an HTML5 `<canvas>`. Two playable characters, Miles and Prowler, are original stylised sprites drawn with canvas primitives (no external art assets or copied artwork). Pure client-side vanilla JS/CSS/HTML — no framework, no build step, no dependencies.

## Running it

There is no build/compile/bundle step. Serve the directory root and open `index.html`:

```
python3 -m http.server 8000   # or any static file server
```

Opening `index.html` directly via `file://` also works in most browsers. There is currently no linter or automated test suite; verify changes by playing the game in a browser (menu → pick a character → Play → exercise arrow keys/A-D-W-S or swipe/touch buttons → confirm collisions and the game-over screen behave correctly).

## Architecture

Three files, no modules/bundler — `js/game.js` is a single IIFE loaded via a plain `<script>` tag:

- **`index.html`** — static DOM shell only: the `<canvas>`, the HUD, the character-select/start overlay, the game-over overlay, and on-screen touch controls. All of it is toggled via `hidden` class swaps from `game.js`, not re-rendered.
- **`css/style.css`** — theming for the DOM overlays/HUD. The canvas contents themselves are drawn entirely in JS, not styled via CSS.
- **`js/game.js`** — all game logic, organized as:
  - **Tuning constants** at the top (lane count, world-unit track length, speed curve, gravity/jump/slide timings, pseudo-3D projection ratios). Change gameplay feel here rather than scattering magic numbers.
  - **`PALETTES`** — per-character color themes (`miles`, `prowler`) consumed by the shared renderer.
  - **`drawCharacter()`** — the one sprite-drawing routine used both for the menu's character-preview canvases and the in-game player. It takes a `pose` (run-cycle phase, normalized air height, sliding flag, dead flag) rather than character-specific draw code, so both characters share identical animation logic and only differ by palette/emblem.
  - **`Game`** class — owns the canvas/DOM references and the state machine (`menu` → `playing` → `gameover`). Key internal pieces:
    - A **pseudo-3D lane projection** (`laneX`/`screenY`/`scaleAt`, driven by a `depthT(z)` helper): obstacles/coins carry a `z` depth from `TRACK_LENGTH` (horizon) down to `0` (player); rendering position and scale are derived from that single depth value, converging toward a horizon line. This is the mechanism that gives the "road rushing toward camera" look — read this before touching spawning or rendering.
    - **`spawnWave()`** — picks one of several obstacle/coin layout patterns per spawn (single obstacle, two-lane wall with one gap, a coin arc, or an obstacle-plus-reward-lane) rather than spawning objects independently, so there's always a passable lane.
    - **Collision resolution** — each obstacle is resolved *exactly once*, at the frame its `z` crosses the near collision line (see the comment in `checkObstacleCollision`). This was a deliberate fix: re-checking hit/miss across a wide z-window let a player who had already cleared a barrier die from it moments later if they landed early. Keep this "resolve once" invariant if you touch collision code.
    - Update/render are split (`update(dt)` mutates state, `render()` only draws), called once per `requestAnimationFrame` tick from `loop()`.
  - **`Player`** class — lane index is lerped toward a `targetLane` for smooth strafing; jump uses real projectile physics (`velocityY`/`GRAVITY`) with `airT` normalized to `[0,1]` via `JUMP_MAX_HEIGHT` so it can double as both the visual jump-arc height and the "high enough to clear a barrier" collision threshold.
  - **`Obstacle`/`Coin`** — plain data holders (`lane`, `z`, type/collected flags) advanced by the world speed each frame.

High score is persisted to `localStorage` under `rooftop-runners-highscore`; there is no backend.
