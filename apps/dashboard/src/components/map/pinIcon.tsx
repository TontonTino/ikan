import L from 'leaflet';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapPin } from '@phosphor-icons/react';

// ── Pin de localisation (Phosphor MapPin « fill », teinté selon la satisfaction) ──
// Une icône Leaflet par couleur, créée une seule fois : le pin est ancré par sa pointe (bas-centre)
// sur la position de l'agence, et le popup s'ouvre juste au-dessus.
const PIN_SIZE = 38;
const pinIconCache = new Map<string, L.DivIcon>();
export function pinIcon(color: string): L.DivIcon {
  let icon = pinIconCache.get(color);
  if (!icon) {
    icon = L.divIcon({
      className: 'siege-pin',
      html: `<div style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4)); line-height: 0;">${renderToStaticMarkup(
        <MapPin size={PIN_SIZE} weight="fill" color={color} />
      )}</div>`,
      iconSize: [PIN_SIZE, PIN_SIZE],
      iconAnchor: [PIN_SIZE / 2, PIN_SIZE - 2],
      popupAnchor: [0, -(PIN_SIZE - 6)],
    });
    pinIconCache.set(color, icon);
  }
  return icon;
}
