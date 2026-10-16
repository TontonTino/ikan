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
      ? `<span aria-hidden="true" style="position:absolute;left:0;top:7px;width:100%;text-align:center;color:#fff;font:800 15px/1 system-ui,sans-serif;">${symbole}</span>`
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
