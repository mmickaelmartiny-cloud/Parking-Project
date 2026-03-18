# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start       # Start server on port 3000 (node server.js)
```

No build step, transpilation, tests, or linter are configured.

## Architecture

**Parkings Sion** is a parking price simulator and directory for Sion, Switzerland. It is a minimal Node.js/Express app with vanilla JS frontend and PWA support.

### Data flow

1. `data/parkings.json` — static data for 7 parking locations, loaded at server startup
2. `server.js` — Express server with two API endpoints:
   - `GET /api/parkings` — returns all parking data
   - `POST /api/calculer` — calculates cost for a given parking and time range
3. `public/` — static frontend (HTML/CSS/JS), served directly by Express

### Pricing calculation engine (`server.js`)

The `calculer()` function processes each **minute** of the parking duration individually, determining whether that minute is free, discounted (night rate), or full price. It then groups consecutive minutes sharing the same rate into billing blocks.

Rule types stored in each parking's `regles` array:
- `premiere_h_gratuite` / `demi_h_gratuite` — first hour/30 min free
- `h1_plage` — first hour free only within a time window
- `gratuit_dim`, `gratuit_dim_feries`, `gratuit_sam_apres` — free on certain days
- `tarif_nuit`, `tarif_nuit_dim_feries` — percentage night rate reduction
- `gratuit_plage_quotidien`, `gratuit_plage_hebdo` — free during daily or weekly time windows

Swiss public holidays are hardcoded in the `FERIES` array in `server.js`.

### Frontend (`public/app.js`)

Vanilla JS (no framework). Two simulation modes:
- **Single** — calculates cost for one selected parking
- **All** — compares all 7 parkings for the same period, with rankings and savings display

Theme (dark/light) is persisted in `localStorage`. The Service Worker (`public/sw.js`) uses cache-first for static assets and network-first for API calls.

### Adding or modifying a parking

Edit `data/parkings.json`. Each parking has: `id`, `nom`, `adresse`, `capacite`, `hauteur`, `prixH` (hourly rate in CHF), `ouvH`/`fermH` (opening hours), `regles` (array of pricing rule objects), and optional `notes`.
