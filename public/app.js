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
// Notation suisse : "2.50.-" pour un montant, "1.50/h" pour un tarif horaire.
const fmtMnt   = v => v === 0 ? 'Gratuit' : `${fmtChf(v)}.-`;
const fmtTarif = v => v === 0 ? 'Gratuit' : `${fmtChf(v)}/h`;
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
let allVilles = [];
let currentVilleId = null;
let map = null;
let markers = {};       // id -> Leaflet marker
let markerEls = {};     // id -> HTMLElement du marker (pour update classes)
let activeId = null;
let lightTiles = null, darkTiles = null;
let showAllCompare = false;   // toggle "voir tous les parkings" en mode compare
const COMPARE_TOP_N = 10;     // cap d'affichage du compare-all pour grosses villes

function currentVille() {
  return allVilles.find(v => v.id === currentVilleId) || allVilles[0];
}

// ── ÉCUS CANTONAUX (SVG) ──────────────────────────────────────────────────

const SHIELD_CLIP = 'M12 .5 L23.5 4 L23.5 18 C23.5 25 12 29.5 12 29.5 C12 29.5 .5 25 .5 18 L.5 4 Z';

function shieldSVG(canton) {
  if (canton === 'VS') {
    return `<svg viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg" aria-label="Armoiries du Valais" role="img">
      <defs>
        <clipPath id="vs-clip"><path d="${SHIELD_CLIP}"/></clipPath>
        <polygon id="s5" points="0,-1.35 .32,-.42 1.28,-.42 .48,.16 .79,1.09 0,.5 -.79,1.09 -.48,.16 -1.28,-.42 -.32,-.42"/>
      </defs>
      <g clip-path="url(#vs-clip)">
        <rect x="0" y="0" width="12" height="30" fill="#FFFFFF"/>
        <rect x="12" y="0" width="12" height="30" fill="#CE1126"/>
        <use href="#s5" x="12" y="6.5" fill="#CE1126"/>
        <use href="#s5" x="7.5" y="10.5" fill="#CE1126"/><use href="#s5" x="16.5" y="10.5" fill="#FFFFFF"/>
        <use href="#s5" x="4.5" y="14.5" fill="#CE1126"/><use href="#s5" x="12" y="14.5" fill="#FFFFFF"/><use href="#s5" x="19.5" y="14.5" fill="#FFFFFF"/>
        <use href="#s5" x="3.5" y="18.5" fill="#CE1126"/><use href="#s5" x="8.5" y="18.5" fill="#CE1126"/><use href="#s5" x="15.5" y="18.5" fill="#FFFFFF"/><use href="#s5" x="20.5" y="18.5" fill="#FFFFFF"/>
        <use href="#s5" x="6" y="22.5" fill="#CE1126"/><use href="#s5" x="12" y="22.5" fill="#FFFFFF"/><use href="#s5" x="18" y="22.5" fill="#FFFFFF"/>
      </g>
      <path d="${SHIELD_CLIP}" stroke="rgba(0,0,0,.25)" stroke-width=".6" fill="none"/>
    </svg>`;
  }
  if (canton === 'GE') {
    // Armoiries genevoises simplifiées : mi-parti or (gauche) / gueules (droite)
    // avec clé et demi-aigle stylisés
    return `<svg viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg" aria-label="Armoiries de Genève" role="img">
      <defs><clipPath id="ge-clip"><path d="${SHIELD_CLIP}"/></clipPath></defs>
      <g clip-path="url(#ge-clip)">
        <rect x="0" y="0" width="12" height="30" fill="#FBBF24"/>
        <rect x="12" y="0" width="12" height="30" fill="#DC2626"/>
        <!-- Demi-aigle (gauche, sur or) -->
        <path d="M7 8 L9 7 L10.5 9 L11 12 L11 16 L10 18 L8.5 18 L7.5 16 L7 13 Z" fill="#1F2937"/>
        <circle cx="9" cy="8.5" r="0.7" fill="#FBBF24"/>
        <!-- Clé (droite, sur gueules) -->
        <circle cx="15.5" cy="9" r="1.8" fill="none" stroke="#FBBF24" stroke-width="1"/>
        <line x1="15.5" y1="11" x2="15.5" y2="20" stroke="#FBBF24" stroke-width="1.2"/>
        <line x1="15.5" y1="16" x2="17" y2="16" stroke="#FBBF24" stroke-width="1.2"/>
        <line x1="15.5" y1="18" x2="17" y2="18" stroke="#FBBF24" stroke-width="1.2"/>
      </g>
      <path d="${SHIELD_CLIP}" stroke="rgba(0,0,0,.25)" stroke-width=".6" fill="none"/>
    </svg>`;
  }
  // Fallback générique
  return `<svg viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="${SHIELD_CLIP}" fill="var(--accent)" opacity="0.85"/>
  </svg>`;
}

