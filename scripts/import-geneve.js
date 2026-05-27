#!/usr/bin/env node
/**
 * Import Genève : GeoJSON (géo) + Excel (tarifs) → data/villes/geneve.json
 *
 * Usage : node scripts/import-geneve.js
 *
 * Sources :
 *   - Database_Geneve/Parkings_PMDS_20260319_GEOJSON (1).geojson
 *   - Database_Geneve/Référentiel Tarification_parkings_PMDS (MASTER) - 20260416.xlsx
 *
 * Stratégie phase 1 (MVP) :
 *   - Garder uniquement les parkings non-privés
 *   - Joindre sur Code_Tarif
 *   - Parser tarifs simples (Prix horaire numérique)
 *   - Flagger les tarifs complexes (texte libre) en "approximatif" pour saisie manuelle
 *   - Calculer centroïde polygone → coords lat/lng
 *   - Produire un rapport d'import (skipped, approximatif, OK)
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'Database_Geneve');
const OUT_JSON = path.join(ROOT, 'data', 'villes', 'geneve.json');
const OUT_REPORT = path.join(ROOT, 'data', 'villes', 'geneve-import-report.md');

const GEOJSON_FILE = path.join(SRC_DIR, 'Parkings_PMDS_20260319_GEOJSON (1).geojson');
const XLSX_FILE = path.join(SRC_DIR, 'Référentiel Tarification_parkings_PMDS (MASTER) - 20260416.xlsx');

// ---------- Helpers ----------

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function centroidOfPolygon(coords) {
  // coords = [[lng, lat], ...] (outer ring of a Polygon)
  let sumLat = 0, sumLng = 0, n = 0;
  for (const [lng, lat] of coords) {
    sumLng += lng;
    sumLat += lat;
    n++;
  }
  return { lat: +(sumLat / n).toFixed(6), lng: +(sumLng / n).toFixed(6) };
}

function centroidOfFeature(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === 'Polygon') return centroidOfPolygon(g.coordinates[0]);
  if (g.type === 'MultiPolygon') return centroidOfPolygon(g.coordinates[0][0]);
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates;
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  }
  return null;
}

// "7h-19h" → [7, 19]
// "8h-12h, 14h-18h" → [[8,12], [14,18]]
// "0h-24h" → [0, 24]
function parseHeuresPayantes(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  const ranges = [];
  for (const part of parts) {
    const m = part.match(/(\d{1,2})h(\d{0,2})?\s*[-–]\s*(\d{1,2})h(\d{0,2})?/i);
    if (!m) return null;
    const h1 = parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 60 : 0);
    const h2 = parseInt(m[3], 10) + (m[4] ? parseInt(m[4], 10) / 60 : 0);
    ranges.push([h1, h2]);
  }
  return ranges;
}

// Renvoie les règles `regles[]` correspondant aux jours non-payants
function reglesPourJoursPayants(joursPayants, joursFeriesGratuit) {
  const regles = [];
  const jp = String(joursPayants || '').toLowerCase().trim();

  // lun-ven : dim + sam gratuit
  // lun-sam : dim gratuit
  // lun-dim : aucune gratuité hebdo
  if (jp === 'lun-ven') {
    regles.push({
      type: 'gratuit_plage_hebdo',
      jour: 6,
      hDeb: 0,
      hFin: 24,
      label: 'Gratuit le samedi',
      emoji: '🎉'
    });
    regles.push({
      type: 'gratuit_dim',
      label: 'Gratuit le dimanche',
      emoji: '🎉'
    });
  } else if (jp === 'lun-sam') {
    regles.push({
      type: 'gratuit_dim',
      label: 'Gratuit le dimanche',
      emoji: '🎉'
    });
  }

  if (joursFeriesGratuit) {
    regles.push({
      type: 'gratuit_dim_feries',
      label: 'Gratuit les jours fériés',
      emoji: '🎊'
    });
  }
  return regles;
}

// Construit l'objet `tarification` à partir d'un tarif simple
function buildTarification(prixH, heuresPayantes, tempsGratuiteMin) {
  // Cas 1 : payant 24h/24
  const isFull24 = heuresPayantes.length === 1 &&
                   heuresPayantes[0][0] === 0 && heuresPayantes[0][1] === 24;

  // Plage principale (jour) : 1ère plage de heuresPayantes
  const [hDeb, hFin] = heuresPayantes[0];

  // Plages de gratuité quotidiennes (ex: pause 12-14 si Heures = "8h-12h, 14h-18h")
  const pausesGratuites = [];
  if (heuresPayantes.length > 1) {
    for (let i = 0; i < heuresPayantes.length - 1; i++) {
      pausesGratuites.push({
        type: 'gratuit_plage_quotidien',
        hDeb: heuresPayantes[i][1],
        hFin: heuresPayantes[i + 1][0],
        label: `Gratuit ${heuresPayantes[i][1]}h–${heuresPayantes[i + 1][0]}h`,
        emoji: '⏸️'
      });
    }
  }

  // Plage finale = dernière "heure de fin"
  const hFinJour = heuresPayantes[heuresPayantes.length - 1][1];

  const tarification = {
    gratuit_initial: tempsGratuiteMin || 0,
    jour: {
      heures: [hDeb, hFinJour],
      arrondi: 'ceil',
      paliers: [
        { jusqua: null, tranche: 1, prix: +(prixH / 60).toFixed(4) }
      ],
      plafond: 9999
    },
    nuit: {
      heures: [hFinJour, hDeb],
      dimFeries: true,
      arrondi: 'ceil',
      paliers: [
        { jusqua: null, tranche: 60, prix: 0 }
      ],
      plafond: 0
    }
  };

  // Si payant 24h/24 → pas de "nuit" gratuite
  if (isFull24) {
    tarification.jour.heures = [0, 24];
    tarification.nuit = {
      heures: [24, 24],
      dimFeries: false,
      arrondi: 'ceil',
      paliers: [
        { jusqua: null, tranche: 1, prix: +(prixH / 60).toFixed(4) }
      ],
      plafond: 9999
    };
  }

  return { tarification, pausesGratuites };
}

// "1" / "0.5" / "CHF 1,00" / "CHF 0.60" → 1.0 / 0.5 / 1.0 / 0.6
function parseMontant(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/CHF/i, '').replace(',', '.').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "30 min" / "60 min" / "2 heures" → minutes
function parseDureeEnMinutes(str) {
  if (str == null) return null;
  const s = String(str).toLowerCase().trim();
  const mMin = s.match(/^(\d+)\s*min/);
  if (mMin) return parseInt(mMin[1], 10);
  const mH = s.match(/^(\d+)\s*(?:h|heure)/);
  if (mH) return parseInt(mH[1], 10) * 60;
  const mJ = s.match(/^(\d+)\s*jour/);
  if (mJ) return parseInt(mJ[1], 10) * 24 * 60;
  return null;
}

// ---------- Chargement ----------

function loadGeo() {
  const raw = fs.readFileSync(GEOJSON_FILE, 'utf8');
  return JSON.parse(raw);
}

function loadTarifs() {
  const wb = XLSX.readFile(XLSX_FILE);
  const ws = wb.Sheets['Table Tarifs'];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const map = new Map();
  for (const r of rows) {
    if (r['Code tarif'] == null) continue;
    map.set(String(r['Code tarif']).trim(), r);
  }
  return map;
}

// ---------- Transformation principale ----------

function transformFeature(feature, tarifsByCode, report) {
  const p = feature.properties;
  const statut = (p.Statut || '').toLowerCase().trim();

  // Exclure privés
  if (statut === 'privé' || statut === 'prive') {
    report.skipped.push({ id: p.OBJECTID, nom: p.Nom_Parking, raison: 'privé' });
    return null;
  }

  const codeTarif = p.Code_Tarif != null ? String(p.Code_Tarif).trim() : null;
  const tarif = codeTarif ? tarifsByCode.get(codeTarif) : null;

  if (!tarif) {
    report.skipped.push({
      id: p.OBJECTID,
      nom: p.Nom_Parking,
      codeTarif,
      raison: 'tarif introuvable'
    });
    return null;
  }

  const prixH = tarif['Prix horaire'];
  const heuresStr = tarif['Heures payantes'];
  const heures = parseHeuresPayantes(heuresStr);

  // Tarif texte libre → on garde le parking mais sans simulateur
  if (typeof prixH !== 'number') {
    const coords = centroidOfFeature(feature);
    const id = slugify(`${p.Nom_Parking}-${p.OBJECTID}`);
    report.approximatif.push({ id, nom: p.Nom_Parking, codeTarif, prixHRaw: prixH });
    return {
      id,
      nom: p.Nom_Parking,
      adresse: [p.Adresse_Rue, p.Adresse_No, p.Adresse_NPA, p.Adresse_Localite]
        .filter(Boolean).join(' '),
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.Nom_Parking + ' Genève')}`,
      places: p.Capacite,
      typeParking: p.Type_Parking,
      typeVehicule: p.Type_Vehicule,
      codeTarif,
      tarifBrut: String(prixH),
      tarifApproximatif: true,
      regles: [
        { type: 'info', label: '⚠️ Tarif complexe, voir détail sur place', emoji: '⚠️' }
      ],
      coords,
      ville: 'geneve',
      feriesCanton: 'GE'
    };
  }

  if (!heures || heures.length === 0) {
    report.skipped.push({
      id: p.OBJECTID,
      nom: p.Nom_Parking,
      codeTarif,
      raison: `heures payantes non parsables: ${heuresStr}`
    });
    return null;
  }

  const tempsGratuiteMin = parseDureeEnMinutes(tarif['Temps de gratuité']);
  const joursFeriesGratuit = String(tarif['Jours fériés'] || '').toLowerCase().trim() === 'gratuit';
  const regles = reglesPourJoursPayants(tarif['Jours payants'], joursFeriesGratuit);

  const { tarification, pausesGratuites } = buildTarification(prixH, heures, tempsGratuiteMin);
  regles.push(...pausesGratuites);

  if (tempsGratuiteMin) {
    regles.unshift({
      type: tempsGratuiteMin === 60 ? 'premiere_h_gratuite' :
            tempsGratuiteMin === 30 ? 'demi_h_gratuite' : 'gratuit_initial',
      label: `Premières ${tempsGratuiteMin} min gratuites`,
      emoji: '🎁'
    });
  }

  regles.push({ type: 'info', label: 'Facturation à la minute', emoji: '⏱️' });

  const montantMin = parseMontant(tarif['Montant minimum']);
  if (montantMin) {
    regles.push({
      type: 'info',
      label: `Montant minimum facturé : CHF ${montantMin.toFixed(2)}`,
      emoji: '💰'
    });
  }

  const coords = centroidOfFeature(feature);
  const id = slugify(`${p.Nom_Parking}-${p.OBJECTID}`);

  const note = tarif['Durée maximale']
    ? `Durée max : ${tarif['Durée maximale']}`
    : undefined;

  report.ok.push({ id, nom: p.Nom_Parking, codeTarif, prixH });

  return {
    id,
    nom: p.Nom_Parking,
    adresse: [p.Adresse_Rue, p.Adresse_No, p.Adresse_NPA, p.Adresse_Localite]
      .filter(Boolean).join(' '),
    maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.Nom_Parking + ' Genève')}`,
    places: p.Capacite,
    typeParking: p.Type_Parking,
    typeVehicule: p.Type_Vehicule,
    codeTarif,
    prixH,
    montantMin: montantMin || undefined,
    horaire: '24h/24',
    ouvH: 0,
    fermH: 24,
    note,
    regles,
    tarification,
    coords,
    ville: 'geneve',
    feriesCanton: 'GE',
    source: 'Référentiel Tarification PMDS (16.04.2026)',
    dateTarif: '2026-04-16'
  };
}

// ---------- Rapport ----------

function writeReport(report) {
  const lines = [];
  lines.push('# Rapport import Genève');
  lines.push('');
  lines.push(`Date : ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Synthèse');
  lines.push('');
  lines.push(`- ✅ OK (simulateur fiable) : **${report.ok.length}**`);
  lines.push(`- ⚠️ Approximatif (tarif complexe, carte seulement) : **${report.approximatif.length}**`);
  lines.push(`- ❌ Skipped : **${report.skipped.length}**`);
  lines.push('');

  lines.push('## ✅ Parkings importés avec simulateur');
  lines.push('');
  lines.push('| Nom | Code tarif | Prix/h |');
  lines.push('|---|---|---|');
  for (const p of report.ok) lines.push(`| ${p.nom} | ${p.codeTarif} | CHF ${p.prixH} |`);
  lines.push('');

  lines.push('## ⚠️ Parkings approximatifs (tarif texte libre à saisir manuellement)');
  lines.push('');
  lines.push('| Nom | Code tarif | Tarif brut |');
  lines.push('|---|---|---|');
  for (const p of report.approximatif) {
    const brut = String(p.prixHRaw).replace(/\r?\n/g, ' / ').slice(0, 100);
    lines.push(`| ${p.nom} | ${p.codeTarif} | ${brut} |`);
  }
  lines.push('');

  lines.push('## ❌ Parkings skipped');
  lines.push('');
  const bySkipReason = {};
  for (const s of report.skipped) {
    const k = s.raison.split(':')[0];
    bySkipReason[k] = (bySkipReason[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(bySkipReason)) {
    lines.push(`- ${k} : ${n}`);
  }
  lines.push('');
  lines.push('<details><summary>Détail</summary>');
  lines.push('');
  lines.push('| Nom | Code tarif | Raison |');
  lines.push('|---|---|---|');
  for (const s of report.skipped) {
    lines.push(`| ${s.nom || '(sans nom)'} | ${s.codeTarif || '-'} | ${s.raison} |`);
  }
  lines.push('</details>');
  lines.push('');

  fs.writeFileSync(OUT_REPORT, lines.join('\n'), 'utf8');
}

// ---------- Main ----------

function main() {
  console.log('→ Chargement GeoJSON…');
  const geo = loadGeo();
  console.log(`  ${geo.features.length} features`);

  console.log('→ Chargement tarifs…');
  const tarifs = loadTarifs();
  console.log(`  ${tarifs.size} codes tarifs uniques`);

  console.log('→ Transformation…');
  const report = { ok: [], approximatif: [], skipped: [] };
  const parkings = [];
  for (const f of geo.features) {
    const t = transformFeature(f, tarifs, report);
    if (t) parkings.push(t);
  }

  // Dédoublonnage par id (au cas où plusieurs polygones pour un même parking)
  const seen = new Set();
  const unique = [];
  for (const p of parkings) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(unique, null, 2), 'utf8');
  writeReport(report);

  console.log('');
  console.log(`✅ Écrit ${unique.length} parkings → ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`📋 Rapport → ${path.relative(ROOT, OUT_REPORT)}`);
  console.log('');
  console.log(`   OK (simu) : ${report.ok.length}`);
  console.log(`   Approximatif : ${report.approximatif.length}`);
  console.log(`   Skipped : ${report.skipped.length}`);
}

main();
