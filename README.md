# Hark Arcade — concept site

*Press start.* A scroll-driven WebGL concept for Hark Digital Design as a
16-bit arcade game on a CRT: everything renders through a pixelating,
palette-snapping, dithering CRT pass; chapters are levels joined by iris
wipes; copy lives in game windows and dialogue boxes.

**Live:** https://harkdigital.github.io/hark-arcade/

Sister concepts for comparison:
[Orbit (space)](https://harkdigital.github.io/hark-igloo/) ·
[Resonance (acoustic lab)](https://harkdigital.github.io/hark-resonance/) ·
[Press (print shop)](https://harkdigital.github.io/hark-press/) ·
[Town (floating islands)](https://harkdigital.github.io/hark-town/) ·
[the 2026 site build](https://harkdigital.github.io/hark-digital-2026/).
Copy, services, portfolio and testimonials come from the 2026 site
(`Clients/Hark Digital 2026 Website/site-v2/src/data`) via `src/content.ts`.

## The levels

| # | Level | What happens |
|---|-------|--------------|
| 01 | **Title Screen** (`hero`) | Attract mode: the Hark mark as the game logo over a neon grid horizon — *Make the internet listen.* — PRESS START |
| 02 | **Arcade Hall** (`work`) | *Built to be heard.* Each project runs on an arcade cabinet's screen; the nine more on the 9-in-1 house machine's menu |
| 03 | **Power-Ups** (`services`) | *Eleven ways to be heard.* ?-blocks pop out one power-up item per service |
| 04 | **Side Quests** (`voices`) | *We listen. They talk.* Villagers share the testimonials in RPG dialogue boxes |
| 05 | **Boss Fight** (`shield`) | A malware boss attacks, the Hark shield holds → *Hacked? Breathe.* → RESTORED, 24/7 |
| 06 | **World Map** (`process`) | *We listen first. Then we build.* Four levels to clear: Listen · Prototype · Build · Support, then a results screen |
| 07 | **Continue?** (`contact`) | The countdown turns into *Say hello.*; credits roll — thanks for playing |

## How the CRT look works

`src/core/post.ts` (final pass): the frame is resampled on a coarse grid
(`post.params.pixel` CSS px per game pixel), snapped to the **Hark-16** palette
with a 4×4 Bayer ordered dither, then gets scanlines, an aperture mask,
barrel curvature and phosphor bloom. Chapter cuts are a pixel-stepped iris.
`src/kit/pixel.ts` has the palette, toon materials, and ASCII-art voxel,
sprite and pixel-text builders every level shares.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build → dist/
```

URL params: `?nointro`, `?c=work&l=0.5`, `?p=0.4`, `?only=hero`, `?debug`.

```bash
npx vite --config vite.shots.config.ts --port 5590 --strictPort   # no-HMR server
node scripts/shot.mjs --port=5590 --frames=hero:0.3,work:0.2 --out=shots [--mobile]
```

Same engine as the other concepts (Vite + TypeScript + Three.js r186 +
Lenis), with accessible linear copy for screen readers and keyboards
(`src/core/srContent.ts`).

## Deploy

Pushes to `main` deploy to GitHub Pages (`--base=/hark-arcade/`, `noindex`).
