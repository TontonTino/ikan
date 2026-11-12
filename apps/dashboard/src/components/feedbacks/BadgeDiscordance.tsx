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
      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-surveiller-texte)', background: 'var(--color-surveiller-fond)', borderRadius: '6px', padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}
    >
      <AlertTriangleIcon size={12} color="var(--color-surveiller-texte)" aria-hidden="true" />
      <span>Avis contradictoire</span>
    </span>
  );
}