// ── CARTE ─────────────────────────────────────────────────────────────────

function initMap(parkings, center, zoom) {
  map = L.map('map', {
    center,
    zoom,
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
  darkTiles  = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', tileOpts);
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
  const isApprox = !!p.tarifApproximatif;
  const priceStr = isApprox ? '⚠️' : fmtTarif(p.prixH);
  const cls = isApprox ? 'price-approx' : priceClass(p.prixH);

  const icon = L.divIcon({
    className: '',
    html: `<div class="parking-marker ${cls}" data-id="${p.id}">${priceStr}</div>`,
    iconSize: null,
    iconAnchor: [25, 40]
  });

  const m = L.marker([p.coords.lat, p.coords.lng], { icon, riseOnHover: true })
    .addTo(map)
    .bindTooltip(p.nom, { direction: 'top', offset: [0, -36], opacity: 0.95 });

  m.on('click', () => focusParking(p.id, { pan: false, scroll: true }));

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
  el.textContent = fmtMnt(chf);
}

function resetMarkers() {
  allParkings.forEach(p => {
    const el = markerEls[p.id];
    if (!el) return;
    el.classList.remove('price-free', 'price-low', 'price-mid', 'price-high', 'price-approx', 'is-best');
    if (p.tarifApproximatif) {
      el.classList.add('price-approx');
      el.textContent = '⚠️';
    } else {
      el.classList.add(priceClass(p.prixH));
      el.textContent = fmtTarif(p.prixH);
    }
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

function scrollPanelToParking(id) {
  // Scroll dans le bandeau de gauche jusqu'à la row du parking sélectionné.
  // Si on est en mode compare-all avec une comp-entry, on scrolle aussi vers elle.
  const targets = [
    document.querySelector(`.parking-row[data-id="${id}"]`),
    document.querySelector(`.comp-entry[data-id="${id}"]`)
  ].filter(el => el && el.offsetParent !== null);
  if (targets.length === 0) return;
  // Sur mobile, s'assurer que le panneau n'est pas collapsed
  const panel = document.getElementById('panel');
  if (panel && panel.classList.contains('panel--collapsed') && window.innerWidth <= 768) {
    panel.classList.remove('panel--collapsed');
    panel.classList.add('panel--half');
  }
  targets[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function focusParking(id, { pan = true, scroll = false } = {}) {
  const p = allParkings.find(x => x.id === id);
  if (!p) return;
  setActive(id);
  if (pan && p.coords) map.setView([p.coords.lat, p.coords.lng], Math.max(map.getZoom(), 16), { animate: true });
  const sel = document.getElementById('selParking');
  if (sel && [...sel.options].some(o => o.value === id)) sel.value = id;
  if (scroll) scrollPanelToParking(id);
}

function recenter() {
  if (!map) return;
  const group = L.featureGroup(Object.values(markers));
  map.fitBounds(group.getBounds(), { padding: [60, 60], maxZoom: 16, animate: true });
  setActive(null);
}

// ── RENDU DES ROWS ────────────────────────────────────────────────────────

function renderRow(p) {
  const isApprox = !!p.tarifApproximatif;
  const isFree   = !isApprox && p.prixH === 0;
  const priceStr = isApprox ? '?' : fmtTarif(p.prixH);
  const cls = isApprox ? 'price-approx' : priceClass(p.prixH);

  const row = document.createElement('div');
  row.className = 'parking-row' + (isApprox ? ' is-approx' : '');
  row.dataset.id = p.id;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `Voir ${p.nom} sur la carte`);

  const places = p.places ?? p.capacite ?? '?';
  const hauteur = p.hauteur != null
    ? `<span class="row-height">${Number(p.hauteur).toFixed(2)} m</span>`
    : '';
  const approxBadge = isApprox
    ? `<span class="row-approx-badge" title="Tarif complexe — voir sur place">⚠️ Tarif complexe</span>`
    : '';

  row.innerHTML = `
    <div class="row-price ${cls}">${priceStr}</div>
    <div class="row-info">
      <div class="row-name">${p.nom}${approxBadge}</div>
      <div class="row-addr">
        <a href="${p.maps}" target="_blank" rel="noopener" class="row-maps-link" onclick="event.stopPropagation()" aria-label="Itinéraire Google Maps vers ${p.nom}">
          <span>${p.adresse}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
        </a>
      </div>
    </div>
    <div class="row-stats">
      <span class="row-places">${places} pl.</span>
      ${hauteur}
    </div>`;

  row.addEventListener('click', () => focusParking(p.id));
  row.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusParking(p.id); }
  });
  return row;
}

function updateBrand() {
  const v = currentVille();
  if (!v) return;
  document.title = `Parkings ${v.nom} — Carte & Simulateur`;
  const shieldEl = document.getElementById('brandShield');
  if (shieldEl) shieldEl.innerHTML = shieldSVG(v.canton);
  const sub = document.getElementById('brandSub');
  if (sub) sub.textContent = `Canton ${v.canton === 'VS' ? 'du Valais' : 'de Genève'}`;
  renderVillePills();
}

function clearMap() {
  if (!map) return;
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  markerEls = {};
}

async function loadVille(villeId, { firstLoad = false } = {}) {
  const v = allVilles.find(x => x.id === villeId) || allVilles[0];
  if (!v) return;
  currentVilleId = v.id;
  try { localStorage.setItem('ville', v.id); } catch (_) {}

  const res = await fetch(`/api/parkings?ville=${v.id}`);
  const parkings = await res.json();
  allParkings = parkings;

  // Rebuild grid & select
  const grid = document.getElementById('parkingGrid');
  const sel  = document.getElementById('selParking');
  grid.innerHTML = '';
  sel.innerHTML = '';

  parkings.forEach(p => {
    grid.appendChild(renderRow(p));
    // Seuls les parkings avec tarification fiable peuvent être simulés
    if (!p.tarifApproximatif) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nom;
      sel.appendChild(opt);
    }
  });

  // Section label
  const lbl = document.getElementById('sectionLabelText');
  if (lbl) lbl.textContent = `Les ${parkings.length} parkings`;

  // Carte : init si premier chargement, sinon clear + replace
  if (firstLoad || !map) {
    if (typeof L !== 'undefined') {
      initMap(parkings, [v.center.lat, v.center.lng], v.zoom);
    } else {
      window.addEventListener('load', () => initMap(parkings, [v.center.lat, v.center.lng], v.zoom));
    }
  } else {
    clearMap();
    parkings.forEach(p => addMarker(p));
    if (Object.values(markers).length > 0) {
      const group = L.featureGroup(Object.values(markers));
      map.fitBounds(group.getBounds(), { padding: [60, 60], maxZoom: 16, animate: true });
    } else {
      map.setView([v.center.lat, v.center.lng], v.zoom);
    }
  }

  // Reset UI state
  showAllCompare = false;
  document.getElementById('result').className = 'result';
  document.getElementById('comparison').className = 'comparison';
  document.getElementById('alertError').className = 'alert error';

  updateBrand();
}

function renderVillePills() {
  const container = document.getElementById('villePills');
  if (!container) return;
  container.innerHTML = '';
  allVilles.forEach(v => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ville-pill' + (v.id === currentVilleId ? ' active' : '');
    btn.dataset.ville = v.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(v.id === currentVilleId));
    btn.innerHTML = `${v.nom}<span class="ville-pill-count">${v.count}</span>`;
    btn.addEventListener('click', () => {
      if (v.id !== currentVilleId) loadVille(v.id);
    });
    container.appendChild(btn);
  });
}

