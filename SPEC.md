# Parkings Sion — Spécification produit & Roadmap

> Version 1.0 · Avril 2026
> Auteur : Mickael Martiny
> Document dérivé du one-pager de partenariat avec la Ville de Sion

---

## 1. Vision

**Parkings Sion** est un service web public, gratuit et indépendant, qui supprime l'incertitude tarifaire du stationnement à Sion. L'utilisateur obtient en quelques secondes **quel parking est le moins cher pour sa durée réelle**, avec une UI moderne et un calcul minute par minute intégrant toutes les spécificités locales.

À terme, le produit devient **le guichet numérique unique de la mobilité urbaine sédunoise** : tarifs, disponibilité temps réel, parkings moto, bornes électriques, partenariats commerces (Migros, Coop), mobilité douce, P+R, intégration sion.ch.

---

## 2. Utilisateurs & cas d'usage

| Persona | Besoin | Cas d'usage dominant |
|---|---|---|
| 🚗 **Résident occasionnel** | Savoir où se garer pour faire ses courses | Arrêt court (< 1 h) — cherche la 1ère heure gratuite |
| 🧳 **Pendulaire / actif** | Stationnement journée complète à coût maîtrisé | Cherche le meilleur plafond journalier |
| 🎉 **Sortie soir / week-end** | Profiter des gratuités (ven 17h → sam 24h) | Cherche les fenêtres gratuites |
| 👨‍👩‍👧 **Famille visiteurs** | Premier séjour à Sion, découverte | Simulateur pour horaires inhabituels |
| 🏛 **Services municipaux** | Outil de communication tarifaire citoyen | Consommation API / intégration sion.ch |

---

## 3. État actuel (v1.0 — livré)

### Fonctionnalités en production
- ✅ Annuaire des **7 parkings** (2 618 places)
- ✅ Mode **simulation simple** (1 parking, plage horaire)
- ✅ Mode **comparaison** (7 parkings, classement + économies)
- ✅ Moteur de calcul **minute par minute** (Node.js/Express)
- ✅ Règles tarifaires complexes : 1ère h gratuite, plages quotidiennes/hebdo, tarifs nuit, forfaits, jours fériés suisses
- ✅ Tarification progressive (paliers) pour Planta & Cour de Gare
- ✅ Liens Google Maps par parking
- ✅ **PWA** (Service Worker, manifest, offline-ready)
- ✅ **Thème Dark Premium Blue** + mode clair
- ✅ Double déploiement : Railway + Vercel
- ✅ Responsive mobile

### Stack technique
- **Backend** : Node.js 22 · Express 4.18 · JSON statique
- **Frontend** : HTML/CSS/JS vanilla · PWA
- **Hosting** : Railway (prod) · Vercel (miroir)
- **Data** : `data/parkings.json` éditable manuellement

### Métriques clés (cible)
- Temps de réponse API `/api/calculer` : < 50 ms
- First Contentful Paint : < 1.5 s
- Lighthouse PWA : ≥ 90

---

## 4. Spécification fonctionnelle détaillée

