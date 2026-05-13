const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DONNÉES ───────────────────────────────────────────────────────────────

const PARKINGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'parkings.json'), 'utf8')
);

// ── MOTEUR DE CALCUL ──────────────────────────────────────────────────────

// Jours fériés officiels du Canton du Valais (Loi sur les jours de repos).
// Fixes : 01-01 · 19-03 St-Joseph · 01-08 Fête nat. · 15-08 Assomption ·
//         01-11 Toussaint · 08-12 Immaculée · 25-12 Noël
// Mobiles (dérivées de Pâques) : Lundi de Pâques, Ascension, Lundi de
//         Pentecôte, Fête-Dieu.
const FERIES_FIXES = ['01-01','03-19','08-01','08-15','11-01','12-08','12-25'];

function pacquesGregorien(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const _feriesMobilesCache = {};
function feriesMobilesVS(year) {
  if (_feriesMobilesCache[year]) return _feriesMobilesCache[year];
  const p = pacquesGregorien(year);
  const offsets = [1, 39, 50, 60]; // Lundi Pâques · Ascension · Lundi Pentecôte · Fête-Dieu
  const set = offsets.map(o => {
    const d = new Date(p);
    d.setDate(d.getDate() + o);
    return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  _feriesMobilesCache[year] = set;
  return set;
}

function estFerie(d) {
  const mmdd = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (FERIES_FIXES.includes(mmdd)) return true;
  return feriesMobilesVS(d.getFullYear()).includes(mmdd);
}

function calculer(parking, arrivee, depart) {
  const totalMin = Math.round((depart - arrivee) / 60000);
  if (totalMin <= 0) return null;

  const rH1      = parking.regles.find(r => r.type === 'h1_plage');
  const rH1Global= parking.regles.find(r => r.type === 'premiere_h_gratuite');
  const rDemi    = parking.regles.find(r => r.type === 'demi_h_gratuite');

  let minutesH1Left     = rH1       ? 60 : 0;
  let minutesH1GlobLeft = rH1Global ? 60 : 0;
  let minutesDemiLeft   = rDemi     ? 30 : 0;

  const minutes = [];

  for (let i = 0; i < totalMin; i++) {
    const t   = new Date(arrivee.getTime() + i * 60000);
    const h   = t.getHours();
    const dow = t.getDay();

    let isFree = false, isReduced = false;
    let label = 'Tarif normal';
    let rate  = parking.prixH / 60;

    if (parking.regles.some(r => r.type === 'gratuit_dim') && dow === 0) {
      isFree = true; label = 'Gratuit — dimanche';
    }
    if (parking.regles.some(r => r.type === 'gratuit_dim_feries')) {
      if (dow === 0)        { isFree = true; label = 'Gratuit — dimanche'; }
      else if (estFerie(t)) { isFree = true; label = 'Gratuit — jour férié'; }
    }
    const rSam = parking.regles.find(r => r.type === 'gratuit_sam_apres');
    if (rSam && dow === 6 && h >= rSam.hApres) {
      isFree = true; label = 'Gratuit — samedi ≥ 12h';
    }
    const rNuit = parking.regles.find(r => r.type === 'tarif_nuit');
    if (rNuit && !isFree && (h >= rNuit.hDeb || h < rNuit.hFin)) {
      rate = (parking.prixH * (1 - rNuit.reduc)) / 60;
      isReduced = true; label = 'Tarif nuit (–50%)';
    }
    // Tarif réduit nuit + dimanches et jours fériés (ex: Cour de Gare)
    const rNuitDF = parking.regles.find(r => r.type === 'tarif_nuit_dim_feries');
    if (rNuitDF && !isFree) {
      const isNuit = h >= rNuitDF.hDeb || h < rNuitDF.hFin;
      if (isNuit || dow === 0 || estFerie(t)) {
        rate = rNuitDF.prixH_reduit / 60;
        isReduced = true;
        label = isNuit ? 'Tarif nuit (CHF 1.00/h)' : (dow === 0 ? 'Tarif dimanche (CHF 1.00/h)' : 'Tarif jour férié (CHF 1.00/h)');
      }
    }
    // Gratuit dans une plage horaire quotidienne (ex: 12h–13h30)
    const rMidi = parking.regles.find(r => r.type === 'gratuit_plage_quotidien');
    let isMidiOrHebdo = false;
    if (rMidi && !isFree) {
      const tMin = h * 60 + t.getMinutes();
      if (tMin >= rMidi.hDeb * 60 && tMin < rMidi.hFin * 60) {
        isFree = true; label = rMidi.label; isMidiOrHebdo = true;
      }
    }
    // Gratuit un jour de la semaine dans une plage horaire (ex: vendredi 17h–24h)
    const rHebdo = parking.regles.find(r => r.type === 'gratuit_plage_hebdo');
    if (rHebdo && !isFree && dow === rHebdo.jour) {
      const tMin = h * 60 + t.getMinutes();
      if (tMin >= rHebdo.hDeb * 60 && tMin < rHebdo.hFin * 60) {
        isFree = true; label = rHebdo.label; isMidiOrHebdo = true;
      }
    }
    if (rH1 && !isFree && minutesH1Left > 0 && h >= rH1.hDeb && h < rH1.hFin) {
      isFree = true; isReduced = false; label = '1ère heure offerte';
      minutesH1Left--;
    }
    // 1ère heure gratuite globale (sans restriction de plage horaire)
    if (rH1Global && !isFree && minutesH1GlobLeft > 0) {
      isFree = true; isReduced = false; label = '1ère heure offerte';
      minutesH1GlobLeft--;
    }
    // Le crédit 1ère heure s'écoule chronologiquement, même pendant une plage gratuite
    if (isMidiOrHebdo) {
      if (minutesH1GlobLeft > 0) minutesH1GlobLeft--;
      if (rH1 && minutesH1Left > 0 && h >= rH1.hDeb && h < rH1.hFin) minutesH1Left--;
    }
    if (rDemi && !isFree && minutesDemiLeft > 0) {
      isFree = true; isReduced = false; label = '30 min offertes';
      minutesDemiLeft--;
    }

    minutes.push({ label, rate: isFree ? 0 : rate, isFree, isReduced, t });
  }

  // Regrouper les minutes consécutives de même label
  const segments = [];
  let i = 0;
  while (i < minutes.length) {
    const cur = minutes[i];
    let j = i + 1;
    while (j < minutes.length && minutes[j].label === cur.label) j++;
    const count = j - i;
    segments.push({
      from:      cur.t,
      to:        new Date(cur.t.getTime() + count * 60000),
      minutes:   count,
      tauxH:     cur.rate * 60,
      cout:      count * cur.rate,
      label:     cur.label,
      isFree:    cur.isFree,
      isReduced: cur.isReduced
    });
    i = j;
  }

  const total      = segments.reduce((s, sg) => s + sg.cout, 0);
  const sansRemise = (totalMin / 60) * parking.prixH;
  const economies  = sansRemise - total;
  return { total, economies, segments };
}

// ── MOTEUR PROGRESSIF (ex: Cour de Gare) ─────────────────────────────────

function coutProgressif(config, totalBillableMin) {
  const round = config.arrondi === 'floor' ? Math.floor : Math.ceil;
  let cost = 0, pos = 0;

  for (const palier of config.paliers) {
    const palierEnd = palier.jusqua !== null ? palier.jusqua : Infinity;
    if (pos >= palierEnd) continue;

    const effectiveEnd = Math.min(totalBillableMin, palierEnd);
    const mins = effectiveEnd - pos;
    if (mins <= 0) continue;

    cost += round(mins / palier.tranche) * palier.prix;
    pos = effectiveEnd;
    if (pos >= totalBillableMin) break;
  }

  return Math.min(cost, config.plafond);
}

function calculerProgressif(parking, arrivee, depart) {
  const tarif = parking.tarification;
  const totalMin = Math.round((depart - arrivee) / 60000);
  if (totalMin <= 0) return null;

  // Plages gratuites issues des règles
  const gratuitQuot  = parking.regles.find(r => r.type === 'gratuit_plage_quotidien');
  const gratuitHebdo = parking.regles.filter(r => r.type === 'gratuit_plage_hebdo');

  const dateKey = (t) =>
    `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;

  // 1. Classer chaque minute en gratuit / jour / nuit (+ jour calendaire)
  const mData = [];
  for (let i = 0; i < totalMin; i++) {
    const t     = new Date(arrivee.getTime() + i * 60000);
    const hFrac = t.getHours() + t.getMinutes() / 60;
    const dow   = t.getDay();
    const dk    = dateKey(t);

    // Plages gratuites prioritaires
    let isFreeP = false, freeLabel = '';
    if (gratuitQuot && hFrac >= gratuitQuot.hDeb && hFrac < gratuitQuot.hFin) {
      isFreeP = true; freeLabel = gratuitQuot.label;
    }
    if (!isFreeP) {
      for (const rh of gratuitHebdo) {
        if (dow === rh.jour && hFrac >= rh.hDeb && hFrac < rh.hFin) {
          isFreeP = true; freeLabel = rh.label; break;
        }
      }
    }

    if (isFreeP) {
      mData.push({ t, periode: 'gratuit', label: freeLabel, dk });
    } else {
      const isNuitH    = hFrac >= tarif.nuit.heures[0] || hFrac < tarif.nuit.heures[1];
      const isDimFerie = tarif.nuit.dimFeries && (dow === 0 || estFerie(t));
      mData.push({ t, periode: (isNuitH || isDimFerie) ? 'nuit' : 'jour', dk });
    }
  }

  // 2. Regrouper les minutes consécutives par (période, jour calendaire)
  //    Le découpage par jour permet de réinitialiser le plafond chaque jour.
  const groupes = [];
  let gi = 0;
  while (gi < totalMin) {
    const cur = mData[gi];
    let gj = gi + 1;
    while (gj < totalMin
           && mData[gj].periode === cur.periode
           && mData[gj].dk === cur.dk
           && (cur.periode !== 'gratuit' || mData[gj].label === cur.label)) gj++;
    groupes.push({ from: cur.t, minutes: gj - gi, periode: cur.periode, label: cur.label, dk: cur.dk });
    gi = gj;
  }

  // 3. Appliquer la période gratuite initiale, puis facturer.
  //    Cumul keyé par "date|période" → plafond réinitialisé chaque jour.
  let freeLeft = tarif.gratuit_initial;
  const cumul  = {};
  const segments = [];

  for (const g of groupes) {
    // Plage gratuite (midi, week-end…) — le crédit de 1ère heure s'écoule
    // chronologiquement même pendant cette plage (règle Ville de Sion).
    if (g.periode === 'gratuit') {
      freeLeft = Math.max(0, freeLeft - g.minutes);
      segments.push({
        from: g.from,
        to:   new Date(g.from.getTime() + g.minutes * 60000),
        minutes: g.minutes, tauxH: 0, cout: 0,
        label: g.label, isFree: true, isReduced: false
      });
      continue;
    }

    const freeInThis = Math.min(freeLeft, g.minutes);
    freeLeft -= freeInThis;
    const billable = g.minutes - freeInThis;

    if (freeInThis > 0) {
      segments.push({
        from: g.from,
        to:   new Date(g.from.getTime() + freeInThis * 60000),
        minutes: freeInThis, tauxH: 0, cout: 0,
        label: '1ère heure offerte', isFree: true, isReduced: false
      });
    }

    if (billable > 0) {
      const config    = tarif[g.periode];
      const key       = `${g.dk}|${g.periode}`;
      const startCum  = cumul[key] || 0;
      cumul[key]      = startCum + billable;
      const costAfter  = coutProgressif(config, cumul[key]);
      const costBefore = coutProgressif(config, startCum);
      const segCost    = Math.round((costAfter - costBefore) * 100) / 100;
      const isNuit     = g.periode === 'nuit';

      segments.push({
        from: new Date(g.from.getTime() + freeInThis * 60000),
        to:   new Date(g.from.getTime() + g.minutes * 60000),
        minutes: billable,
        tauxH:   billable > 0 ? Math.round((segCost / billable) * 60 * 100) / 100 : 0,
        cout:    segCost,
        label:   isNuit ? 'Tarif nuit / dim. & fériés' : 'Tarif jour',
        isFree:  segCost === 0,
        isReduced: isNuit
      });
    }
  }

  const total      = Math.round(segments.reduce((s, sg) => s + sg.cout, 0) * 100) / 100;
  const sansRemise = (totalMin / 60) * parking.prixH;
  const economies  = Math.max(0, sansRemise - total);
  return { total, economies, segments };
}

// ── MOTEUR MOTO (tarif horaire linéaire) ─────────────────────────────────

function calculerMoto(parking, arrivee, depart) {
  if (!parking.moto) return null;
  const totalMin = Math.round((depart - arrivee) / 60000);
  if (totalMin <= 0) return null;

  const tarifH = parking.moto.tarifH;

  // Applique les mêmes règles de gratuité que pour les voitures.
  const rH1       = parking.regles.find(r => r.type === 'h1_plage');
  const rH1Global = parking.regles.find(r => r.type === 'premiere_h_gratuite');
  const rDemi     = parking.regles.find(r => r.type === 'demi_h_gratuite');
  const rSam      = parking.regles.find(r => r.type === 'gratuit_sam_apres');
  const rMidi     = parking.regles.find(r => r.type === 'gratuit_plage_quotidien');
  const rHebdo    = parking.regles.find(r => r.type === 'gratuit_plage_hebdo');

  let minutesH1Left     = rH1       ? 60 : 0;
  let minutesH1GlobLeft = rH1Global ? 60 : 0;
  let minutesDemiLeft   = rDemi     ? 30 : 0;

  const minutes = [];
  for (let i = 0; i < totalMin; i++) {
    const t   = new Date(arrivee.getTime() + i * 60000);
    const h   = t.getHours();
    const dow = t.getDay();

    let isFree = false, label = 'Tarif moto';
    let isMidiOrHebdo = false;

    if (parking.regles.some(r => r.type === 'gratuit_dim') && dow === 0) {
      isFree = true; label = 'Gratuit — dimanche';
    }
    if (parking.regles.some(r => r.type === 'gratuit_dim_feries')) {
      if (dow === 0)        { isFree = true; label = 'Gratuit — dimanche'; }
      else if (estFerie(t)) { isFree = true; label = 'Gratuit — jour férié'; }
    }
    if (rSam && dow === 6 && h >= rSam.hApres) {
      isFree = true; label = 'Gratuit — samedi ≥ 12h';
    }
    if (rMidi && !isFree) {
      const tMin = h * 60 + t.getMinutes();
      if (tMin >= rMidi.hDeb * 60 && tMin < rMidi.hFin * 60) {
        isFree = true; label = rMidi.label; isMidiOrHebdo = true;
      }
    }
    if (rHebdo && !isFree && dow === rHebdo.jour) {
      const tMin = h * 60 + t.getMinutes();
      if (tMin >= rHebdo.hDeb * 60 && tMin < rHebdo.hFin * 60) {
        isFree = true; label = rHebdo.label; isMidiOrHebdo = true;
      }
    }
    if (rH1 && !isFree && minutesH1Left > 0 && h >= rH1.hDeb && h < rH1.hFin) {
      isFree = true; label = '1ère heure offerte';
      minutesH1Left--;
    }
    if (rH1Global && !isFree && minutesH1GlobLeft > 0) {
      isFree = true; label = '1ère heure offerte';
      minutesH1GlobLeft--;
    }
    if (isMidiOrHebdo) {
      if (minutesH1GlobLeft > 0) minutesH1GlobLeft--;
      if (rH1 && minutesH1Left > 0 && h >= rH1.hDeb && h < rH1.hFin) minutesH1Left--;
    }
    if (rDemi && !isFree && minutesDemiLeft > 0) {
      isFree = true; label = '30 min offertes';
      minutesDemiLeft--;
    }

    minutes.push({ t, label, isFree });
  }

  // Facturation moto : tranche d'1h entamée sur les minutes non gratuites
  const billableMin = minutes.filter(m => !m.isFree).length;
  const heures      = Math.ceil(billableMin / 60);
  const total       = Math.round(tarifH * heures * 100) / 100;

  // Économies = ce qu'on aurait payé sans les règles de gratuité
  const sansRemise = Math.ceil(totalMin / 60) * tarifH;
  const economies  = Math.max(0, Math.round((sansRemise - total) * 100) / 100);

  // Segments : grouper les minutes gratuites consécutives par label + un seul
  // segment récapitulatif pour la totalité des minutes facturées.
  const segments = [];
  let i = 0, firstBillT = null, lastBillT = null;
  while (i < minutes.length) {
    const cur = minutes[i];
    let j = i + 1;
    while (j < minutes.length && minutes[j].isFree === cur.isFree && minutes[j].label === cur.label) j++;
    const count = j - i;
    if (cur.isFree) {
      segments.push({
        from:    cur.t,
        to:      new Date(cur.t.getTime() + count * 60000),
        minutes: count,
        tauxH:   0,
        cout:    0,
        label:   cur.label,
        isFree:  true,
        isReduced: false
      });
    } else {
      if (!firstBillT) firstBillT = cur.t;
      lastBillT = new Date(cur.t.getTime() + count * 60000);
    }
    i = j;
  }
  if (billableMin > 0) {
    segments.push({
      from:    firstBillT,
      to:      lastBillT,
      minutes: billableMin,
      tauxH:   tarifH,
      cout:    total,
      label:   `Tarif moto (${heures}h × ${tarifH.toFixed(2)} CHF)`,
      isFree:  false,
      isReduced: false
    });
  }

  return { total, economies, segments };
}

// ── ROUTES API ────────────────────────────────────────────────────────────

app.get('/api/parkings', (req, res) => {
  res.json(PARKINGS);
});

app.post('/api/calculer', (req, res) => {
  const { parkingId, arrivee, depart, vehicule } = req.body;

  const parking = PARKINGS.find(p => p.id === parkingId);
  if (!parking) {
    return res.status(400).json({ erreur: 'Parking introuvable.' });
  }

  const dtArrivee = new Date(arrivee);
  const dtDepart  = new Date(depart);

  if (isNaN(dtArrivee) || isNaN(dtDepart)) {
    return res.status(400).json({ erreur: 'Dates invalides.' });
  }
  if (dtDepart <= dtArrivee) {
    return res.status(400).json({ erreur: 'Le départ doit être après l\'arrivée.' });
  }
  const dureeMin = (dtDepart - dtArrivee) / 60000;
  if (dureeMin > 7 * 24 * 60) {
    return res.status(400).json({ erreur: 'La durée maximum simulable est de 7 jours.' });
  }

  if (vehicule === 'moto') {
    if (!parking.moto) {
      return res.status(400).json({ erreur: 'Ce parking n\'accueille pas les motos.' });
    }
    return res.json({ parking, result: calculerMoto(parking, dtArrivee, dtDepart) });
  }

  const result = parking.tarification
    ? calculerProgressif(parking, dtArrivee, dtDepart)
    : calculer(parking, dtArrivee, dtDepart);
  res.json({ parking, result });
});

// ── DÉMARRAGE ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅  Parkings Sion → http://localhost:${PORT}`);
});
