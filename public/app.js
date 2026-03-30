// ── THÈME ─────────────────────────────────────────────────────────────────

const THEME_COLORS = { dark: '#060913', light: '#EDB82A' };

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.getElementById('metaThemeColor');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(saved || preferred);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('theme', next);
}

// ── SERVICE WORKER ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

initTheme();

// ── FORMATAGE ─────────────────────────────────────────────────────────────

function fmtH(d) {
  return new Date(d).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
}
function fmtD(d) {
  return new Date(d).toLocaleDateString('fr-CH', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtDuree(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}
function fmtChf(v) { return Number(v).toFixed(2); }

// ── RENDU DES CARTES ──────────────────────────────────────────────────────

async function init() {
  const res = await fetch('/api/parkings');
  const parkings = await res.json();

  const grid = document.getElementById('parkingGrid');
  const sel  = document.getElementById('selParking');

  parkings.forEach((p, idx) => {
    const isFree   = p.prixH === 0;
    const priceStr = isFree ? 'Gratuit' : `CHF ${Number(p.prixH).toFixed(2)}`;

    const rulesHTML = p.regles.length
      ? `<div class="rules-list">${p.regles.map(r =>
          `<span class="rule-chip">${r.emoji || ''} ${r.label}</span>`).join('')}
          ${p.note ? `<span class="rule-chip">ℹ️ ${p.note}</span>` : ''}
         </div>`
      : (p.note
        ? `<div class="rules-list"><span class="rule-chip">ℹ️ ${p.note}</span></div>`
        : `<div class="no-rules">Aucune réduction spéciale</div>`);

    const card = document.createElement('div');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Simuler le prix pour ${p.nom}`);
    card.style.animationDelay = `${idx * 55}ms`;

    card.innerHTML = `
      <div class="card-top">
        <div class="card-name-block">
          <div class="card-title">${p.nom}</div>
          <div class="card-addr"><a href="${p.maps}" target="_blank" rel="noopener" class="maps-link" onclick="event.stopPropagation()">📍 ${p.adresse}</a></div>
        </div>
        <div class="price-badge">
          <span class="price-amount${isFree ? ' is-free' : ''}">${priceStr}</span>
          <span class="price-unit">par heure</span>
        </div>
      </div>
      <div class="card-body">
        <div class="stats-row">
          <div class="stat-box">
            <span class="stat-val">${p.places}</span>
            <span class="stat-lbl">Places</span>
          </div>
          <div class="stat-box">
            <span class="stat-val">${Number(p.hauteur).toFixed(2)} m</span>
            <span class="stat-lbl">Hauteur</span>
          </div>
          <div class="stat-box">
            <span class="stat-val" style="font-size:0.72rem;line-height:1.4">${p.horaire}</span>
            <span class="stat-lbl">Horaires</span>
          </div>
        </div>
        ${rulesHTML}
      </div>
      <div class="card-go-hint">Simuler →</div>`;

    const go = () => {
      document.getElementById('selParking').value = p.id;
      setMode('single');
      document.querySelector('.simulator').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    grid.appendChild(card);

    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nom;
    sel.appendChild(opt);
  });

  setDefaults();
  setMode('all');
}

// ── MODE (single / all) ───────────────────────────────────────────────────

let currentMode = 'all';

function setMode(mode) {
  currentMode = mode;
  document.getElementById('tabSingle').classList.toggle('active', mode === 'single');
  document.getElementById('tabAll').classList.toggle('active', mode === 'all');
  document.getElementById('tabSingle').setAttribute('aria-selected', mode === 'single');
  document.getElementById('tabAll').setAttribute('aria-selected', mode === 'all');
  document.getElementById('fieldParking').style.display = mode === 'single' ? '' : 'none';
  document.getElementById('result').className = 'result';
  document.getElementById('comparison').className = 'comparison';
  document.getElementById('alertError').className = 'alert error';

  const btn = document.getElementById('btnCalc');
  if (mode === 'all') {
    document.getElementById('simTitle').textContent = 'Comparer tous les parkings';
    document.getElementById('simSubtitle').textContent = 'Classement du moins cher au plus cher pour la période choisie';
    document.getElementById('simIcon').textContent = '◉';
    btn.textContent = 'Comparer les parkings';
    btn.onclick = comparer;
  } else {
    document.getElementById('simTitle').textContent = 'Calculez votre tarif exact';
    document.getElementById('simSubtitle').textContent = 'Toutes les spécificités tarifaires sont automatiquement prises en compte';
    document.getElementById('simIcon').textContent = '◈';
    btn.textContent = 'Calculer le prix';
    btn.onclick = simuler;
  }
}

// ── SIMULATEUR ────────────────────────────────────────────────────────────

function setDefaults() {
  const now   = new Date(); now.setSeconds(0, 0);
  const later = new Date(now.getTime() + 2 * 3600000);
  const fmt = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  document.getElementById('inpArrivee').value = fmt(now);
  document.getElementById('inpDepart').value  = fmt(later);
}

async function simuler() {
  const alertEl  = document.getElementById('alertError');
  const resultEl = document.getElementById('result');
  const btn      = document.getElementById('btnCalc');

  alertEl.className  = 'alert error';
  resultEl.className = 'result';

  const pid   = document.getElementById('selParking').value;
  const arStr = document.getElementById('inpArrivee').value;
  const dpStr = document.getElementById('inpDepart').value;

  function showErr(msg) {
    alertEl.innerHTML = `⚠️&nbsp; ${msg}`;
    alertEl.className = 'alert error visible';
  }

  if (!arStr || !dpStr) { showErr('Veuillez renseigner l\'heure d\'arrivée et de départ.'); return; }

  const arrivee = new Date(arStr);
  const depart  = new Date(dpStr);

  if (depart <= arrivee)                           { showErr('L\'heure de départ doit être postérieure à l\'heure d\'arrivée.'); return; }
  if ((depart - arrivee) / 60000 > 7 * 24 * 60)   { showErr('La durée maximum simulable est de 7 jours.'); return; }

  btn.disabled = true;
  btn.textContent = 'Calcul en cours…';

  try {
    const res = await fetch('/api/calculer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ parkingId: pid, arrivee: arStr, depart: dpStr })
    });
    const data = await res.json();

    if (!res.ok) { showErr(data.erreur || 'Erreur serveur.'); return; }

    const { parking, result } = data;
    const dureeMin = (depart - arrivee) / 60000;

    document.getElementById('resNom').textContent = parking.nom;
    document.getElementById('resPeriode').textContent =
      `${fmtD(arStr)} ${fmtH(arStr)} → ${fmtD(dpStr)} ${fmtH(dpStr)}  ·  ${fmtDuree(dureeMin)}`;
    document.getElementById('resTotal').textContent = fmtChf(result.total);

    const savEl = document.getElementById('resSavings');
    if (result.economies > 0.005) {
      savEl.textContent = `Économie appliquée : CHF ${fmtChf(result.economies)}`;
      savEl.style.display = 'block';
    } else {
      savEl.style.display = 'none';
    }

    const tbody = document.getElementById('breakdownBody');
    tbody.innerHTML = '';
    result.segments.forEach(seg => {
      const dotColor  = seg.isFree ? '#3DCF8F' : (seg.isReduced ? '#D97706' : '#5C5750');
      const costClass = seg.isFree ? 'cost-free' : (seg.isReduced ? 'cost-reduced' : 'cost-normal');
      const costText  = seg.isFree ? 'Gratuit' : `CHF ${fmtChf(seg.cout)}`;
      const tarifText = seg.isFree ? '—' : `CHF ${fmtChf(seg.tauxH)}/h`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="seg-name">
            <span class="seg-dot" style="background:${dotColor}"></span>
            <span>${seg.label}</span>
          </div>
          <div class="seg-time">${fmtD(seg.from)} ${fmtH(seg.from)} – ${fmtH(seg.to)}</div>
        </td>
        <td>${fmtDuree(seg.minutes)}</td>
        <td style="color:var(--t3)">${tarifText}</td>
        <td><span class="${costClass}">${costText}</span></td>`;
      tbody.appendChild(tr);
    });

    const footerEl = document.getElementById('resultFooter');
    const noteEl   = document.getElementById('resultNote');
    if (parking.ouvH !== 0 || parking.fermH !== 24) {
      noteEl.textContent = `Ce parking est ouvert de ${parking.ouvH}h à ${parking.fermH}h. Vérifiez que votre séjour respecte ces horaires.`;
      footerEl.style.display = 'flex';
    } else {
      footerEl.style.display = 'none';
    }

    resultEl.className = 'result';
    requestAnimationFrame(() => { resultEl.className = 'result visible'; });

  } catch (err) {
    showErr('Impossible de contacter le serveur.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Calculer le prix';
  }
}

// ── COMPARATEUR ───────────────────────────────────────────────────────────

async function comparer() {
  const alertEl = document.getElementById('alertError');
  const compEl  = document.getElementById('comparison');
  const btn     = document.getElementById('btnCalc');

  alertEl.className = 'alert error';
  compEl.className  = 'comparison';

  const arStr = document.getElementById('inpArrivee').value;
  const dpStr = document.getElementById('inpDepart').value;

  function showErr(msg) {
    alertEl.innerHTML = `⚠️&nbsp; ${msg}`;
    alertEl.className = 'alert error visible';
  }

  if (!arStr || !dpStr) { showErr('Veuillez renseigner l\'heure d\'arrivée et de départ.'); return; }

  const arrivee = new Date(arStr);
  const depart  = new Date(dpStr);

  if (depart <= arrivee)                         { showErr('L\'heure de départ doit être postérieure à l\'heure d\'arrivée.'); return; }
  if ((depart - arrivee) / 60000 > 7 * 24 * 60) { showErr('La durée maximum simulable est de 7 jours.'); return; }

  btn.disabled = true;
  btn.textContent = 'Calcul en cours…';

  try {
    const parkingsList = await fetch('/api/parkings').then(r => r.json());

    const results = await Promise.all(
      parkingsList.map(p =>
        fetch('/api/calculer', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ parkingId: p.id, arrivee: arStr, depart: dpStr })
        })
        .then(r => r.json())
        .then(data => ({ parking: data.parking, result: data.result }))
        .catch(() => ({ parking: p, result: null }))
      )
    );

    results.sort((a, b) => {
      if (!a.result) return 1;
      if (!b.result) return -1;
      return a.result.total - b.result.total;
    });

    const maxTotal = Math.max(...results.filter(r => r.result).map(r => r.result.total), 0.01);
    const dureeMin = (depart - arrivee) / 60000;

    document.getElementById('compPeriode').innerHTML =
      `<strong>${fmtD(arStr)} ${fmtH(arStr)}</strong> → <strong>${fmtD(dpStr)} ${fmtH(dpStr)}</strong>&ensp;·&ensp;${fmtDuree(dureeMin)}`;

    const list = document.getElementById('compList');
    list.innerHTML = '';

    results.forEach((item, idx) => {
      const { parking, result } = item;
      const isBest   = idx === 0 && result;
      const isFree   = result && result.total === 0;
      const barPct   = result ? (isFree ? 0 : Math.max((result.total / maxTotal) * 100, 3)) : 100;
      const hasSaving = result && result.economies > 0.005;

      const row = document.createElement('div');
      row.className = 'comp-row' + (isBest ? ' comp-row-best' : '');
      row.style.animationDelay = `${idx * 60}ms`;

      const rankHTML = isBest
        ? `<span class="comp-rank best"><span class="trophy">🏆</span></span>`
        : `<span class="comp-rank">${idx + 1}</span>`;

      const amountHTML = result
        ? `<div class="comp-amount${isFree ? ' is-free' : ''}">CHF ${fmtChf(result.total)}</div>
           ${hasSaving ? `<div class="comp-saving">− CHF ${fmtChf(result.economies)} économisé</div>` : ''}`
        : `<div class="comp-amount" style="color:var(--t3)">—</div>`;

      const barClass = isFree ? 'bar-free' : (isBest ? 'bar-best' : '');

      row.innerHTML = `
        ${rankHTML}
        <div class="comp-info">
          <div class="comp-name">${parking.nom}</div>
          <div class="comp-addr"><a href="${parking.maps}" target="_blank" rel="noopener" class="maps-link" onclick="event.stopPropagation()">📍 ${parking.adresse}</a></div>
        </div>
        <div class="comp-right">${amountHTML}</div>
        <div class="comp-bar-wrap">
          <div class="comp-bar ${barClass}" style="width:${barPct}%"></div>
        </div>`;

      list.appendChild(row);
    });

    compEl.className = 'comparison';
    requestAnimationFrame(() => { compEl.className = 'comparison visible'; });

  } catch (err) {
    showErr('Impossible de contacter le serveur.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Comparer les parkings';
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────
init();
