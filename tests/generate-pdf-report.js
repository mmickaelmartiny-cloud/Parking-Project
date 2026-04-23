#!/usr/bin/env node
/**
 * Exécute la matrice de tests et génère un rapport HTML + PDF.
 * Sortie : parkings-sion-tests.pdf à la racine du projet.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { TESTS, runTest, waitForServer, PORT } = require('./run-tests.js');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT   = path.resolve(__dirname, '..');
const HTML   = path.join(ROOT, 'tests', 'report.html');
const PDF    = path.join(ROOT, 'parkings-sion-tests.pdf');

async function run() {
  console.log('▸ Démarrage du serveur test sur port', PORT, '…');
  const server = spawn('node', [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (!await waitForServer()) {
    server.kill();
    throw new Error('Serveur non prêt');
  }
  console.log('  ✓ Serveur prêt');

  const results = [];
  for (const t of TESTS) {
    const r = await runTest(t);
    results.push({ ...t, ...r });
  }
  server.kill();

  const total  = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed = total - passed;

  const byCat = {};
  for (const r of results) {
    byCat[r.cat] = byCat[r.cat] || { pass: 0, total: 0 };
    byCat[r.cat].total++;
    if (r.pass) byCat[r.cat].pass++;
  }

  const now = new Date();
  const dateStr = now.toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });

  const html = buildHtml({ results, total, passed, failed, byCat, dateStr });
  fs.writeFileSync(HTML, html);
  console.log('  ✓ HTML rapport écrit :', HTML);

  console.log('▸ Génération du PDF via Chrome headless…');
  await new Promise((resolve, reject) => {
    const chrome = spawn(CHROME, [
      '--headless',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${PDF}`,
      `file://${HTML}`
    ], { stdio: 'pipe' });
    chrome.on('close', code => code === 0 ? resolve() : reject(new Error('Chrome exit ' + code)));
  });

  const stat = fs.statSync(PDF);
  console.log(`  ✓ PDF généré : ${PDF} (${Math.round(stat.size / 1024)} KB)`);
  console.log('\n' + (failed === 0 ? `✅ ${passed}/${total} tests passent` : `❌ ${failed}/${total} échecs`));
}

function buildHtml({ results, total, passed, failed, byCat, dateStr }) {
  const allPass = failed === 0;
  const catLabels = {
    Base: 'Règles de base',
    Midi: 'Règle midi (12h–13h30) × 1ère heure',
    Weekend: 'Week-end (plage hebdo)',
    Nuit: 'Tarif nuit',
    'Férié': 'Dimanches & jours fériés',
    Plafond: 'Plafonds Cour de Gare',
    Moto: 'Tarif moto'
  };

  let rows = '';
  let prevCat = null;
  for (const r of results) {
    if (r.cat !== prevCat) {
      prevCat = r.cat;
      rows += `<tr class="cat-header"><td colspan="5">${catLabels[r.cat] || r.cat}</td></tr>`;
    }
    const statusClass = r.pass ? 'pass' : 'fail';
    const statusTxt   = r.pass ? '✓ PASS' : '✗ FAIL';
    const expected    = r.expected === 'ERR' ? 'Erreur' : Number(r.expected).toFixed(2) + ' CHF';
    const actual      = typeof r.actual === 'number'
      ? r.actual.toFixed(2) + ' CHF'
      : String(r.actual).length > 40 ? String(r.actual).slice(0, 40) + '…' : String(r.actual);
    rows += `
      <tr class="row-${statusClass}">
        <td class="c id"><strong>${r.id}</strong></td>
        <td class="scenario">${escapeHtml(r.desc)}</td>
        <td class="r value">${expected}</td>
        <td class="r value">${escapeHtml(actual)}</td>
        <td class="c status-${statusClass}">${statusTxt}</td>
      </tr>`;
  }

  const catStats = Object.entries(byCat).map(([cat, s]) => {
    const pct = Math.round((s.pass / s.total) * 100);
    const color = s.pass === s.total ? '#2B9A52' : '#C53030';
    return `
      <div class="catstat">
        <div class="catstat-label">${catLabels[cat] || cat}</div>
        <div class="catstat-val" style="color:${color}">${s.pass}/${s.total}</div>
        <div class="catstat-bar"><div class="catstat-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport de tests — Parkings Sion</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --navy: #0A1F3D;
  --navy-2: #142F56;
  --accent: #2B7FC9;
  --accent-light: #5FA3DC;
  --ink: #1A202C;
  --ink-2: #4A5568;
  --ink-3: #718096;
  --bg: #FFFFFF;
  --bg-2: #F7FAFC;
  --bg-3: #EDF2F7;
  --line: #E2E8F0;
  --gr: #2B9A52;
  --gr-light: #E6F4EA;
  --re: #C53030;
  --re-light: #FEE;
  --am: #D69E2E;
}
@page { size: A4; margin: 12mm 12mm 14mm 12mm; }
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'DM Sans', system-ui, sans-serif;
  color: var(--ink);
  background: var(--bg);
  line-height: 1.45;
  font-size: 9.5pt;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, h3 { font-family: 'Space Grotesk', sans-serif; color: var(--navy); }
code { font-family: 'JetBrains Mono', monospace; font-size: 8.5pt; background: var(--bg-3); padding: 1px 5px; border-radius: 3px; color: var(--accent); }

.cover {
  background: linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%);
  color: white;
  padding: 30mm 18mm;
  margin: -12mm -12mm 10mm -12mm;
}
.cover .tag {
  display: inline-block;
  padding: 4px 12px;
  background: rgba(95,163,220,.2);
  border: 1px solid rgba(95,163,220,.4);
  border-radius: 20px;
  font-size: 9pt;
  color: var(--accent-light);
  letter-spacing: .05em;
  text-transform: uppercase;
  margin-bottom: 18px;
}
.cover h1 { font-size: 30pt; color: white; line-height: 1.05; letter-spacing: -0.02em; margin-bottom: 8px; }
.cover .sub { font-size: 13pt; color: var(--accent-light); font-weight: 300; }
.cover-meta {
  display: flex;
  gap: 30px;
  margin-top: 24px;
  font-size: 9.5pt;
  color: rgba(255,255,255,.75);
}
.cover-meta strong { color: white; }

.verdict {
  background: ${allPass ? 'linear-gradient(135deg, #E6F4EA, #F0FAF3)' : 'linear-gradient(135deg, #FEE, #FFF5F5)'};
  border-left: 4px solid ${allPass ? 'var(--gr)' : 'var(--re)'};
  padding: 16px 20px;
  border-radius: 6px;
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.verdict-icon { font-size: 32pt; line-height: 1; color: ${allPass ? 'var(--gr)' : 'var(--re)'}; }
.verdict-text h2 { font-size: 16pt; margin-bottom: 2px; color: ${allPass ? 'var(--gr)' : 'var(--re)'}; }
.verdict-text p { font-size: 10pt; color: var(--ink-2); }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.stat {
  background: var(--bg-2);
  border-left: 3px solid var(--accent);
  border-radius: 5px;
  padding: 12px 16px;
}
.stat-v { font-family: 'Space Grotesk', sans-serif; font-size: 24pt; font-weight: 700; color: var(--navy); line-height: 1; margin-bottom: 3px; }
.stat-v.ok { color: var(--gr); }
.stat-v.ko { color: var(--re); }
.stat-l { font-size: 8.5pt; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; }

h2.section {
  font-size: 13pt;
  margin: 14px 0 10px;
  padding-bottom: 5px;
  border-bottom: 2px solid var(--accent);
}

.catstats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 24px;
  margin-bottom: 18px;
}
.catstat {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.catstat-label { font-size: 9.5pt; font-weight: 500; color: var(--ink); }
.catstat-val { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 10.5pt; }
.catstat-bar { grid-column: 1 / -1; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; margin-top: 4px; }
.catstat-bar-fill { height: 100%; border-radius: 2px; transition: width .3s; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 8.8pt;
}
th {
  background: var(--navy);
  color: white;
  text-align: left;
  padding: 7px 9px;
  font-weight: 600;
  font-size: 8pt;
  text-transform: uppercase;
  letter-spacing: .04em;
}
td {
  padding: 6px 9px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
td.c, th.c { text-align: center; }
td.r, th.r { text-align: right; }
td.id { font-family: 'Space Grotesk', sans-serif; color: var(--accent); width: 40px; }
td.scenario { color: var(--ink-2); }
td.value { font-family: 'JetBrains Mono', monospace; font-size: 8.5pt; white-space: nowrap; }

tr.cat-header td {
  background: linear-gradient(90deg, var(--bg-3) 0%, var(--bg-2) 100%);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 9.5pt;
  color: var(--navy);
  padding: 8px 10px;
  border-bottom: 2px solid var(--accent);
  letter-spacing: .02em;
}

tr.row-pass td.status-pass {
  color: var(--gr);
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  background: var(--gr-light);
  width: 80px;
}
tr.row-fail td.status-fail {
  color: var(--re);
  font-weight: 700;
  font-family: 'Space Grotesk', sans-serif;
  background: var(--re-light);
  width: 80px;
}

footer {
  text-align: center;
  margin-top: 20px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--ink-3);
  font-size: 8.5pt;
}

.legend {
  background: var(--bg-2);
  padding: 10px 14px;
  border-radius: 5px;
  font-size: 8.5pt;
  color: var(--ink-2);
  margin-top: 10px;
}
.legend strong { color: var(--navy); font-family: 'Space Grotesk', sans-serif; }
</style>
</head>
<body>

<div class="cover">
  <div class="tag">Rapport de tests · ${results.length} scénarios</div>
  <h1>Parkings Sion</h1>
  <div class="sub">Matrice de validation du moteur tarifaire</div>
  <div class="cover-meta">
    <div><strong>Exécution :</strong> ${dateStr}</div>
    <div><strong>Environnement :</strong> local</div>
    <div><strong>Tolérance :</strong> ±0.01 CHF</div>
  </div>
</div>

<div class="verdict">
  <div class="verdict-icon">${allPass ? '✓' : '✗'}</div>
  <div class="verdict-text">
    <h2>${allPass ? `${passed}/${total} tests réussis` : `${failed}/${total} tests en échec`}</h2>
    <p>${allPass ? 'Tous les tarifs sont conformes aux spécifications officielles de la Ville de Sion.' : 'Examinez les lignes marquées FAIL pour identifier les régressions.'}</p>
  </div>
</div>

<div class="stats-grid">
  <div class="stat"><div class="stat-v">${total}</div><div class="stat-l">Tests exécutés</div></div>
  <div class="stat"><div class="stat-v ok">${passed}</div><div class="stat-l">Passent</div></div>
  <div class="stat"><div class="stat-v ${failed > 0 ? 'ko' : ''}">${failed}</div><div class="stat-l">Échouent</div></div>
</div>

<h2 class="section">Résultats par catégorie</h2>
<div class="catstats">${catStats}</div>

<h2 class="section">Détail des ${total} tests</h2>
<table>
  <thead>
    <tr>
      <th style="width:40px">ID</th>
      <th>Scénario</th>
      <th class="r" style="width:90px">Attendu</th>
      <th class="r" style="width:110px">Obtenu</th>
      <th class="c" style="width:80px">Statut</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="legend">
  <strong>Lecture</strong> — Chaque test envoie une requête <code>POST /api/calculer</code>, compare le total retourné au montant attendu. Un test passe si l'écart est inférieur à 0.01 CHF. Les tests moto acceptent une erreur HTTP 400 comme résultat attendu si le parking ne supporte pas ce véhicule.
</div>

<footer>
  Parkings Sion · parking-sion.up.railway.app · Rapport de tests généré le ${dateStr}
</footer>

</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

run().catch(err => {
  console.error('✗ Erreur :', err.message);
  process.exit(1);
});
