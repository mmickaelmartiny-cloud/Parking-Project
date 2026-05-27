#!/usr/bin/env node
/**
 * Tests du simulateur sur les parkings Genève.
 * Exécute directement le moteur (lib/engine.js) sans passer par le serveur HTTP.
 *
 * Usage : node scripts/test-geneve.js
 */

const path = require('path');
const fs   = require('fs');
const { calculerProgressif } = require('../lib/engine');

const PARKINGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'villes', 'geneve.json'), 'utf8')
);

const byId = (id) => {
  const p = PARKINGS.find(p => p.id === id);
  if (!p) throw new Error(`Parking introuvable: ${id}`);
  return p;
};

// Dates de référence (heure locale Europe/Zurich) — vérifiées via estFerie() :
//   2026-05-18 = lundi ordinaire (NON férié)
//   2026-05-22 = vendredi ordinaire
//   2026-05-23 = samedi
//   2026-05-24 = dimanche
//   2026-05-14 = jeudi Ascension (férié VS)
//   2026-05-25 = lundi de Pentecôte (férié VS)
//   2026-06-01 = lundi ordinaire (référence non-fériée)

const TESTS = [
  // ── Code 221 : P+R Bachet-Praille (lun-sam, 7h-19h, 1.5 CHF/h, fériés Gratuit) ──
  {
    id: '221-jour',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-18T10:00', dp: '2026-05-18T12:00',
    expected: 3.00,
    desc: '221 · Lundi 10h-12h (2h × 1.5) → 3 CHF'
  },
  {
    id: '221-nuit',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-18T20:00', dp: '2026-05-18T22:00',
    expected: 0.00,
    desc: '221 · Lundi 20h-22h (hors plage payante 7h-19h) → 0 CHF'
  },
  {
    id: '221-sam',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-23T10:00', dp: '2026-05-23T12:00',
    expected: 3.00,
    desc: '221 · Samedi 10h-12h (samedi payant car lun-sam) → 3 CHF'
  },
  {
    id: '221-dim',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-24T10:00', dp: '2026-05-24T12:00',
    expected: 0.00,
    desc: '221 · Dimanche 10h-12h (gratuit via nuit.dimFeries) → 0 CHF'
  },
  {
    id: '221-ferie',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-14T10:00', dp: '2026-05-14T12:00',
    expected: 0.00,
    desc: '221 · Ascension (férié VS) 10h-12h → 0 CHF'
  },
  {
    id: '221-30min',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-18T10:00', dp: '2026-05-18T10:30',
    expected: 1.00,
    desc: '221 · 30 min de jour (théorique 0.75) → 1.00 CHF (montant min)'
  },
  {
    id: '221-5min',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-18T10:00', dp: '2026-05-18T10:05',
    expected: 1.00,
    desc: '221 · 5 min de jour (théorique 0.13) → 1.00 CHF (montant min)'
  },
  {
    id: '221-min-dim-court',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-24T10:00', dp: '2026-05-24T10:05',
    expected: 0.00,
    desc: '221 · 5 min dimanche (entièrement gratuit) → 0 CHF (min PAS appliqué)'
  },
  {
    id: '221-1heure',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-18T10:00', dp: '2026-05-18T11:00',
    expected: 1.50,
    desc: '221 · 1h de jour (1.5) → 1.50 CHF (au-dessus du min)'
  },
  {
    id: '221-cheval',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-05-18T18:00', dp: '2026-05-18T20:00',
    expected: 1.50,
    desc: '221 · Lundi 18h-20h (1h jour facturée + 1h hors plage gratuite)'
  },

  // ── Code 227 : P+R Tuileries (lun-ven, 7h-17h, 1 CHF/h, fériés Gratuit) ──
  {
    id: '227-jour',
    parking: 'p-r-tuileries-11',
    ar: '2026-05-18T10:00', dp: '2026-05-18T12:00',
    expected: 2.00,
    desc: '227 · Lundi 10h-12h (2h × 1.0) → 2 CHF'
  },
  {
    id: '227-sam',
    parking: 'p-r-tuileries-11',
    ar: '2026-05-23T10:00', dp: '2026-05-23T12:00',
    expected: 0.00,
    desc: '227 · Samedi 10h-12h (samedi gratuit car lun-ven) → 0 CHF'
  },
  {
    id: '227-dim',
    parking: 'p-r-tuileries-11',
    ar: '2026-05-24T10:00', dp: '2026-05-24T12:00',
    expected: 0.00,
    desc: '227 · Dimanche 10h-12h → 0 CHF'
  },
  {
    id: '227-soir',
    parking: 'p-r-tuileries-11',
    ar: '2026-05-18T18:00', dp: '2026-05-18T20:00',
    expected: 0.00,
    desc: '227 · Lundi 18h-20h (hors plage 7h-17h) → 0 CHF'
  },

  // ── Code 298 : Centre sportif Cointrin (lun-dim, 0h-24h, 1.5 CHF/h, fériés Payant) ──
  {
    id: '298-jour',
    parking: 'centre-sportif-cointrin-78',
    ar: '2026-05-18T10:00', dp: '2026-05-18T12:00',
    expected: 3.00,
    desc: '298 · Lundi 10h-12h (2h × 1.5) → 3 CHF (payant 24h/24)'
  },
  {
    id: '298-dim',
    parking: 'centre-sportif-cointrin-78',
    ar: '2026-05-24T10:00', dp: '2026-05-24T12:00',
    expected: 3.00,
    desc: '298 · Dimanche 10h-12h → 3 CHF (lun-dim, dimanche PAYANT)'
  },
  {
    id: '298-nuit',
    parking: 'centre-sportif-cointrin-78',
    ar: '2026-05-18T22:00', dp: '2026-05-19T02:00',
    expected: 6.00,
    desc: '298 · Lundi 22h → mardi 2h (4h × 1.5) → 6 CHF (24h/24)'
  },
  {
    id: '298-ferie',
    parking: 'centre-sportif-cointrin-78',
    ar: '2026-05-14T10:00', dp: '2026-05-14T12:00',
    expected: 3.00,
    desc: '298 · Ascension (férié VS) 10h-12h → 3 CHF (fériés Payant)'
  },

  // ── Fériés cantonaux : différenciation GE vs VS ──
  // 221 = Bachet-Praille (lun-sam, fériés Gratuit) avec feriesCanton: 'GE'
  {
    id: '221-stjoseph',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-03-19T10:00', dp: '2026-03-19T12:00',
    expected: 3.00,
    desc: '221 · 19 mars St-Joseph (férié VS uniquement) → 3 CHF (NON férié à GE)'
  },
  {
    id: '221-assomption',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-08-15T10:00', dp: '2026-08-15T12:00',
    expected: 3.00,
    desc: '221 · 15 août Assomption (samedi, NON férié à GE, samedi payant) → 3 CHF'
  },
  {
    id: '221-jeune',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-09-10T10:00', dp: '2026-09-10T12:00',
    expected: 0.00,
    desc: '221 · Jeûne genevois (jeudi 10 sept) → 0 CHF (férié GE)'
  },
  {
    id: '221-restauration',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-12-31T10:00', dp: '2026-12-31T12:00',
    expected: 0.00,
    desc: '221 · Restauration (jeudi 31 déc) → 0 CHF (férié GE)'
  },
  {
    id: '221-vendredisaint',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-04-03T10:00', dp: '2026-04-03T12:00',
    expected: 0.00,
    desc: '221 · Vendredi Saint (3 avril) → 0 CHF (férié GE)'
  },
  {
    id: '221-1aout',
    parking: 'p-r-bachet-praille-voitures-2',
    ar: '2026-08-01T10:00', dp: '2026-08-01T12:00',
    expected: 0.00,
    desc: '221 · 1er août (samedi, férié national) → 0 CHF'
  },
];


