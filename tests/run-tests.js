#!/usr/bin/env node
/**
 * Matrice de tests — Parkings Sion
 * Exécute 24 scénarios couvrant toutes les règles tarifaires.
 *
 * Usage : npm test
 * Le script démarre server.js sur un port dédié (3999), exécute les tests
 * puis arrête le serveur. Exit code 0 si tous passent, 1 sinon.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const EPS  = 0.01; // tolérance en CHF

// ── Matrice de tests ───────────────────────────────────────────────────────
//
// Dates de référence (Europe/Zurich) :
//   2026-04-20 = lundi (jour ouvrable standard)
//   2026-04-24 = vendredi
//   2026-04-25 = samedi (toute la journée gratuite)
//   2026-04-26 = dimanche (tarif nuit/dim/fériés)
//   2026-05-01 = 1er mai (férié suisse)

const TESTS = [
  // ── A · Règles de base ────────────────────────────────────────────────
  { id: 'A1', cat: 'Base',    parking: 'planta',         ar: '2026-04-20T09:00', dp: '2026-04-20T10:00', veh: 'voiture', expected: 0.00,  desc: 'Planta · 1ère heure exacte' },
  { id: 'A2', cat: 'Base',    parking: 'planta',         ar: '2026-04-20T09:00', dp: '2026-04-20T10:01', veh: 'voiture', expected: 1.00,  desc: 'Planta · 1h01 → 1 tranche 20 min' },
  { id: 'A3', cat: 'Base',    parking: 'roches-brunes',  ar: '2026-04-20T09:00', dp: '2026-04-20T10:30', veh: 'voiture', expected: 1.00,  desc: 'Roches-B · 1h30 → 1 tranche 30 min' },
  { id: 'A4', cat: 'Base',    parking: 'roches-brunes',  ar: '2026-04-20T09:00', dp: '2026-04-20T10:31', veh: 'voiture', expected: 2.00,  desc: 'Roches-B · 1h31 → bascule 2ème tranche' },
  { id: 'A5', cat: 'Base',    parking: 'potences',       ar: '2026-04-20T09:00', dp: '2026-04-20T14:00', veh: 'voiture', expected: 0.00,  desc: 'Potences · gratuit 5h' },

  // ── B · Règle midi × 1ère heure (chronologique) ───────────────────────
  { id: 'B1', cat: 'Midi',    parking: 'planta',         ar: '2026-04-20T11:00', dp: '2026-04-20T13:30', veh: 'voiture', expected: 0.00,  desc: 'Planta · 11h→13h30 (1h grat + midi)' },
  { id: 'B2', cat: 'Midi',    parking: 'planta',         ar: '2026-04-20T12:00', dp: '2026-04-20T13:30', veh: 'voiture', expected: 0.00,  desc: 'Planta · juste le midi' },
  { id: 'B3', cat: 'Midi',    parking: 'planta',         ar: '2026-04-20T13:30', dp: '2026-04-20T14:30', veh: 'voiture', expected: 0.00,  desc: 'Planta · après midi, crédit 1h intact' },
  { id: 'B4', cat: 'Midi',    parking: 'planta',         ar: '2026-04-20T12:30', dp: '2026-04-20T14:00', veh: 'voiture', expected: 2.00,  desc: 'Planta · 12h30→14h : midi consomme crédit, 30 min payants' },
  { id: 'B5', cat: 'Midi',    parking: 'roches-brunes',  ar: '2026-04-20T12:30', dp: '2026-04-20T14:00', veh: 'voiture', expected: 1.00,  desc: 'Roches-B · 12h30→14h : 30 min payants (tranche 30)' },
  { id: 'B6', cat: 'Midi',    parking: 'cible',          ar: '2026-04-20T11:00', dp: '2026-04-20T14:00', veh: 'voiture', expected: 2.00,  desc: 'Cible · 11h→14h : midi consomme, 30 min payants' },

  // ── C · Week-end (plage hebdo ven 17h → sam 24h) ──────────────────────
  { id: 'C1', cat: 'Weekend', parking: 'planta',         ar: '2026-04-24T16:00', dp: '2026-04-24T18:00', veh: 'voiture', expected: 0.00,  desc: 'Planta · ven 16h-18h (1h grat + plage hebdo)' },
  { id: 'C2', cat: 'Weekend', parking: 'planta',         ar: '2026-04-25T10:00', dp: '2026-04-25T14:00', veh: 'voiture', expected: 0.00,  desc: 'Planta · samedi 10h-14h (tout gratuit)' },
  { id: 'C3', cat: 'Weekend', parking: 'planta',         ar: '2026-04-24T18:00', dp: '2026-04-24T22:00', veh: 'voiture', expected: 0.00,  desc: 'Planta · ven 18h-22h (plage hebdo)' },

  // ── D · Tarif nuit ─────────────────────────────────────────────────────
  { id: 'D1', cat: 'Nuit',    parking: 'planta',         ar: '2026-04-20T22:00', dp: '2026-04-21T06:00', veh: 'voiture', expected: 7.00,  desc: 'Planta · 22h→6h (8h, paliers Planta)' },
  { id: 'D2', cat: 'Nuit',    parking: 'roches-brunes',  ar: '2026-04-20T22:00', dp: '2026-04-21T06:00', veh: 'voiture', expected: 1.40,  desc: 'Roches-B · 22h→6h (8h × 0.20 CHF/h)' },

  // ── E · Dimanches & fériés ────────────────────────────────────────────
  { id: 'E1', cat: 'Férié',   parking: 'planta',         ar: '2026-04-26T10:00', dp: '2026-04-26T12:00', veh: 'voiture', expected: 1.00,  desc: 'Planta · dimanche 10h-12h (= tarif nuit)' },
  { id: 'E2', cat: 'Férié',   parking: 'planta',         ar: '2026-05-01T10:00', dp: '2026-05-01T12:00', veh: 'voiture', expected: 1.00,  desc: 'Planta · 1er mai (férié) 10h-12h' },

  // ── F · Plafonds Cour de Gare ─────────────────────────────────────────
  { id: 'F1', cat: 'Plafond', parking: 'gare',           ar: '2026-04-26T00:00', dp: '2026-04-27T00:00', veh: 'voiture', expected: 12.00, desc: 'Gare · dimanche 24h (plafond nuit 12 CHF)' },
  { id: 'F2', cat: 'Plafond', parking: 'gare',           ar: '2026-04-20T09:00', dp: '2026-04-20T19:00', veh: 'voiture', expected: 27.00, desc: 'Gare · 9h-19h (paliers jour, sous plafond)' },

  // ── G · Tarif moto ─────────────────────────────────────────────────────
  { id: 'G1', cat: 'Moto',    parking: 'planta',         ar: '2026-04-20T09:00', dp: '2026-04-20T10:00', veh: 'moto',    expected: 0.50,  desc: 'Planta moto · 1h × 0.50 CHF' },
  { id: 'G2', cat: 'Moto',    parking: 'planta',         ar: '2026-04-20T09:00', dp: '2026-04-20T11:00', veh: 'moto',    expected: 1.00,  desc: 'Planta moto · 2h × 0.50 CHF' },
  { id: 'G3', cat: 'Moto',    parking: 'scex',           ar: '2026-04-20T12:30', dp: '2026-04-20T14:00', veh: 'moto',    expected: 0.75,  desc: 'Scex moto · 1h30 (linéaire, midi ignoré)' },
  { id: 'G4', cat: 'Moto',    parking: 'cible',          ar: '2026-04-20T09:00', dp: '2026-04-20T11:00', veh: 'moto',    expected: 'ERR', desc: 'Cible moto · doit refuser (pas de tarif moto)' }
];

// ── Runner ────────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m'
};

async function runTest(t) {
  const body = JSON.stringify({ parkingId: t.parking, arrivee: t.ar, depart: t.dp, vehicule: t.veh });
  try {
    const res = await fetch(`${BASE}/api/calculer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const data = await res.json();

    if (t.expected === 'ERR') {
      const pass = !res.ok && data.erreur;
      return { pass, actual: res.ok ? 'OK (attendu: erreur)' : `erreur: ${data.erreur}` };
    }
    if (!res.ok) {
      return { pass: false, actual: `HTTP ${res.status} : ${data.erreur || 'inconnu'}` };
    }
    const actual = data.result?.total;
    const pass = Math.abs(actual - t.expected) < EPS;
    return { pass, actual };
  } catch (err) {
    return { pass: false, actual: `exception : ${err.message}` };
  }
}

function fmtCell(s, w, align = 'left') {
  s = String(s);
  if (s.length > w) s = s.slice(0, w - 1) + '…';
  return align === 'right' ? s.padStart(w) : s.padEnd(w);
}

function printMatrix(results) {
  const cols = [
    { h: 'ID',       w: 4 },
    { h: 'Cat.',     w: 8 },
    { h: 'Scénario', w: 60 },
    { h: 'Attendu',  w: 9, align: 'right' },
    { h: 'Obtenu',   w: 12, align: 'right' },
    { h: 'Statut',   w: 7, align: 'right' }
  ];
  const line = '─'.repeat(cols.reduce((s, c) => s + c.w + 3, 1));
  const hdr  = cols.map(c => fmtCell(c.h, c.w, c.align)).join(' │ ');

  console.log(`\n${C.bold}${C.cyan}╭${line}╮${C.reset}`);
  console.log(`${C.bold}│ ${hdr} │${C.reset}`);
  console.log(`${C.cyan}├${line}┤${C.reset}`);

  let prevCat = null;
  for (const r of results) {
    if (prevCat && prevCat !== r.cat) {
      console.log(`${C.gray}├${line}┤${C.reset}`);
    }
    prevCat = r.cat;
    const statut = r.pass ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`;
    const expected = r.expected === 'ERR' ? 'Erreur' : `${r.expected.toFixed(2)}`;
    const actual   = typeof r.actual === 'number' ? r.actual.toFixed(2) : String(r.actual);
    const actualColor = r.pass ? C.green : C.red;
    const row = [
      fmtCell(r.id, cols[0].w),
      fmtCell(r.cat, cols[1].w),
      fmtCell(r.desc, cols[2].w),
      fmtCell(expected, cols[3].w, 'right'),
      actualColor + fmtCell(actual, cols[4].w, 'right') + C.reset,
      fmtCell(statut, cols[5].w + 9, 'right') // +9 for color escape
    ];
    console.log(`│ ${row.join(' │ ')} │`);
  }
  console.log(`${C.cyan}╰${line}╯${C.reset}`);
}

function printSummary(results) {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed = total - passed;

  const byCategory = {};
  for (const r of results) {
    byCategory[r.cat] = byCategory[r.cat] || { pass: 0, fail: 0 };
    byCategory[r.cat][r.pass ? 'pass' : 'fail']++;
  }

  console.log(`\n${C.bold}Résumé par catégorie :${C.reset}`);
  for (const [cat, stats] of Object.entries(byCategory)) {
    const pct = Math.round((stats.pass / (stats.pass + stats.fail)) * 100);
    const color = stats.fail === 0 ? C.green : C.yellow;
    console.log(`  ${color}•${C.reset} ${cat.padEnd(8)} ${stats.pass}/${stats.pass + stats.fail} (${pct}%)`);
  }

  console.log();
  if (failed === 0) {
    console.log(`${C.bold}${C.green}✅ ${passed}/${total} tests réussis — tous les tarifs sont conformes${C.reset}\n`);
  } else {
    console.log(`${C.bold}${C.red}❌ ${failed}/${total} tests échoués${C.reset}`);
    console.log(`${C.dim}   Lance le serveur avec 'npm start', ouvre le simulateur, et vérifie les cas en échec.${C.reset}\n`);
  }

  return failed === 0;
}

async function waitForServer(retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE}/api/parkings`);
      if (res.ok) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  console.log(`${C.bold}${C.blue}▸ Parkings Sion — Matrice de tests${C.reset}`);
  console.log(`${C.dim}  Démarrage du serveur sur le port ${PORT}…${C.reset}`);

  const serverPath = path.resolve(__dirname, '..', 'server.js');
  const server = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  const ready = await waitForServer();
  if (!ready) {
    console.error(`${C.red}✗ Impossible de démarrer le serveur${C.reset}`);
    console.error(serverOutput);
    server.kill();
    process.exit(2);
  }

  console.log(`${C.green}  ✓ Serveur prêt — exécution de ${TESTS.length} tests${C.reset}`);

  const results = [];
  for (const t of TESTS) {
    const r = await runTest(t);
    results.push({ ...t, ...r });
  }

  printMatrix(results);
  const allPassed = printSummary(results);

  server.kill();
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(`${C.red}Erreur fatale :${C.reset}`, err);
  process.exit(2);
});