async function init() {
  // 1. Charger les villes
  const villesRes = await fetch('/api/villes');
  allVilles = await villesRes.json();

  // 2. Déterminer ville par défaut : URL > localStorage > première
  const urlVille = new URLSearchParams(location.search).get('ville');
  const savedVille = (() => { try { return localStorage.getItem('ville'); } catch (_) { return null; } })();
  const validIds = new Set(allVilles.map(v => v.id));
  const initialVille = [urlVille, savedVille, allVilles[0]?.id].find(id => id && validIds.has(id));

  // 3. Charger la ville initiale (carte + données) — renderVillePills() est appelé via loadVille → updateBrand
  await loadVille(initialVille, { firstLoad: true });

  setDefaults();
  setMode('all');
  document.getElementById('btnRecenter').addEventListener('click', recenter);

  initBottomSheet();
}

// ── BOTTOM SHEET (mobile) ────────────────────────────────────────────────
// 3 snap points : collapsed (58px) / half (45vh) / full (75vh)
// Drag sur la grip avec snap velocity-aware, persistance localStorage
function initBottomSheet() {
  const grip = document.getElementById('panelGrip');
  const panel = document.getElementById('panel');
  if (!grip || !panel) return;

  const isMobile = () => window.innerWidth <= 768;
  const snapCollapsed = 58;
  const snapHalf = () => window.innerHeight * 0.45;
  const snapFull = () => window.innerHeight * (window.innerWidth <= 400 ? 0.80 : 0.75);

  let state = 'full';
  let dragging = false, startY = 0, startH = 0, moveTotal = 0;
  let lastY = 0, lastT = 0, vY = 0;

  const LABELS = {
    collapsed: 'Ouvrir le panneau',
    half:      'Agrandir le panneau',
    full:      'Replier le panneau'
  };
  const CYCLE_NEXT = { collapsed: 'half', half: 'full', full: 'collapsed' };

  function apply(next) {
    if (!['collapsed', 'half', 'full'].includes(next)) next = 'full';
    state = next;
    if (isMobile()) {
      try { localStorage.setItem('panelState', state); } catch (_) {}
    }
    panel.classList.remove('panel--collapsed', 'panel--half', 'panel--full');
    panel.style.maxHeight = '';
    panel.classList.add(`panel--${state}`);
    grip.setAttribute('aria-expanded', String(state !== 'collapsed'));
    grip.setAttribute('aria-label', LABELS[state]);
    if (map) setTimeout(() => map.invalidateSize(), 380);
  }

  function onDown(e) {
    if (!isMobile()) return;
    dragging = true;
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    moveTotal = 0;
    lastY = e.clientY;
    lastT = performance.now();
    vY = 0;
    panel.style.transition = 'none';
    panel.classList.remove('panel--collapsed', 'panel--half', 'panel--full');
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const dy = startY - e.clientY;
    const h = Math.max(snapCollapsed, Math.min(window.innerHeight * 0.95, startH + dy));
    panel.style.maxHeight = `${h}px`;
    moveTotal += Math.abs(e.clientY - lastY);
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) vY = (lastY - e.clientY) / dt;  // px/ms, >0 = drag up
    lastY = e.clientY;
    lastT = now;
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';

    if (moveTotal < 6) {
      // tap → cycle d'état
      apply(CYCLE_NEXT[state] || 'full');
      return;
    }

    const h = panel.getBoundingClientRect().height;
    const snaps = { collapsed: snapCollapsed, half: snapHalf(), full: snapFull() };
    let target;
    if (Math.abs(vY) > 0.4) {
      if (vY > 0) target = h > snaps.half ? 'full' : 'half';
      else        target = h < snaps.half ? 'collapsed' : 'half';
    } else {
      target = Object.keys(snaps).reduce((a, b) =>
        Math.abs(h - snaps[a]) < Math.abs(h - snaps[b]) ? a : b);
    }
    apply(target);
  }

  grip.addEventListener('pointerdown', onDown);
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onUp);
  grip.addEventListener('click', e => e.preventDefault());  // suppr synthetic click
  grip.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      apply(CYCLE_NEXT[state] || 'full');
    }
  });

  // Restore state (mobile only)
  if (isMobile()) {
    const saved = (() => { try { return localStorage.getItem('panelState'); } catch (_) { return null; }})();
    apply(['collapsed', 'half', 'full'].includes(saved) ? saved : 'full');
  } else {
    apply('full');
  }
}