// ── Runner ────────────────────────────────────────────────────────────────

const EPS = 0.01;
let pass = 0, fail = 0;
const failures = [];

console.log('\n── Tests simulateur Genève ──\n');

for (const t of TESTS) {
  const p = byId(t.parking);
  const ar = new Date(t.ar);
  const dp = new Date(t.dp);
  const r = calculerProgressif(p, ar, dp);
  const got = r ? r.total : null;
  const ok = got != null && Math.abs(got - t.expected) < EPS;

  const status = ok ? '✓' : '✗';
  const got_s = got != null ? got.toFixed(2).padStart(7) : '  null';
  console.log(`  ${status} ${t.id.padEnd(10)} attendu ${t.expected.toFixed(2).padStart(6)} | obtenu ${got_s}  ${t.desc}`);

  if (ok) pass++;
  else {
    fail++;
    failures.push({ ...t, got, segments: r ? r.segments : null });
  }
}

console.log(`\n── Résumé : ${pass}/${TESTS.length} OK, ${fail} échecs ──\n`);

if (failures.length > 0) {
  console.log('── Détail des échecs ──\n');
  for (const f of failures) {
    console.log(`✗ ${f.id} : ${f.desc}`);
    console.log(`  Attendu ${f.expected}, obtenu ${f.got}`);
    if (f.segments) {
      f.segments.forEach(s => {
        const from = new Date(s.from).toISOString().slice(11, 16);
        const to   = new Date(s.to).toISOString().slice(11, 16);
        console.log(`    ${from}→${to}  ${s.minutes}min  ${s.tauxH} CHF/h  → ${s.cout} CHF  [${s.label}]`);
      });
    }
    console.log();
  }
  process.exit(1);
}
