import React from 'react';
import { AlertTriangleIcon } from '../common/Icons';

/**
 * Avis contradictoire (note et commentaire en désaccord) : icône ET texte, jamais la couleur seule. Même badge dans le
 * tableau et dans les cartes mobiles.
 */
export default function BadgeDiscordance({ discordance }: { discordance?: boolean }) {
  if (!discordance) return null;
  return (
    <span
      className="badge-discordance"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#9A3412', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '6px', padding: '2px 8px', fontSize: '0.70rem', fontWeight: 800 }}
    >
      <AlertTriangleIcon size={12} color="#9A3412" aria-hidden="true" />
      <span>Avis contradictoire</span>
    </span>
  );
}
