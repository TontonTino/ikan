import L from 'leaflet';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapPin } from '@phosphor-icons/react';

// ── Pin de localisation (Phosphor MapPin « fill », teinté selon la satisfaction) ──
// Une icône Leaflet par couleur et symbole, créée une seule fois : le pin est ancré par sa pointe (bas-centre)
// sur la position de l'agence, et le popup s'ouvre juste au-dessus. Le symbole (✓ ! ? –) est dessiné dans la tête du pin :
// il distingue les statuts sans passer par la couleur.
const PIN_SIZE = 38;
const pinIconCache = new Map<string, L.DivIcon>();
export function pinIcon(color: string, symbole?: string): L.DivIcon {
  const cle = `${color}|${symbole ?? ''}`;
  let icon = pinIconCache.get(cle);
  if (!icon) {
    const symboleHtml = symbole
      ? `<span aria-hidden="true" style="position:absolute;left:0;top:7px;width:100%;text-align:center;color:var(--color-text-inverse);font:600 15px/1 var(--font-main);">${symbole}</span>`
      : '';
    icon = L.divIcon({
      className: 'siege-pin',
      html: `<div style="position:relative;filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4)); line-height: 0;">${renderToStaticMarkup(
        <MapPin size={PIN_SIZE} weight="fill" color={color} />
      )}${symboleHtml}</div>`,
      iconSize: [PIN_SIZE, PIN_SIZE],
      iconAnchor: [PIN_SIZE / 2, PIN_SIZE - 2],
      popupAnchor: [0, -(PIN_SIZE - 6)],
    });
    pinIconCache.set(cle, icon);
  }
  return icon;
}

// ── Groupe d'agences proches (lot 6) : pastille encre avec le nombre d'agences ──
// Couleur neutre (l'encre du menu) : un groupe n'a pas de statut propre. S'il contient au moins une agence sous son seuil,
// un « ! » (le symbole du pin « sous le seuil ») s'ajoute en coin : le signal passe par le symbole, pas par la couleur seule.
const GROUPE_TAILLE = 40;
const groupeIconCache = new Map<string, L.DivIcon>();
export function groupeIcon(nombre: number, contientSousSeuil: boolean): L.DivIcon {
  const cle = `${nombre}|${contientSousSeuil}`;
  let icon = groupeIconCache.get(cle);
  if (!icon) {
    const alerte = contientSousSeuil ? '<span class="carte-groupe__alerte" aria-hidden="true">!</span>' : '';
    icon = L.divIcon({
      className: 'carte-groupe',
      html: `<span class="carte-groupe__pastille" aria-hidden="true">${nombre}</span>${alerte}`,
      iconSize: [GROUPE_TAILLE, GROUPE_TAILLE],
      iconAnchor: [GROUPE_TAILLE / 2, GROUPE_TAILLE / 2],
      popupAnchor: [0, -GROUPE_TAILLE / 2],
    });
    groupeIconCache.set(cle, icon);
  }
  return icon;
}
