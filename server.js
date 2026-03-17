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

const FERIES = ['01-01','01-02','05-01','08-01','11-01','12-25','12-26'];

function estFerie(d) {
  const mmdd = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return FERIES.includes(mmdd);
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
    if (rMidi && !isFree) {
      const tMin = h * 60 + t.getMinutes();
      if (tMin >= rMidi.hDeb * 60 && tMin < rMidi.hFin * 60) {
        isFree = true; label = rMidi.label;
      }
    }
    // Gratuit un jour de la semaine dans une plage horaire (ex: vendredi 17h–24h)
    const rHebdo = parking.regles.find(r => r.type === 'gratuit_plage_hebdo');
    if (rHebdo && !isFree && dow === rHebdo.jour) {
      const tMin = h * 60 + t.getMinutes();
      if (tMin >= rHebdo.hDeb * 60 && tMin < rHebdo.hFin * 60) {
        isFree = true; label = rHebdo.label;
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

// ── ROUTES API ────────────────────────────────────────────────────────────

app.get('/api/parkings', (req, res) => {
  res.json(PARKINGS);
});

app.post('/api/calculer', (req, res) => {
  const { parkingId, arrivee, depart } = req.body;

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

  const result = calculer(parking, dtArrivee, dtDepart);
  res.json({ parking, result });
});

// ── DÉMARRAGE ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅  Parkings Sion → http://localhost:${PORT}`);
});
