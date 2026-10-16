import React, { useCallback, useEffect, useState } from 'react';
import { recommandationsApi } from '../../services/api';
import type { RecommandationsAgenceGroupe, RecommandationsGroupees } from '../../types';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { PRIORITE_RECO_LABEL, PRIORITE_RECO_TON } from './agenceVue';

/*
 * Recommandations IA regroupées par agence (CX-09) : nom de l'agence, nombre dans l'état affiché, la plus ancienne, et dépliage vers
 * les recommandations. Le statut est réversible : « à traiter » ⇄ « traitée ». La vue à plat reste disponible (bascule).
 */

const dateCourte = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

export const libelleNombre = (n: number, traitee: boolean) =>
  traitee ? `${n} traitée${n > 1 ? 's' : ''}` : `${n} à traiter`;

export function GroupeAgence({
  groupe, traitee, onChangerStatut, occupee,
}: { groupe: RecommandationsAgenceGroupe; traitee: boolean; onChangerStatut: (id: string) => void; occupee: string | null }) {
  const reste = groupe.nombre - groupe.recommandations.length;
  return (
    <details className="agence-reco-groupe">
      <summary>
        <strong>{groupe.agence_nom}</strong> — {libelleNombre(groupe.nombre, traitee)} · la plus ancienne : {dateCourte(groupe.plus_ancienne)}
      </summary>
      <ul className="agence-reco-group">
        {groupe.recommandations.map((r) => (
          <li key={r.id} className="agence-reco">
            <div className="agence-reco__main">
              <div className="agence-reco__meta">
                <Badge variant={PRIORITE_RECO_TON[r.priorite] ?? 'neutral'} label={`Priorité ${(PRIORITE_RECO_LABEL[r.priorite] ?? String(r.priorite)).toLowerCase()}`} />
                <time dateTime={r.date_generation}>{dateCourte(r.date_generation)}</time>
                <span>{traitee ? 'Traitée' : 'À traiter'}</span>
              </div>
              <p className="agence-reco__text">{r.contenu}</p>
            </div>
            <Button size="sm" variant="secondary" loading={occupee === r.id} onClick={() => onChangerStatut(r.id)}
              aria-label={`${traitee ? 'Remettre à traiter' : 'Marquer comme traitée'} : ${r.contenu.slice(0, 80)}`}>
              {traitee ? 'Remettre à traiter' : 'Marquer comme traitée'}
            </Button>
          </li>
        ))}
      </ul>
      {reste > 0 && <p className="siege-note">{reste} autre{reste > 1 ? 's' : ''} non affichée{reste > 1 ? 's' : ''} : traitez d’abord les plus prioritaires.</p>}
    </details>
  );
}

export default function RecommandationsParAgence({ agenceId, onModifiee }: { agenceId?: string | null; onModifiee?: () => void }) {
  const [traitee, setTraitee] = useState(false);
  const [donnees, setDonnees] = useState<RecommandationsGroupees | null>(null);
  const [erreur, setErreur] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [occupee, setOccupee] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState(false);

  const charger = useCallback(() => {
    let annule = false;
    setChargement(true);
    setErreur(false);
    recommandationsApi.groupees({ traitee, ...(agenceId ? { agence_id: agenceId } : {}) })
      .then((res) => { if (!annule) setDonnees(res.data); })
      .catch(() => { if (!annule) { setDonnees(null); setErreur(true); } })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [traitee, agenceId]);

  useEffect(() => charger(), [charger]);

  const changerStatut = async (id: string) => {
    setOccupee(id);
    setErreurAction(false);
    try {
      await (traitee ? recommandationsApi.rouvrir(id) : recommandationsApi.marquerTraitee(id));
      charger();
      onModifiee?.();
    } catch {
      setErreurAction(true);
    } finally {
      setOccupee(null);
    }
  };

  return (
    <div>
      <div role="group" aria-label="État des recommandations" style={{ display: 'flex', gap: 'var(--space-2)', margin: '0 0 var(--space-3)' }}>
        <Button size="sm" variant={traitee ? 'secondary' : 'primary'} aria-pressed={!traitee} onClick={() => setTraitee(false)}>À traiter</Button>
        <Button size="sm" variant={traitee ? 'primary' : 'secondary'} aria-pressed={traitee} onClick={() => setTraitee(true)}>Traitées</Button>
      </div>
      {erreurAction && <Alert tone="warning" title="Le changement de statut n’a pas pu être enregistré. Réessayez." />}
      {chargement && !donnees ? (
        <p role="status" className="siege-note">Chargement des recommandations…</p>
      ) : erreur ? (
        <Alert tone="warning" title="Impossible de charger les recommandations par agence. Cela ne signifie pas qu’il n’y en a pas."
          action={<Button size="sm" variant="secondary" onClick={charger}>Réessayer</Button>} />
      ) : donnees && donnees.groupes.length === 0 ? (
        <EmptyState compact illustration="no-alert" title={traitee ? 'Aucune recommandation traitée' : 'Aucune agence avec des recommandations à traiter'} message="Cela ne confirme pas que les problèmes sont résolus." />
      ) : (
        <>
          <p className="siege-note">{donnees?.groupes.length} agence{(donnees?.groupes.length ?? 0) > 1 ? 's' : ''} · {donnees ? libelleNombre(donnees.total, traitee) : ''}. L’agence la plus chargée est en premier.</p>
          {donnees?.groupes.map((g) => <GroupeAgence key={g.agence_id} groupe={g} traitee={traitee} onChangerStatut={changerStatut} occupee={occupee} />)}
        </>
      )}
    </div>
  );
}
