# Roadmap d'intégration — Axes d'évolutivité du one-pager

> Version 1.0 · 22 avril 2026
> Roadmap tactique pour intégrer les 7 axes d'évolutivité annoncés dans le one-pager de partenariat.

---

## Vue d'ensemble des 7 axes

| # | Axe | Dépendance critique | Effort | Priorité |
|---|---|---|:---:|:---:|
| A | **Places en temps réel** | API exploitants / Ville | L | 🟢 Haute |
| B | **Parkings moto / 2-roues** | Données Ville ou relevé terrain | M | 🟢 Haute |
| C | **Bornes de recharge EV** | API OpenChargeMap / ChargeMap / OIKN | M | 🟡 Moyenne |
| D | **Commerces partenaires** (Migros, Coop…) | Conventions directes commerçants | L | 🟡 Moyenne |
| E | **Mobilité douce** (vélos, trottinettes) | API PubliBike / opérateurs locaux | M | 🟠 Basse |
| F | **P+R** (Park & Ride) | Collaboration CFF/Car Postal + Ville | L | 🟠 Basse |
| G | **Intégration sion.ch** | Décision politique Ville de Sion | M | 🟢 Haute |

**Légende effort** : S = 1–3 jours · M = 1–3 semaines · L = 1–3 mois

---

## Calendrier en sprints

```
2026                          2027
│Q2    │Q3          │Q4          │Q1          │Q2
├──────┼────────────┼────────────┼────────────┼────────
│ A-0  │ B   C   G  │ A-1   D    │ E   F      │ A-2
│      │            │            │            │
Socle   Quick wins    Adoption     Extension    Consolidation
```

---

## Sprint 0 — Socle technique (Mai–Juin 2026) · 4 semaines

> **Objectif** : préparer l'architecture pour accueillir les 7 axes sans dette technique.

| # | Livrable | Axe visé | Effort |
|---|---|---|:---:|
| S0.1 | **Refonte data model** : passage de `parkings.json` à un schéma multi-entités (parkings, bornes, stations vélos, commerces) | Tous | M |
| S0.2 | **Passage à une base de données** (SQLite → PostgreSQL sur Railway) avec migrations | Tous | M |
| S0.3 | **API REST versionnée** `/api/v2/*` avec OpenAPI spec | Tous | M |
| S0.4 | **Architecture géographique** : coordonnées GPS normalisées, tuiles Leaflet/MapLibre | A, B, C, E, F | M |
| S0.5 | **CI/CD GitHub Actions** : tests + déploiement auto Railway | Tous | S |
| S0.6 | **Design system documenté** (tokens actuels → variables extensibles) | Tous | S |

**Livrable visible** : aucun côté usager. C'est l'investissement indispensable.

---

## Phase A — Places en temps réel (Q3–Q4 2026)

> **Impact** : ×10 valeur pour l'usager. Le seul facteur vraiment différenciant.

### A-0 · Prototype (Juillet 2026)
- Étude faisabilité avec **1 parking pilote** (Cour de Gare ou Planta)
- Méthode : API exploitant si existe, sinon scraping page web publique (si affichage existant), sinon capteurs IoT (hors scope court terme)
- Affichage statut : `disponible` / `presque plein` / `complet` (pas de chiffre exact si non fiable)

### A-1 · Généralisation (Q4 2026)
- Intégration des 7 parkings via convention Ville de Sion (ou exploitants un par un)
- Chiffres exacts avec timestamp de dernière mise à jour
- Graphique 24h de remplissage historique
- **Prédiction** : "À cette heure, ce parking est généralement à X % plein"

### A-2 · Temps réel complet (Q1 2027)
- WebSocket pour mise à jour live
- Notifications push "place libérée" sur parkings favoris
- Historique 7 jours / 30 jours / annuel

**Dépendances** :
- ⚠️ **Bloquant** : accord formel avec au moins un exploitant ou la Ville
- API technique côté exploitants

**Risques** :
- 🔴 Aucun exploitant ne fournit de données → fallback : partenariat capteurs IoT LoRa (Swisscom) — coût élevé
- 🟡 Qualité des données variable selon exploitant

---

## Phase B — Parkings moto / 2-roues (Juillet 2026) · 2 semaines

> **Quick win** à haute valeur : segment ignoré par tous les outils concurrents.

### B.1 · Recensement
- **Relevé terrain** des zones 2-roues existantes à Sion (ou demande à la Ville)
- ~15–20 zones attendues (gratuites pour la plupart)
- Données à collecter : adresse, coordonnées GPS, nombre de places, horodateur oui/non, tarif si applicable

