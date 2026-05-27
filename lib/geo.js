// Helpers géographiques — distance grand-cercle (haversine) et formatage.
//
// Précision : < 0.5% pour des distances < 100 km (largement suffisant pour
// trier des parkings dans une ville). Rayon moyen de la Terre : 6371 km.

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return deg * Math.PI / 180;
}

/**
 * Distance grand-cercle entre deux points GPS (formule haversine).
 * @param {number} lat1 - latitude du point A en degrés
 * @param {number} lng1 - longitude du point A en degrés
 * @param {number} lat2 - latitude du point B en degrés
 * @param {number} lng2 - longitude du point B en degrés
 * @returns {number} distance en mètres
 */
function distanceM(lat1, lng1, lat2, lng2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLam = toRad(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2
          + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Formate une distance en mètres pour affichage utilisateur (FR-CH).
 *   < 1000 m   → "120 m"
 *   < 10 km    → "1.2 km"
 *   ≥ 10 km    → "12 km"
 * @param {number} m - distance en mètres
 * @returns {string}
 */
function formatDistance(m) {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

module.exports = { distanceM, formatDistance, EARTH_RADIUS_M };
