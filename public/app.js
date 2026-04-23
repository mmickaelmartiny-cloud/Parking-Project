// ── THÈME ─────────────────────────────────────────────────────────────────

const THEME_COLORS = { dark: '#0F172A', light: '#FFFFFF' };

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.getElementById('metaThemeColor');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved || preferred);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('theme', next);
  if (map && lightTiles && darkTiles) {
    if (next === 'dark') { map.removeLayer(lightTiles); darkTiles.addTo(map); }
    else                 { map.removeLayer(darkTiles);  lightTiles.addTo(map); }
  }
}

// ── SERVICE WORKER ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

initTheme();

// ── FORMATAGE ─────────────────────────────────────────────────────────────

const fmtH = d => new Date(d).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
const fmtD = d => new Date(d).toLocaleDateString('fr-CH', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtChf = v => Number(v).toFixed(2);
function fmtDuree(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function priceClass(chf) {
  if (chf === 0) return 'price-free';
  if (chf <= 1.50) return 'price-low';
  if (chf <= 2.50) return 'price-mid';
  return 'price-high';
}

// ── ÉTAT ──────────────────────────────────────────────────────────────────

let currentMode = 'all';
let currentVehicule = 'voiture';
let allParkings = [];
let map = null;
let markers = {};       // id -> Leaflet marker
let markerEls = {};     // id -> HTMLElement du marker (pour update classes)
let activeId = null;
let lightTiles = null, darkTiles = null;

// ── CARTE ─────────────────────────────────────────────────────────────────

const SION_CENTER = [46.2311, 7.3589];

function initMap(parkings) {
  map = L.map('map', {
    center: SION_CENTER,
    zoom: 15,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true
  });

  const tileOpts = {
    subdomains: 'abcd',
    maxZoom: 19,
    minZoom: 8,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  };
  lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', tileOpts);
  darkTiles  = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', tileOpts);
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  (currentTheme === 'dark' ? darkTiles : lightTiles).addTo(map);

  parkings.forEach(p => addMarker(p));

  const group = L.featureGroup(Object.values(markers));
  map.fitBounds(group.getBounds(), { padding: [60, 60], maxZoom: 16 });

  // Zoom controls en bas à droite, plus propre
  map.zoomControl.setPosition('bottomleft');
}

function addMarker(p) {
  if (!p.coords) return;
  const priceStr = p.prixH === 0 ? 'Gratuit' : `${fmtChf(p.prixH)}`;
  const cls = priceClass(p.prixH);

  const icon = L.divIcon({
    className: '',
    html: `<div class="parking-marker ${cls}" data-id="${p.id}">${priceStr}</div>`,
    iconSize: null,
    iconAnchor: [25, 40]
  });

  const m = L.marker([p.coords.lat, p.coords.lng], { icon, riseOnHover: true })
    .addTo(map)
    .bindTooltip(p.nom, { direction: 'top', offset: [0, -36], opacity: 0.95 });

  m.on('click', () => focusParking(p.id, { pan: false }));

  markers[p.id] = m;

  // Stocker l'élément DOM du marker pour manipuler les classes
  queueMicrotask(() => {
    const el = m.getElement()?.querySelector('.parking-marker');
    if (el) markerEls[p.id] = el;
  });
}

function updateMarkerPrice(id, chf, { isBest = false } = {}) {
  const el = markerEls[id];
  if (!el) return;
  el.classList.remove('price-free', 'price-low', 'price-mid', 'price-high', 'is-best');
  el.classList.add(priceClass(chf));
  if (isBest) el.classList.add('is-best');
  el.textContent = chf === 0 ? 'Gratuit' : fmtChf(chf);
}

function resetMarkers() {
  allParkings.forEach(p => {
    const el = markerEls[p.id];
    if (!el) return;
    el.classList.remove('price-free', 'price-low', 'price-mid', 'price-high', 'is-best');
    el.classList.add(priceClass(p.prixH));
    el.textContent = p.prixH === 0 ? 'Gratuit' : fmtChf(p.prixH);
  });
  setActive(null);
}

function setActive(id) {
  if (activeId && markerEls[activeId]) markerEls[activeId].classList.remove('is-active');
  document.querySelectorAll('.parking-row.is-active').forEach(r => r.classList.remove('is-active'));
  activeId = id;
  if (id && markerEls[id]) markerEls[id].classList.add('is-active');
  if (id) {
    const row = document.querySelector(`.parking-row[data-id="${id}"]`);
    if (row) row.classList.add('is-active');
  }
}

function focusParking(id, { pan = true } = {}) {
  const p = allParkings.find(x => x.id === id);
  if (!p) return;
  setActive(id);
  if (pan && p.coords) map.setView([p.coords.lat, p.coords.lng], Math.max(map.getZoom(), 16), { animate: true });
  const sel = document.getElementById('selParking');
  if (sel && [...sel.options].some(o => o.value === id)) sel.value = id;
}

function recenter() {
  if (!map) return;
  const group = L.featureGroup(Object.values(markers));
  map.fitBounds(group.getBounds(), { padding: [60, 60], maxZoom: 16, animate: true });
  setActive(null);
}

// ── RENDU DES ROWS ────────────────────────────────────────────────────────

async function init() {
  const res = await fetch('/api/parkings');
  const parkings = await res.json();
  allParkings = parkings;

  const grid = document.getElementById('parkingGrid');
  const sel  = document.getElementById('selParking');

  parkings.forEach(p => {
    const isFree   = p.prixH === 0;
    const priceStr = isFree ? 'Gratuit' : fmtChf(p.prixH);
    const cls = priceClass(p.prixH);

    const row = document.createElement('div');
    row.className = 'parking-row';
    row.dataset.id = p.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Voir ${p.nom} sur la carte`);

    row.innerHTML = `
      <div class="row-price ${cls}">${priceStr}</div>
      <div class="row-info">
        <div class="row-name">${p.nom}</div>
        <div class="row-addr">
          <a href="${p.maps}" target="_blank" rel="noopener" class="row-maps-link" onclick="event.stopPropagation()" aria-label="Itinéraire Google Maps vers ${p.nom}">
            <span>${p.adresse}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
          </a>
        </div>
      </div>
      <div class="row-stats">
        <span class="row-places">${p.places} pl.</span>
        <span class="row-height">${Number(p.hauteur).toFixed(2)} m</span>
      </div>`;

    row.addEventListener('click', () => focusParking(p.id));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusParking(p.id); }
    });
    grid.appendChild(row);

    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nom;
    sel.appendChild(opt);
  });

  // Init carte (Leaflet doit être chargé — le script est en defer donc DOMContentLoaded l'attend)
  if (typeof L !== 'undefined') {
    initMap(parkings);
  } else {
    window.addEventListener('load', () => initMap(parkings));
  }

  setDefaults();
  setMode('all');
  document.getElementById('btnRecenter').addEventListener('click', recenter);
}

// ── MODE (single / all) ───────────────────────────────────────────────────

function setVehicule(v) {
  currentVehicule = v;
  document.getElementById('vehCar').classList.toggle('active', v === 'voiture');
  document.getElementById('vehMoto').classList.toggle('active', v === 'moto');
  document.getElementById('vehCar').setAttribute('aria-checked', v === 'voiture');
  document.getElementById('vehMoto').setAttribute('aria-checked', v === 'moto');

  const sel = document.getElementById('selParking');
  const prev = sel.value;
  sel.innerHTML = '';
  const eligibles = v === 'moto'
    ? allParkings.filter(p => p.moto || p.prixH === 0)
    : allParkings;
  eligibles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.nom + (v === 'moto' && p.moto ? ` — ${p.moto.tarifH.toFixed(2)} CHF/h` : '');
    sel.appendChild(opt);
  });
  if (eligibles.find(p => p.id === prev)) sel.value = prev;

  document.getElementById('result').className = 'result';
  document.getElementById('comparison').className = 'comparison';
  resetMarkers();
}

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
    document.getElementById('simTitle').textContent = 'Calculer pour un parking';
    document.getElementById('simSubtitle').textContent = 'Tarif exact et détail de facturation';
    document.getElementById('simIcon').textContent = '◈';
    btn.textContent = 'Calculer le prix';
    btn.onclick = simuler;
  }
  resetMarkers();
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

  function showErr(msg) { alertEl.innerHTML = `⚠️&nbsp; ${msg}`; alertEl.className = 'alert error visible'; }

  if (!arStr || !dpStr) { showErr('Veuillez renseigner l\'heure d\'arrivée et de départ.'); return; }

  const arrivee = new Date(arStr);
  const depart  = new Date(dpStr);

  if (depart <= arrivee)                         { showErr('L\'heure de départ doit être postérieure à l\'heure d\'arrivée.'); return; }
  if ((depart - arrivee) / 60000 > 7 * 24 * 60) { showErr('La durée maximum simulable est de 7 jours.'); return; }

  btn.disabled = true;
  btn.textContent = 'Calcul en cours…';

  try {
    const res = await fetch('/api/calculer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parkingId: pid, arrivee: arStr, depart: dpStr, vehicule: currentVehicule })
    });
    const data = await res.json();
    if (!res.ok) { showErr(data.erreur || 'Erreur serveur.'); return; }

    const { parking, result } = data;
    const dureeMin = (depart - arrivee) / 60000;

    document.getElementById('resNom').textContent = parking.nom;
    document.getElementById('resPeriode').textContent =
      `${fmtD(arStr)} ${fmtH(arStr)} → ${fmtD(dpStr)} ${fmtH(dpStr)}  ·  ${fmtDuree(dureeMin)}`;
    document.getElementById('resTotal').textContent = fmtChf(result.total);

    const mapsLink = document.getElementById('resMapsLink');
    if (parking.maps) { mapsLink.href = parking.maps; mapsLink.style.display = 'inline-flex'; }
    else { mapsLink.style.display = 'none'; }

    const savEl = document.getElementById('resSavings');
    if (result.economies > 0.005) {
      savEl.textContent = `Économie : CHF ${fmtChf(result.economies)}`;
      savEl.style.display = 'block';
    } else { savEl.style.display = 'none'; }

    const tbody = document.getElementById('breakdownBody');
    tbody.innerHTML = '';
    result.segments.forEach(seg => {
      const dotColor  = seg.isFree ? '#059669' : (seg.isReduced ? '#EA580C' : '#64748B');
      const costClass = seg.isFree ? 'cost-free' : (seg.isReduced ? 'cost-reduced' : 'cost-normal');
      const costText  = seg.isFree ? 'Gratuit' : `CHF ${fmtChf(seg.cout)}`;
      const tarifText = seg.isFree ? '—' : `CHF ${fmtChf(seg.tauxH)}/h`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="seg-name"><span class="seg-dot" style="background:${dotColor}"></span><span>${seg.label}</span></div>
          <div class="seg-time">${fmtD(seg.from)} ${fmtH(seg.from)} – ${fmtH(seg.to)}</div>
        </td>
        <td>${fmtDuree(seg.minutes)}</td>
        <td style="color:var(--ink-3)">${tarifText}</td>
        <td><span class="${costClass}">${costText}</span></td>`;
      tbody.appendChild(tr);
    });

    const footerEl = document.getElementById('resultFooter');
    const noteEl   = document.getElementById('resultNote');
    if (parking.ouvH !== 0 || parking.fermH !== 24) {
      noteEl.textContent = `Ce parking est ouvert de ${parking.ouvH}h à ${parking.fermH}h.`;
      footerEl.style.display = 'flex';
    } else { footerEl.style.display = 'none'; }

    // Mettre à jour le marker pour montrer le tarif calculé
    resetMarkers();
    updateMarkerPrice(parking.id, result.total, { isBest: true });
    setActive(parking.id);
    if (map && parking.coords) {
      map.setView([parking.coords.lat, parking.coords.lng], Math.max(map.getZoom(), 16), { animate: true });
    }

    resultEl.className = 'result';
    requestAnimationFrame(() => { resultEl.className = 'result visible'; });

  } catch (err) { showErr('Impossible de contacter le serveur.'); }
  finally { btn.disabled = false; btn.textContent = 'Calculer le prix'; }
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

  function showErr(msg) { alertEl.innerHTML = `⚠️&nbsp; ${msg}`; alertEl.className = 'alert error visible'; }

  if (!arStr || !dpStr) { showErr('Veuillez renseigner l\'heure d\'arrivée et de départ.'); return; }

  const arrivee = new Date(arStr);
  const depart  = new Date(dpStr);

  if (depart <= arrivee)                         { showErr('L\'heure de départ doit être postérieure à l\'heure d\'arrivée.'); return; }
  if ((depart - arrivee) / 60000 > 7 * 24 * 60) { showErr('La durée maximum simulable est de 7 jours.'); return; }

  btn.disabled = true;
  btn.textContent = 'Calcul en cours…';

  try {
    const eligibles = currentVehicule === 'moto'
      ? allParkings.filter(p => p.moto || p.prixH === 0)
      : allParkings;

    const results = await Promise.all(
      eligibles.map(p =>
        fetch('/api/calculer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parkingId: p.id, arrivee: arStr, depart: dpStr, vehicule: currentVehicule })
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

    // Mettre à jour tous les markers avec les prix calculés
    resetMarkers();
    results.forEach((item, idx) => {
      if (item.result) updateMarkerPrice(item.parking.id, item.result.total, { isBest: idx === 0 });
    });

    results.forEach((item, idx) => {
      const { parking, result } = item;
      const isBest   = idx === 0 && result;
      const isFree   = result && result.total === 0;
      const barPct   = result ? (isFree ? 0 : Math.max((result.total / maxTotal) * 100, 3)) : 100;
      const hasSaving = result && result.economies > 0.005;

      const row = document.createElement('div');
      row.className = 'comp-row' + (isBest ? ' comp-row-best' : '');

      const rankHTML = isBest
        ? `<span class="comp-rank best"><span class="trophy">🏆</span></span>`
        : `<span class="comp-rank">${idx + 1}</span>`;

      const amountHTML = result
        ? `<div class="comp-amount${isFree ? ' is-free' : ''}">CHF ${fmtChf(result.total)}</div>
           ${hasSaving ? `<div class="comp-saving">− CHF ${fmtChf(result.economies)}</div>` : ''}`
        : `<div class="comp-amount" style="color:var(--ink-4)">—</div>`;

      const barClass = isFree ? 'bar-free' : (isBest ? 'bar-best' : '');

      row.innerHTML = `
        ${rankHTML}
        <div class="comp-info">
          <div class="comp-name">${parking.nom}</div>
          <div class="comp-addr">
            <a href="${parking.maps}" target="_blank" rel="noopener" class="row-maps-link" onclick="event.stopPropagation()" aria-label="Itinéraire Google Maps vers ${parking.nom}">
              <span>${parking.adresse}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
            </a>
          </div>
        </div>
        <div class="comp-right">${amountHTML}</div>
        <div class="comp-bar-wrap"><div class="comp-bar ${barClass}" style="width:${barPct}%"></div></div>`;

      row.addEventListener('click', () => focusParking(parking.id));
      list.appendChild(row);
    });

    compEl.className = 'comparison';
    requestAnimationFrame(() => { compEl.className = 'comparison visible'; });

  } catch (err) { showErr('Impossible de contacter le serveur.'); }
  finally { btn.disabled = false; btn.textContent = 'Comparer les parkings'; }
}

// ── INIT ──────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