### B.2 · Intégration produit
- Extension du data model : type `parking` ∈ `{voiture, moto, velo_securise}`
- Toggle UI "🚗 Voiture / 🏍 Moto" sur la homepage
- Filtrage dynamique sur la carte et le comparateur
- Simulateur adapté (tarifs souvent différents, durée courte privilégiée)

### B.3 · SEO
- Page dédiée `/parkings-moto-sion`
- Requête cible : "parking moto Sion", "où garer moto Sion"

**Dépendances** : Aucune (relevé terrain possible seul).

**Livrable** : +1 persona (motard) capturée · différenciation forte.

---

## Phase C — Bornes de recharge EV (Août 2026) · 3 semaines

### C.1 · Source de données
- **OpenChargeMap API** (open data, gratuite, CH couvert) — `GET /poi?countrycode=CH&latitude=46.23&longitude=7.36&distance=5`
- Backup : ChargeMap (partenariat API) ou scraping **evpass.ch** / **swisscharge.ch**
- Enrichissement manuel : parkings couverts avec bornes intégrées (Planta, Gare ont parfois des bornes)

### C.2 · Intégration
- Nouvelle entité `borne_ev` (coords, opérateur, puissance kW, connecteurs, tarif CHF/kWh)
- Carte avec filtre "⚡ Bornes EV"
- Détails : disponibilité si API le fournit, sinon horodatage dernière vérification
- **Calcul coût charge** : "Recharger 20 kWh ≈ X CHF à cette borne"

### C.3 · Tarification combinée
- Simulateur enrichi : "Je veux me garer 3h ET recharger"
- Recommandation : parking avec borne intégrée vs parking + borne séparée

**Dépendances** : clé API OpenChargeMap (gratuite, immédiate).

---

## Phase D — Commerces partenaires (Septembre–Novembre 2026)

> **Axe le plus incertain** : dépend de négociations commerciales.

### D.1 · Pré-démarchage (septembre)
- Liste cible : Migros Métropole, Coop Sion, centres commerciaux, commerçants rue du Grand-Pont
- Pitch : "Vos clients trouvent votre emplacement + validation ticket parking"
- Définir modèle : validation papier existante ? code QR ? app partenaire ?

### D.2 · MVP avec 1–2 partenaires (octobre)
- Migros ou Coop comme pilote
- Page dédiée : "Où valider mon ticket parking ?"
- Carte interactive : commerces partenaires près de chaque parking
- Intégration dans le simulateur : "À Cour de Gare + achat Migros ≥ 30 CHF = parking gratuit"

### D.3 · Extension (novembre)
- Onboarding de 10+ commerçants
- **Dashboard commerçant** minimal : voir fréquentation, mettre à jour offre
- API commerçant `/api/merchants/:id/validations` (pour traçabilité)

### D.4 · Modèle économique (décembre)
- **Option 1** : gratuit pour tous (civic tech pure)
- **Option 2** : commission à la validation (0.10 CHF / ticket ≈ financement maintenance)
- **Option 3** : forfait annuel par commerce (150 CHF/an)
- Décision à prendre selon traction

**Dépendances** :
- 🔴 **Bloquant** : accords commerciaux. Sans partenaires → phase reportée.
- Moyenne : 3–6 mois de négociation par grande enseigne.

**Risques** :
- Négociation Migros/Coop longue (centralisée, pas locale)
- Alternative : commencer par commerçants indépendants (décision rapide)

---

## Phase E — Mobilité douce (Q1 2027) · 4 semaines

### E.1 · Vélos libre-service
- **PubliBike API** (si disponible à Sion — à vérifier)
- Sinon : vélos en libre service communaux de Sion
- Données : stations, vélos disponibles, vélos électriques

### E.2 · Trottinettes
- Lime, Tier, Voi : présents à Sion ? (veille)
- Intégration API si opérateur présent

### E.3 · UX
- Vue carte unifiée : 🚗 + 🏍 + ⚡ + 🚲 + 🛴
- Filtres par mode
- Recommandation "Dernier km" : gare-toi aux Potences (gratuit) + prends un vélo pour le centre

**Dépendances** : présence effective d'opérateurs à Sion (à confirmer).

---

## Phase F — P+R (Park & Ride) (Q1 2027) · 6 semaines

