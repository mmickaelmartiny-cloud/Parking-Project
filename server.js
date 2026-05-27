const express = require('express');
const path    = require('path');
const fs      = require('fs');

const { calculer, calculerProgressif, calculerMoto } = require('./lib/engine');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DONNÉES MULTI-VILLES ──────────────────────────────────────────────────
//
// Autoload de toutes les villes présentes dans data/villes/*.json.
// Métadonnées (nom, canton, centre carte) dans data/villes.json.

const VILLES_DIR  = path.join(__dirname, 'data', 'villes');
const VILLES_META = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'villes.json'), 'utf8')
);

const PARKINGS = [];
for (const meta of VILLES_META) {
  const file = path.join(VILLES_DIR, `${meta.id}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`⚠️  ${file} introuvable, ville "${meta.id}" ignorée`);
    continue;
  }
  const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const p of arr) PARKINGS.push(p);
}

// ── ROUTES API ────────────────────────────────────────────────────────────

app.get('/api/villes', (req, res) => {
  const enriched = VILLES_META.map(v => ({
    ...v,
    count: PARKINGS.filter(p => p.ville === v.id).length
  }));
  res.json(enriched);
});

app.get('/api/parkings', (req, res) => {
  const { ville } = req.query;
  if (!ville) return res.json(PARKINGS);
  res.json(PARKINGS.filter(p => p.ville === ville));
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

  if (parking.tarifApproximatif) {
    return res.status(400).json({ erreur: 'Tarif complexe, voir détail sur place.' });
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
  const counts = VILLES_META.map(v => `${v.nom}: ${PARKINGS.filter(p => p.ville === v.id).length}`).join(' · ');
  console.log(`✅  Parkings → http://localhost:${PORT}  (${counts})`);
});
