# Matrice de tests — Parkings Sion

> **Utilisation** : `npm test`
> **Contenu** : 24 scénarios couvrant les 7 parkings et toutes les règles tarifaires.
> **Critère PASS** : `|actuel − attendu| < 0.01 CHF` · **FAIL** sinon.

## Dates de référence

| Date | Jour | Spécificité |
|---|---|---|
| 2026-04-20 | Lundi | Jour ouvrable standard |
| 2026-04-24 | Vendredi | Plage gratuite ven 17h → sam 24h |
| 2026-04-25 | Samedi | Toute la journée gratuite |
| 2026-04-26 | Dimanche | Tarif nuit/dim/fériés |
| 2026-05-01 | 1er mai | Férié suisse |

## Matrice complète

### A · Règles de base (1ère heure, granularité, parking gratuit)

| ID | Parking | Scénario | Arrivée → Départ | Attendu |
|:---:|---|---|---|:---:|
| A1 | Planta | 1ère heure exacte | 20/04 09:00 → 10:00 | **0.00 CHF** |
| A2 | Planta | 1h01 → bascule tranche 20 min | 20/04 09:00 → 10:01 | **1.00 CHF** |
| A3 | Roches-Brunes | 1h30 → 1 tranche 30 min | 20/04 09:00 → 10:30 | **1.00 CHF** |
| A4 | Roches-Brunes | 1h31 → bascule 2ème tranche | 20/04 09:00 → 10:31 | **2.00 CHF** |
| A5 | Potences | Parking gratuit 5h | 20/04 09:00 → 14:00 | **0.00 CHF** |

### B · Règle midi × 1ère heure (écoulement chronologique)

> La plage gratuite 12h–13h30 **consomme** le crédit de 1ère heure (règle Ville de Sion).

| ID | Parking | Scénario | Arrivée → Départ | Attendu |
|:---:|---|---|---|:---:|
| B1 | Planta | 11h→13h30 (1h grat + midi) | 20/04 11:00 → 13:30 | **0.00 CHF** |
| B2 | Planta | Juste le midi | 20/04 12:00 → 13:30 | **0.00 CHF** |
| B3 | Planta | Après midi, crédit 1h intact | 20/04 13:30 → 14:30 | **0.00 CHF** |
| B4 | Planta | **12h30→14h : midi consomme, 30 min payants** | 20/04 12:30 → 14:00 | **2.00 CHF** |
| B5 | Roches-Brunes | Idem en tranches 30 min | 20/04 12:30 → 14:00 | **1.00 CHF** |
| B6 | Cible | 11h→14h (1h + midi + 30 min payants) | 20/04 11:00 → 14:00 | **2.00 CHF** |

### C · Week-end (plage hebdo vendredi 17h → samedi 24h)

| ID | Parking | Scénario | Arrivée → Départ | Attendu |
|:---:|---|---|---|:---:|
| C1 | Planta | Ven 16h-18h (1h grat + 1h plage hebdo) | 24/04 16:00 → 18:00 | **0.00 CHF** |
| C2 | Planta | Samedi toute la journée | 25/04 10:00 → 14:00 | **0.00 CHF** |
| C3 | Planta | Ven soir 18h-22h | 24/04 18:00 → 22:00 | **0.00 CHF** |

### D · Tarif nuit

| ID | Parking | Scénario | Arrivée → Départ | Attendu |
|:---:|---|---|---|:---:|
| D1 | Planta | 8h nuit (paliers : 7h × 1 CHF après 1h grat) | 20/04 22:00 → 21/04 06:00 | **7.00 CHF** |
| D2 | Roches-Brunes | 8h nuit (7h × 0.20 CHF linéaire) | 20/04 22:00 → 21/04 06:00 | **1.40 CHF** |

### E · Dimanches & jours fériés

| ID | Parking | Scénario | Arrivée → Départ | Attendu |
|:---:|---|---|---|:---:|
| E1 | Planta | Dimanche 10h-12h → tarif nuit | 26/04 10:00 → 12:00 | **1.00 CHF** |
| E2 | Planta | 1er mai (férié) 10h-12h | 01/05 10:00 → 12:00 | **1.00 CHF** |

### F · Plafonds Cour de Gare

| ID | Parking | Scénario | Arrivée → Départ | Attendu |
|:---:|---|---|---|:---:|
| F1 | Cour de Gare | Dimanche 24h → plafond nuit 12 CHF | 26/04 00:00 → 27/04 00:00 | **12.00 CHF** |
| F2 | Cour de Gare | Lundi 9h-19h → paliers jour, sous plafond | 20/04 09:00 → 19:00 | **27.00 CHF** |

### G · Tarif moto (linéaire 0.50 CHF/h)

| ID | Parking | Scénario | Arrivée → Départ | Attendu |
|:---:|---|---|---|:---:|
| G1 | Planta moto | 1h × 0.50 CHF | 20/04 09:00 → 10:00 | **0.50 CHF** |
| G2 | Planta moto | 2h × 0.50 CHF | 20/04 09:00 → 11:00 | **1.00 CHF** |
| G3 | Scex moto | 1h30 (linéaire, midi ignoré) | 20/04 12:30 → 14:00 | **0.75 CHF** |
| G4 | Cible moto | **Doit refuser** (pas de tarif moto) | — | **Erreur 400** |

---

## Comment lire un échec

Si un test passe de PASS à FAIL après une modification :

1. **Catégorie A (Base)** → régression sur le moteur de base ou tranches
2. **Catégorie B (Midi)** → régression sur l'interaction crédit 1h × plage gratuite
3. **Catégorie C (Weekend)** → régression sur les plages hebdomadaires
4. **Catégorie D (Nuit)** → régression sur les paliers de nuit
5. **Catégorie E (Férié)** → régression sur `FERIES` ou `dimFeries`
6. **Catégorie F (Plafond)** → régression sur les plafonds journaliers
7. **Catégorie G (Moto)** → régression sur `calculerMoto` ou la validation `vehicule`

## Ajouter un test

Édite `tests/run-tests.js`, ajoute une entrée dans le tableau `TESTS` :

```js
{ id: 'X1', cat: 'NouvelleCat', parking: 'planta', ar: '2026-04-20T09:00', dp: '2026-04-20T10:00', veh: 'voiture', expected: 0.00, desc: 'Ma description' }
```

Pour un test attendant une erreur API : `expected: 'ERR'`.
