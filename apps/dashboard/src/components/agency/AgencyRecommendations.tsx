import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Recommandation } from '../../types';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import { ArrowUpRightIcon, CheckIcon } from '../common/Icons';
import { PRIORITE_RECO_LABEL, PRIORITE_RECO_TON, grouperRecommandations, trierRecommandations } from './agenceVue';

/** Recommandations visibles d'emblée : les plus prioritaires. Les autres se dépliaient en une longue pile : elles sont groupées. */
export const RECOMMANDATIONS_VISIBLES = 3;

/** Recommandation, avec l'agence concernée quand la liste couvre plusieurs agences (vue réseau du CX Manager). */
export type RecoAffichee = Recommandation & { agence_nom?: string | null };

const dateCourte = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

export function RecoLigne({ reco, onMarquerTraitee }: { reco: RecoAffichee; onMarquerTraitee: (id: string) => void }) {
  return (
    <li className="agence-reco">
      <div className="agence-reco__main">
        <div className="agence-reco__meta">
          <Badge variant={PRIORITE_RECO_TON[reco.priorite] ?? 'neutral'} label={`Priorité ${(PRIORITE_RECO_LABEL[reco.priorite] ?? String(reco.priorite)).toLowerCase()}`} />
          {reco.agence_nom && <strong>{reco.agence_nom}</strong>}
          <time dateTime={reco.date_generation}>{dateCourte(reco.date_generation)}</time>
          <span>En attente</span>
        </div>
        <p className="agence-reco__text">{reco.contenu}</p>
      </div>
      <Button size="sm" variant="secondary" icon={<CheckIcon size={14} />} onClick={() => onMarquerTraitee(reco.id)} aria-label={`Marquer comme traitée : ${reco.contenu.slice(0, 80)}`}>
        Marquer comme traitée
      </Button>
    </li>
  );
}

function Resume({ recos }: { recos: RecoAffichee[] }) {
  const groupes = grouperRecommandations(recos);
  return (
    <p className="siege-note">
      {recos.length} chargée{recos.length > 1 ? 's' : ''} : {groupes.map((g) => `${g.items.length} de priorité ${g.label.toLowerCase()}`).join(' · ')}
    </p>
  );
}

interface Props {
  recos: RecoAffichee[];
  total: number;
  loadFailed: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** Actions à mener réellement décidées et en cours (notion distincte d'une recommandation). */
  actionsEnCours: number;
  onMarquerTraitee: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Titre de la carte (défaut : « Recommandations en attente »). */
  titre?: string;
  /** Affiche le lien « N actions à mener en cours » (défaut : oui). */
  afficherLienActions?: boolean;
  /** Vue regroupée par agence (CX Manager) : si fournie, une bascule « Vue à plat / Par agence » apparaît ; la vue à plat reste la vue par défaut. */
  vueGroupee?: React.ReactNode;
}

export default function AgencyRecommendations({
  recos, total, loadFailed, loading, loadingMore, actionsEnCours, onMarquerTraitee, onLoadMore, onRetry,
  titre = 'Recommandations en attente', afficherLienActions = true, vueGroupee,
}: Props) {
  const [toutes, setToutes] = useState(false);
  const [vue, setVue] = useState<'plat' | 'agence'>('plat');
  const triees = trierRecommandations(recos);
  const visibles = triees.slice(0, RECOMMANDATIONS_VISIBLES);
  const reste = recos.length - visibles.length;

  return (
    <Card
      title={`${titre}${loadFailed || loading ? '' : ` (${total})`}`}
      subtitle="Pistes d’action suggérées automatiquement à partir des avis. Une recommandation n’est pas une action exécutée : marquer comme traitée enregistre seulement que vous l’avez prise en compte."
      actions={
        afficherLienActions ? (
          <Link to="/actions" className="siege-link">
            {actionsEnCours} action{actionsEnCours !== 1 ? 's' : ''} à mener en cours
            <ArrowUpRightIcon size={13} aria-hidden="true" />
          </Link>
        ) : undefined
      }
    >
      {vueGroupee && (
        <div role="group" aria-label="Présentation des recommandations" style={{ display: 'flex', gap: 'var(--space-2)', margin: '0 0 var(--space-3)' }}>
          <Button size="sm" variant={vue === 'plat' ? 'primary' : 'secondary'} aria-pressed={vue === 'plat'} onClick={() => setVue('plat')}>Vue à plat</Button>
          <Button size="sm" variant={vue === 'agence' ? 'primary' : 'secondary'} aria-pressed={vue === 'agence'} onClick={() => setVue('agence')}>Par agence</Button>
        </div>
      )}
      {vue === 'agence' && vueGroupee ? vueGroupee : loadFailed && recos.length === 0 ? (
        <Alert
          tone="warning"
          title="Impossible de charger les recommandations. Cela ne signifie pas qu’il n’y en a pas."
          action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>}
        />
      ) : loading && recos.length === 0 ? (
        <p role="status" className="siege-note">Chargement des recommandations…</p>
      ) : recos.length === 0 ? (
        <EmptyState
          compact
          illustration="no-alert"
          title="Aucune recommandation en attente"
          message="Cela ne confirme pas que les problèmes sont résolus."
        />
      ) : (
        <>
          {loadFailed && (
            <Alert tone="warning" title="Les recommandations n’ont pas pu être actualisées : la liste affichée peut être incomplète." action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>} />
          )}
          <Resume recos={recos} />
          {toutes ? (
            grouperRecommandations(recos).map((g) => (
              <section key={g.priorite} aria-label={`Priorité ${g.label.toLowerCase()}`}>
                <h3 className="agence-group-title">Priorité {g.label.toLowerCase()} ({g.items.length})</h3>
                <ul className="agence-reco-group">
                  {g.items.map((r) => <RecoLigne key={r.id} reco={r} onMarquerTraitee={onMarquerTraitee} />)}
                </ul>
              </section>
            ))
          ) : (
            <ul className="agence-reco-group" aria-label="Recommandations les plus prioritaires">
              {visibles.map((r) => <RecoLigne key={r.id} reco={r} onMarquerTraitee={onMarquerTraitee} />)}
            </ul>
          )}
          {(reste > 0 || toutes) && recos.length > RECOMMANDATIONS_VISIBLES && (
            <Button className="agence-more" size="sm" variant="ghost" aria-expanded={toutes} onClick={() => setToutes((v) => !v)}>
              {toutes ? 'Réduire la liste' : `Voir les ${reste} autre${reste > 1 ? 's' : ''}, groupées par priorité`}
            </Button>
          )}
          {recos.length < total && (
            <Button className="agence-more" size="sm" variant="secondary" loading={loadingMore} onClick={onLoadMore}>
              Charger les suivantes ({recos.length}/{total})
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