### 4.1 API publique

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/parkings` | GET | Liste complète des parkings (JSON) |
| `/api/calculer` | POST | Calcul du coût pour un parking + plage horaire |

**Contrat `/api/calculer`** :
```json
{ "id": "planta", "debut": "2026-04-21T09:00", "fin": "2026-04-21T18:00" }
→ { "total": 9.00, "blocs": [...], "economies": 2.00 }
```

### 4.2 Moteur de calcul (règles)

| Type de règle | Description |
|---|---|
| `premiere_h_gratuite` / `demi_h_gratuite` | 1ère heure / 30 min offerte |
| `h1_plage` | 1ère heure gratuite uniquement dans une plage |
| `gratuit_dim`, `gratuit_dim_feries`, `gratuit_sam_apres` | Gratuité hebdomadaire |
| `tarif_nuit`, `tarif_nuit_dim_feries` | Réduction % nocturne |
| `gratuit_plage_quotidien` / `_hebdo` | Plages gratuites quotidiennes/hebdomadaires |
| `tarification.paliers` | Tarif progressif par tranche (Planta, Gare) |
| `plafond` | Plafond journalier (Gare : 35/12 CHF) |

---

## 5. Roadmap produit

### 🎯 Phase 1 — **Consolidation** (Q2 2026) · *en cours*

> Objectif : fiabiliser, crédibiliser, ouvrir la discussion avec la Ville.

| # | Livrable | Valeur | Effort |
|---|---|---|:---:|
| 1.1 | One-pager partenariat Ville de Sion ✅ | Porte d'entrée institutionnelle | S |
| 1.2 | Analytics (Plausible / Umami) | Mesurer l'usage réel | S |
| 1.3 | Page "À propos" + mentions légales | Crédibilité | S |
| 1.4 | Formulaire de feedback utilisateur | Boucle d'amélioration | S |
| 1.5 | Tests unitaires sur le moteur de calcul | Robustesse | M |
| 1.6 | Monitoring (Sentry / Better Stack) | Détection d'erreurs prod | S |
| 1.7 | SEO : sitemap, OG tags, schema.org | Découvrabilité Google | S |

### 🚀 Phase 2 — **Expansion fonctionnelle & couverture** (Q3 2026)

> Objectif : devenir l'outil de référence pour tout véhicule stationnant à Sion.

| # | Livrable | Valeur | Effort |
|---|---|---|:---:|
| 2.1 | **Géolocalisation** : "parking le plus proche" | Confort usager | M |
| 2.2 | **Parkings moto / 2-roues** — inventaire dédié, tarifs spécifiques | Élargit la cible | M |
| 2.3 | **Bornes de recharge EV** — localisation, disponibilité, tarifs | Transition énergétique | M |
| 2.4 | **Favoris** (localStorage) | Rétention | S |
| 2.5 | **Historique de simulations** | Utilité récurrente | S |
| 2.6 | **Estimation carburant/émissions** selon distance | Mobilité responsable | M |
| 2.7 | **Partage lien de simulation** (URL paramétrée) | Viralité | S |
| 2.8 | **Mode hors-ligne complet** (PWA avancée) | Résilience | M |
| 2.9 | **Widget iframe embarquable** pour sion.ch et tiers | Distribution | M |
| 2.10 | Version **anglais / allemand** | Tourisme | M |

### 🏙 Phase 3 — **Temps réel, Commerces & Partenariat institutionnel** (Q4 2026)

> Objectif : devenir un service municipal officiel et un pont entre stationnement et commerces locaux.

| # | Livrable | Valeur | Effort |
|---|---|---|:---:|
| 3.1 | **Disponibilité temps réel** (places libres) *— nécessite API Ville/exploitants* | Valeur métier majeure | L |
| 3.2 | Intégration officielle **sion.ch** | Légitimité & audience | L |
| 3.3 | **Commerces partenaires — Validation ticket** (Migros, Coop, commerçants centre-ville) | Bénéfice concret client + commerçant | L |
| 3.4 | **Page commerces partenaires** : liste, réductions, codes parking | Visibilité locale | M |
| 3.5 | **Alertes push** (place libre, événement) | Engagement | M |
| 3.6 | **Tableau de bord Ville** (stats usage, saturation) | Aide à la décision publique | M |
| 3.7 | Convention de partenariat + SLA | Pérennité | M |
| 3.8 | **Mises à jour tarifaires collaboratives** (back-office Ville) | Autonomie Ville | M |

### 🌱 Phase 4 — **Mobilité urbaine intégrée** (2027)

> Objectif : élargir au-delà du stationnement voiture.

| # | Livrable | Valeur | Effort |
|---|---|---|:---:|
| 4.1 | **P+R** (Park & Ride) avec correspondances transports publics | Mobilité douce | L |
| 4.2 | **Mobilité douce** : vélos libre-service, trottinettes | Plateforme mobilité | L |
| 4.3 | **Recommandation multimodale** (voiture → bus → marche) | Différenciation | L |
| 4.4 | **Marketplace commerces élargi** — fidélité, bons plans, événementiel | Écosystème local | L |
| 4.5 | **Open Data** : API publique documentée | Écosystème développeurs | M |
| 4.6 | **App mobile native** (iOS/Android) — si usage PWA insuffisant | UX premium | XL |

---

## 6. KPIs de succès

| KPI | Baseline | Cible Q4 2026 | Cible 2027 |
|---|---:|---:|---:|
| Visiteurs uniques / mois | — | 2 000 | 8 000 |
| Simulations / mois | — | 5 000 | 25 000 |
| Ville de Sion utilisatrice officielle | ❌ | ✅ | — |
| Taux de rétention 30j | — | 20 % | 35 % |
| Temps médian simulation → décision | — | < 20 s | < 10 s |
| Lighthouse Performance | 85 | ≥ 90 | ≥ 95 |

---

## 7. Modèle économique

| Piste | Status | Commentaire |
|---|:---:|---|
| Service gratuit pour l'usager | ✅ | Principe fondateur, non négociable |
| Partenariat Ville de Sion | 🎯 | Financement de la maintenance + évolutions |
| Subvention canton / fonds mobilité | 🔍 | À explorer si adoption confirmée |
| API premium pour exploitants | 🔮 | Phase 3+ uniquement, si demande émerge |
| **Partenariats commerces** (Migros, Coop, commerçants centre) | 🎯 | Commission discrète / co-financement, sans publicité intrusive |
| Donations / sponsoring local | ❌ | Incompatible avec neutralité |

---

## 8. Risques & mitigations

| Risque | Impact | Probabilité | Mitigation |
|---|:---:|:---:|---|
| Évolution tarifs non remontée | 🔴 | M | Partenariat Ville = flux officiel. En attendant : veille manuelle mensuelle |
| Absence d'API de disponibilité temps réel | 🟡 | H | Scraping léger / partenariat exploitants dès Phase 3 |
| Concurrence app privée (Parkopedia, EasyPark) | 🟢 | B | Différenciation = gratuit + local + exhaustivité tarifaire |
| Dépendance hosting (Railway/Vercel) | 🟢 | B | Double déploiement déjà en place |
| Charge maintenance bénévole | 🟡 | M | Phase 1 : tests + monitoring pour réduire MTTR |

---

## 9. Prochaines étapes immédiates

1. **Prendre contact avec la Ville de Sion** (service mobilité / développement durable) — envoi du one-pager
2. Installer **Plausible Analytics** pour mesurer l'usage
3. Ajouter **Sentry** pour le monitoring d'erreurs
4. Rédiger la **page "À propos"** + mentions légales
5. Suite à premier feedback utilisateurs : prioriser Phase 2 (géoloc, favoris, partage)

---

*Parkings Sion · parking-sion.up.railway.app · parkings-sion.vercel.app*
