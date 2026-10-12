import React from 'react';
import type { StatutTraitement, UserRole } from '../../types';
import Button from '../ui/Button';

/**
 * Prise en charge d'un avis : action EXPLICITE du Responsable d'agence. Consulter un avis (le lire, voir son
 * analyse IA) ne le modifie pas et ne l'attribue à personne. Le CX Manager consulte et n'a pas cette action.
 */
export default function PriseEnChargeBanner({
  statut,
  role,
  chargement,
  onPrendreEnCharge,
}: {
  statut: StatutTraitement;
  role: UserRole | undefined;
  chargement: boolean;
  onPrendreEnCharge: () => void;
}) {
  if (statut !== 'nouveau') return null;

  if (role === 'agency_manager') {
    return (
      <div
        role="region"
        aria-label="Prise en charge de l’avis"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '12px 28px', background: '#FFF7ED', borderBottom: '1px solid #FED7AA' }}
      >
        <p style={{ margin: 0, fontSize: '0.84rem', color: '#7C2D12', fontWeight: 600, flex: '1 1 280px' }}>
          Cet avis n’a pas encore été pris en charge. Le consulter ne le modifie pas : prenez-le en charge pour vous l’attribuer et le traiter.
        </p>
        <Button size="sm" loading={chargement} onClick={onPrendreEnCharge}>
          Prendre en charge
        </Button>
      </div>
    );
  }

  return (
    <div role="status" style={{ padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.82rem', color: '#475569', fontWeight: 600 }}>
      Cet avis n’a pas encore été pris en charge par le Responsable d’agence.
    </div>
  );
}