### F.1 · Recensement P+R existants
- CFF : Sion Gare, P+R Uvrier, P+R Brignon ?
- Car Postal : connexions régionales
- Données Ville : politique P+R à Sion

### F.2 · Intégration transports publics
- **API CFF Hafas** : horaires train/bus en temps réel
- Calcul d'itinéraire "voiture → gare → train → centre Sion"
- Coût comparé : parking centre vs P+R + titre transport

### F.3 · Recommandation intelligente
- "Pour aller au centre aujourd'hui (samedi marché), P+R + bus = 8 CHF vs parking Planta = 15 CHF"
- Calcul émissions CO2 comparé

**Dépendances** :
- API CFF (ouverte mais complexe)
- Collaboration Ville + Car Postal

---

## Phase G — Intégration sion.ch (transversale, à démarrer maintenant)

> **Porte d'entrée politique** : sans ça, le reste reste confidentiel.

### G.1 · Prise de contact (Avril–Mai 2026) · en cours
- Envoi one-pager au service mobilité + développement durable
- RDV découverte
- Alignement sur **qui fait quoi** : maintenance data, hébergement, communication

### G.2 · Widget embarquable (Juin–Juillet 2026)
- Livrable technique simple : `<iframe src="https://parking-sion.up.railway.app/widget">`
- Versions : comparateur complet / mini-widget "meilleur prix maintenant"
- Documentation d'intégration pour l'équipe web Ville

### G.3 · Sous-domaine officiel (Septembre 2026)
- `parking.sion.ch` en CNAME vers notre hébergement
- Header : logo Ville de Sion (co-branding)
- Lien de retour vers sion.ch/mobilite

### G.4 · Convention (Q4 2026)
- Convention écrite : mission, durée, indicateurs, gouvernance
- Clauses : données publiques, RGPD, continuité service

**Dépendances** : décision politique + budget Ville (variable selon année civile).

---

## Synthèse — Matrice effort × impact

```
         │ IMPACT USAGER
         │
    HAUT │   B          A         (D)
         │  Moto     Temps réel  Commerces
         │
  MOYEN  │   C                    G
         │  EV                 sion.ch
         │
    BAS  │             E          F
         │         Mobilité    P+R
         │          douce
         └────────────────────────────
           FAIBLE    MOYEN    FORT     EFFORT
```

**Séquence recommandée** :

1. **G** (sion.ch) — en parallèle de tout, démarrer maintenant
2. **S0** (socle technique) — Mai–Juin 2026
3. **B** (moto) — Juillet 2026 — quick win sans dépendance
4. **C** (EV) — Août 2026 — quick win avec API publique
5. **A-0 prototype temps réel** — Septembre 2026
6. **D** (commerces MVP) — Oct–Nov 2026 — si négociations avancent
7. **A-1 temps réel généralisé** — Q4 2026
8. **E** + **F** — Q1 2027

---

## Budget estimatif (dev bénévole)

| Phase | Heures bénévoles | Coûts externes |
|---|---:|---:|
| S0 socle | 80 h | 0 CHF |
| A temps réel | 120 h | 0–5 000 CHF (capteurs IoT si fallback) |
| B moto | 30 h | 0 CHF |
| C EV | 40 h | 0 CHF |
| D commerces | 80 h | 0 CHF |
| E mobilité douce | 40 h | 0 CHF |
| F P+R | 60 h | 0 CHF |
| G sion.ch | 30 h | 0 CHF |
| **TOTAL** | **480 h** | **0–5 000 CHF** |

> Mandat Ville de Sion recommandé : **3 000 CHF/an** pour maintenance + évolutions légères, **15 000 CHF forfait** pour phase A temps réel si l'infrastructure capteurs est nécessaire.

---

## Jalons de décision (go/no-go)

| Jalon | Date cible | Critère | Décision si atteint |
|---|---|---|---|
| **J1** | Fin mai 2026 | Réponse Ville de Sion | Si OK → convention, sinon → sion.ch reporté |
| **J2** | Fin juillet 2026 | 100 visiteurs/semaine | Si oui → confirmer Phase C & D, sinon → focus Phase A |
| **J3** | Fin octobre 2026 | 1 partenaire commerce signé | Si oui → scale D, sinon → archiver D |
| **J4** | Fin 2026 | 1 exploitant fournit data temps réel | Si oui → généralisation A-1, sinon → pivot capteurs |

---

*Parkings Sion · Roadmap d'intégration v1.0 · 22 avril 2026 · Mickael Martiny*