// ── MODE (single / all) ───────────────────────────────────────────────────

// Un parking est "simulable" si non-approximatif et compatible avec le véhicule choisi
function isSimulable(p, vehicule) {
  if (p.tarifApproximatif) return false;
  if (vehicule === 'moto') return !!p.moto;
  // voiture : exclure les parkings explicitement typés moto (Genève)
  return !p.typeVehicule || p.typeVehicule !== 'moto';
}

// Un parking est "visible" dans la liste/carte (plus permissif que simulable)
function isVisible(p, vehicule) {
  if (vehicule === 'moto') return !!p.moto || p.typeVehicule === 'moto';
  return !p.typeVehicule || p.typeVehicule !== 'moto';
}

function setVehicule(v) {
  currentVehicule = v;
  document.getElementById('vehCar').classList.toggle('active', v === 'voiture');
  document.getElementById('vehMoto').classList.toggle('active', v === 'moto');
  document.getElementById('vehCar').setAttribute('aria-checked', v === 'voiture');
  document.getElementById('vehMoto').setAttribute('aria-checked', v === 'moto');

  const sel = document.getElementById('selParking');
  const prev = sel.value;
  sel.innerHTML = '';
  // Le select ne propose que les parkings simulables (= calcul possible)
  const eligibles = allParkings.filter(p => isSimulable(p, v));
  eligibles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.nom;
    sel.appendChild(opt);
  });
  if (eligibles.find(p => p.id === prev)) sel.value = prev;

  // Affichage des rows et markers (plus permissif : on garde les visibles non-simulables aussi)
  const visibleIds = new Set(allParkings.filter(p => isVisible(p, v)).map(p => p.id));

  // Filtrer les rows du panel et les markers sur la carte
  allParkings.forEach(p => {
    const show = visibleIds.has(p.id);
    const row = document.querySelector(`.parking-row[data-id="${p.id}"]`);
    if (row) row.style.display = show ? '' : 'none';
    const m = markers[p.id];
    if (m) {
      const el = m.getElement();
      if (el) el.style.display = show ? '' : 'none';
    }
  });

  // Label dynamique de la section liste
  const lbl = document.getElementById('sectionLabelText');
  if (lbl) {
    lbl.textContent = v === 'moto'
      ? `${visibleIds.size} parking${visibleIds.size > 1 ? 's' : ''} moto`
      : `Les ${visibleIds.size} parkings`;
  }

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
    document.getElementById('resTotal').textContent = result.total === 0 ? 'Gratuit' : `${fmtChf(result.total)}.-`;

    const mapsLink = document.getElementById('resMapsLink');
    if (parking.maps) { mapsLink.href = parking.maps; mapsLink.style.display = 'inline-flex'; }
    else { mapsLink.style.display = 'none'; }

    const savEl = document.getElementById('resSavings');
    if (result.economies > 0.005) {
      savEl.textContent = `Économie : ${fmtChf(result.economies)}.-`;
      savEl.style.display = 'block';
    } else { savEl.style.display = 'none'; }

    const tbody = document.getElementById('breakdownBody');
    tbody.innerHTML = '';
    result.segments.forEach(seg => {
      const dotColor  = seg.isFree ? '#059669' : (seg.isReduced ? '#EA580C' : '#64748B');
      const costClass = seg.isFree ? 'cost-free' : (seg.isReduced ? 'cost-reduced' : 'cost-normal');
      const costText  = seg.isFree ? 'Gratuit' : `${fmtChf(seg.cout)}.-`;
      const tarifText = seg.isFree ? '—' : `${fmtChf(seg.tauxH)}/h`;

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

function renderCompDetail(parking, result, arStr, dpStr) {
  const dureeMin = (new Date(dpStr) - new Date(arStr)) / 60000;
  const segRows = result.segments.map(seg => {
    const dotColor  = seg.isFree ? '#059669' : (seg.isReduced ? '#EA580C' : '#64748B');
    const costClass = seg.isFree ? 'cost-free' : (seg.isReduced ? 'cost-reduced' : 'cost-normal');
    const costText  = seg.isFree ? 'Gratuit' : `CHF ${fmtChf(seg.cout)}`;
    const tarifText = seg.isFree ? '—' : `CHF ${fmtChf(seg.tauxH)}/h`;
    return `
      <tr>
        <td>
          <div class="seg-name"><span class="seg-dot" style="background:${dotColor}"></span><span>${seg.label}</span></div>
          <div class="seg-time">${fmtD(seg.from)} ${fmtH(seg.from)} – ${fmtH(seg.to)}</div>
        </td>
        <td>${fmtDuree(seg.minutes)}</td>
        <td style="color:var(--ink-3)">${tarifText}</td>
        <td><span class="${costClass}">${costText}</span></td>
      </tr>`;
  }).join('');

  const mapsLink = parking.maps
    ? `<a class="res-maps-link" href="${parking.maps}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
         <span>Itinéraire Google Maps</span>
       </a>`
    : '';

  const footer = (parking.ouvH !== 0 || parking.fermH !== 24)
    ? `<div class="comp-detail-footer">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
         <span>Ouvert de ${parking.ouvH}h à ${parking.fermH}h</span>
       </div>`
    : '';

  return `
    <div class="comp-detail-header">
      <div class="comp-detail-period">${fmtD(arStr)} ${fmtH(arStr)} → ${fmtD(dpStr)} ${fmtH(dpStr)} · ${fmtDuree(dureeMin)}</div>
      ${mapsLink}
    </div>
    <div class="breakdown">
      <div class="breakdown-head">Détail de facturation</div>
      <table class="breakdown-table">
        <thead>
          <tr><th>Période</th><th>Durée</th><th>Tarif</th><th>Montant</th></tr>
        </thead>
        <tbody>${segRows}</tbody>
      </table>
    </div>
    ${footer}
  `;
}

function toggleCompExpand(entry) {
  const list = entry.parentElement;
  const wasOpen = entry.classList.contains('is-expanded');
  // Fermer toutes les autres
  list.querySelectorAll('.comp-entry.is-expanded').forEach(e => {
    e.classList.remove('is-expanded');
    const d = e.querySelector('.comp-detail');
    if (d) d.hidden = true;
  });
  if (!wasOpen) {
    const detail = entry.querySelector('.comp-detail');
    if (detail) {
      detail.hidden = false;
      entry.classList.add('is-expanded');
    }
  }
}

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
    // Seuls les parkings simulables (non-approximatifs, compatibles véhicule)
    const eligibles = allParkings.filter(p => isSimulable(p, currentVehicule));

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
    const totalAll = results.length;
    const showResults = (totalAll > COMPARE_TOP_N && !showAllCompare)
      ? results.slice(0, COMPARE_TOP_N)
      : results;
    const truncated = showResults.length < totalAll;

    document.getElementById('compPeriode').innerHTML =
      `<strong>${fmtD(arStr)} ${fmtH(arStr)}</strong> → <strong>${fmtD(dpStr)} ${fmtH(dpStr)}</strong>&ensp;·&ensp;${fmtDuree(dureeMin)}`;

    const list = document.getElementById('compList');
    list.innerHTML = '';

    // Mettre à jour tous les markers avec les prix calculés
    resetMarkers();
    results.forEach((item, idx) => {
      if (item.result) updateMarkerPrice(item.parking.id, item.result.total, { isBest: idx === 0 });
    });

    showResults.forEach((item, idx) => {
      const { parking, result } = item;
      const isBest   = idx === 0 && result;
      const isFree   = result && result.total === 0;
      const barPct   = result ? (isFree ? 0 : Math.max((result.total / maxTotal) * 100, 3)) : 100;
      const hasSaving = result && result.economies > 0.005;

      const entry = document.createElement('article');
      entry.className = 'comp-entry';
      entry.dataset.id = parking.id;

      const row = document.createElement('div');
      row.className = 'comp-row' + (isBest ? ' comp-row-best' : '');

      const rankHTML = isBest
        ? `<span class="comp-rank best"><span class="trophy">🏆</span></span>`
        : `<span class="comp-rank">${idx + 1}</span>`;

      const amountHTML = result
        ? `<div class="comp-amount${isFree ? ' is-free' : ''}">${isFree ? 'Gratuit' : fmtChf(result.total) + '.-'}</div>`
        : `<div class="comp-amount" style="color:var(--ink-4)">—</div>`;

      const barClass = isFree ? 'bar-free' : (isBest ? 'bar-best' : '');
      const canExpand = !!result;
      const chevron = canExpand
        ? `<svg class="comp-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`
        : '';

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
        <div class="comp-right">${amountHTML}${chevron}</div>
        <div class="comp-bar-wrap"><div class="comp-bar ${barClass}" style="width:${barPct}%"></div></div>`;

      entry.appendChild(row);

      if (canExpand) {
        const detail = document.createElement('div');
        detail.className = 'comp-detail';
        detail.hidden = true;
        detail.innerHTML = renderCompDetail(parking, result, arStr, dpStr);
        entry.appendChild(detail);
      }

      row.addEventListener('click', () => {
        focusParking(parking.id);
        toggleCompExpand(entry);
      });

      list.appendChild(entry);
    });

    // Bouton "voir tous les parkings" si la liste est tronquée
    if (truncated) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'comp-show-all';
      moreBtn.type = 'button';
      moreBtn.textContent = `Voir les ${totalAll - showResults.length} autres parkings`;
      moreBtn.addEventListener('click', () => {
        showAllCompare = true;
        comparer();
      });
      list.appendChild(moreBtn);
    }

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
