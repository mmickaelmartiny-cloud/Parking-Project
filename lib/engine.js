// Moteur de calcul tarifaire — extrait de server.js pour permettre tests unitaires
// et architecture multi-villes (Sion/Genève).

// ── Jours fériés par canton ──────────────────────────────────────────────
//
// VS (Valais) — Loi cantonale sur les jours de repos :
//   Fixes : 01-01 · 19-03 St-Joseph · 01-08 Fête nat. · 15-08 Assomption ·
//           01-11 Toussaint · 08-12 Immaculée · 25-12 Noël
//   Pâques + : 1 Lundi Pâques · 39 Ascension · 50 Lundi Pentecôte · 60 Fête-Dieu
//
// GE (Genève) — RS/GE A 1 12, loi sur les jours fériés :
//   Fixes : 01-01 · 01-08 Fête nat. · 25-12 Noël · 31-12 Restauration
//   Pâques + : -2 Vendredi Saint · 1 Lundi Pâques · 39 Ascension · 50 Lundi Pentecôte
//   Spécifique : Jeûne genevois = jeudi suivant le 1er dimanche de septembre
const CALENDARS = {
  VS: {
    fixes:   ['01-01','03-19','08-01','08-15','11-01','12-08','12-25'],
    paquesOffsets: [1, 39, 50, 60],
    extras:  () => []
  },
  GE: {
    fixes:   ['01-01','08-01','12-25','12-31'],
    paquesOffsets: [-2, 1, 39, 50],
    extras:  (year) => [jeuneGenevoisMMDD(year)]
  }
};

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

function mmdd(d) {
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Jeûne genevois : jeudi après le premier dimanche de septembre
function jeuneGenevoisMMDD(year) {
  for (let day = 1; day <= 7; day++) {
    const d = new Date(year, 8, day); // mois 8 = septembre
    if (d.getDay() === 0) {
      const jeudi = new Date(d);
      jeudi.setDate(jeudi.getDate() + 4);
      return mmdd(jeudi);
    }
  }
  return null;
}

const _feriesCache = {};
function feriesMobiles(canton, year) {
  const key = `${canton}|${year}`;
  if (_feriesCache[key]) return _feriesCache[key];
  const cal = CALENDARS[canton] || CALENDARS.VS;
  const p = pacquesGregorien(year);
  const set = cal.paquesOffsets.map(o => {
    const d = new Date(p);
    d.setDate(d.getDate() + o);
    return mmdd(d);
  });
  for (const extra of cal.extras(year)) if (extra) set.push(extra);
  _feriesCache[key] = set;
  return set;
}

function estFerie(d, canton = 'VS') {
  const cal = CALENDARS[canton] || CALENDARS.VS;
  const key = mmdd(d);
  if (cal.fixes.includes(key)) return true;
  return feriesMobiles(canton, d.getFullYear()).includes(key);
}

function feriesCantonOf(parking) {
  return parking.feriesCanton || 'VS';
}

function calculer(parking, arrivee, depart) {
  const totalMin = Math.round((depart - arrivee) / 60000);
  if (totalMin <= 0) return null;

  const canton   = feriesCantonOf(parking);
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
      else if (estFerie(t, canton)) { isFree = true; label = 'Gratuit — jour férié'; }
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
    const rNuitDF = parking.regles.find(r => r.type === 'tarif_nuit_dim_feries');
    if (rNuitDF && !isFree) {
      const isNuit = h >= rNuitDF.hDeb || h < rNuitDF.hFin;
      if (isNuit || dow === 0 || estFerie(t, canton)) {
        rate = rNuitDF.prixH_reduit / 60;
        isReduced = true;
        label = isNuit ? 'Tarif nuit (CHF 1.00/h)' : (dow === 0 ? 'Tarif dimanche (CHF 1.00/h)' : 'Tarif jour férié (CHF 1.00/h)');
      }
    }
    const rMidi = parking.regles.find(r => r.type === 'gratuit_plage_quotidien');
    let isMidiOrHebdo = false;
    if (rMidi && !isFree) {
      const tMin = h * 60 + t.getMinutes();
      if (tMin >= rMidi.hDeb * 60 && tMin < rMidi.hFin * 60) {
        isFree = true; label = rMidi.label; isMidiOrHebdo = true;
      }
    }
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
    if (rH1Global && !isFree && minutesH1GlobLeft > 0) {
      isFree = true; isReduced = false; label = '1ère heure offerte';
      minutesH1GlobLeft--;
    }
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

  const canton       = feriesCantonOf(parking);
  const gratuitQuot  = parking.regles.find(r => r.type === 'gratuit_plage_quotidien');
  const gratuitHebdo = parking.regles.filter(r => r.type === 'gratuit_plage_hebdo');

  const dateKey = (t) =>
    `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;

  const mData = [];
  for (let i = 0; i < totalMin; i++) {
    const t     = new Date(arrivee.getTime() + i * 60000);
    const hFrac = t.getHours() + t.getMinutes() / 60;
    const dow   = t.getDay();
    const dk    = dateKey(t);

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
      const isDimFerie = tarif.nuit.dimFeries && (dow === 0 || estFerie(t, canton));
      mData.push({ t, periode: (isNuitH || isDimFerie) ? 'nuit' : 'jour', dk });
    }
  }

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

  let freeLeft = tarif.gratuit_initial;
  const cumul  = {};
  const segments = [];

  for (const g of groupes) {
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

  let total       = Math.round(segments.reduce((s, sg) => s + sg.cout, 0) * 100) / 100;
  const sansRemise = (totalMin / 60) * parking.prixH;
  let economies   = Math.max(0, sansRemise - total);

  // Montant minimum facturé : ne s'applique que s'il y a déjà eu facturation (total > 0).
  // Une session entièrement gratuite (dimanche, plage gratuite…) reste à 0.
  if (parking.montantMin && total > 0 && total < parking.montantMin) {
    const complement = Math.round((parking.montantMin - total) * 100) / 100;
    const lastBillable = [...segments].reverse().find(s => !s.isFree);
    const toDate = lastBillable ? lastBillable.to : new Date(arrivee.getTime() + totalMin * 60000);
    segments.push({
      from: toDate,
      to: toDate,
      minutes: 0,
      tauxH: 0,
      cout: complement,
      label: `Complément montant minimum (CHF ${parking.montantMin.toFixed(2)})`,
      isFree: false,
      isReduced: false
    });
    total = parking.montantMin;
    economies = Math.max(0, sansRemise - total);
  }

  return { total, economies, segments };
}

function calculerMoto(parking, arrivee, depart) {
  if (!parking.moto) return null;
  const totalMin = Math.round((depart - arrivee) / 60000);
  if (totalMin <= 0) return null;

  const canton = feriesCantonOf(parking);
  const tarifH = parking.moto.tarifH;

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
      else if (estFerie(t, canton)) { isFree = true; label = 'Gratuit — jour férié'; }
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

  const billableMin = minutes.filter(m => !m.isFree).length;
  const heures      = Math.ceil(billableMin / 60);
  const total       = Math.round(tarifH * heures * 100) / 100;

  const sansRemise = Math.ceil(totalMin / 60) * tarifH;
  const economies  = Math.max(0, Math.round((sansRemise - total) * 100) / 100);

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

module.exports = {
  estFerie,
  calculer,
  calculerProgressif,
  calculerMoto,
  coutProgressif
};
