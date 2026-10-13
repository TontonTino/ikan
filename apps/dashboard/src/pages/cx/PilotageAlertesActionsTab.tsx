import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { lienApercuAgence, lienAvis } from '../../utils/liensAgence';
import type { Agence, Alerte, AlerteFeedback } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import AgencyRecommendations, { type RecoAffichee } from '../../components/agency/AgencyRecommendations';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import IconButton from '../../components/ui/IconButton';
import Skeleton from '../../components/ui/Skeleton';
import { fullDate, relativeTime } from '../../components/ui/format';
import { ArrowUpRightIcon, RefreshIcon } from '../../components/common/Icons';
import { raisonLabel, alerteFeedbackAnchor, alerteSeuilAnchor } from '../../components/alerts/alerteLabels';
import BadgeGraviteAlerte from '../../components/alerts/BadgeGraviteAlerte';
import { libelleRecommandations } from '../../utils/sourceAnalyse';
import {
  AVIS_VISIBLES,
  avisCible,
  compterAlertes,
  filtrerAlertes,
  messageForfait,
  nombreAvisVisibles,
  tonAvis,
  type TypeAlerte,
} from './alertesVue';
import type { AlertesData, RecosData } from './AlertesView';
import type { EtatSource } from './alertesVue';

interface Props {
  isAgencyManager: boolean;
  alertes: EtatSource<AlertesData>;
  recos: EtatSource<RecosData>;
  recosLoadingMore: boolean;
  /** Nom du forfait sans alertes (lisible par le CX Manager uniquement). */
  nomForfait: string | null;
  agences: Agence[];
  selectedAgenceId: string | null;
  onSelectAgence: (id: string | null) => void;
  onRefresh: () => void;
  onRetryRecos: () => void;
  onLoadMoreRecos: () => void;
  onMarquerRecoTraitee: (id: string) => void;
}

const TYPES: Array<{ id: TypeAlerte; label: string }> = [
  { id: 'toutes', label: 'Toutes' },
  { id: 'seuil', label: 'Satisfaction' },
  { id: 'avis', label: 'Avis clients' },
];

/** Défile jusqu'à l'alerte ciblée par l'URL (#alerte-…), la met en évidence et lui donne le focus. */
function useHashTarget(ready: boolean, signature: string) {
  const { hash } = useLocation();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    setTarget(id);
    const t = window.setTimeout(() => setTarget(null), 2400);
    return () => window.clearTimeout(t);
  }, [ready, hash, signature]);
  return target;
}

export function LigneSeuil({ alerte, isAgencyManager, cible }: { alerte: Alerte; isAgencyManager: boolean; cible: boolean }) {
  const id = alerteSeuilAnchor(alerte.agence_id);
  return (
    <li id={id} tabIndex={-1} className={`agence-prio__item agence-prio__item--critical ui-alert-item${cible ? ' is-target' : ''}`}>
      <div className="agence-prio__main">
        <div className="agence-prio__head">
          <BadgeGraviteAlerte gravite={alerte.gravite} />
          <Badge variant={alerte.gravite ? 'outline' : 'critical'} label="Satisfaction sous le seuil" />
          <strong className="agence-prio__title">{alerte.agence_nom}</strong>
        </div>
        <p className="agence-prio__detail">
          <strong>{alerte.taux_actuel} %</strong> sur les 7 derniers jours, pour un seuil de {alerte.seuil} %
          {alerte.ecart_seuil != null && alerte.ecart_seuil > 0 ? ` (${alerte.ecart_seuil.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} points sous le seuil)` : ''}
        </p>
        <p className="siege-note">
          {isAgencyManager
            ? 'Disparaît quand la satisfaction des 7 derniers jours repasse au-dessus du seuil.'
            : 'Affichée après 48 h sous le seuil ; disparaît quand la satisfaction des 7 derniers jours repasse au-dessus.'}
        </p>
      </div>
      {isAgencyManager ? (
        <Link to="/statistiques" className="siege-link">Analyser la tendance<ArrowUpRightIcon size={13} aria-hidden="true" /></Link>
      ) : (
        <Link to={lienApercuAgence(alerte.agence_id)} className="siege-link">Voir l’agence<ArrowUpRightIcon size={13} aria-hidden="true" /></Link>
      )}
    </li>
  );
}

export function LigneAvis({ avis, isAgencyManager, cible }: { avis: AlerteFeedback; isAgencyManager: boolean; cible: boolean }) {
  const id = alerteFeedbackAnchor(avis.feedback_id);
  const ton = tonAvis(avis.note);
  return (
    <li id={id} tabIndex={-1} className={`agence-prio__item agence-prio__item--${ton} ui-alert-item${cible ? ' is-target' : ''}`}>
      <div className="agence-prio__main">
        <div className="agence-prio__head">
          <Badge variant={ton} label={`${raisonLabel(avis.raison)} · ${avis.note}/5`} />
          {!isAgencyManager && <strong className="agence-prio__title">{avis.agence_nom}</strong>}
          <time className="siege-note" dateTime={avis.date_soumission} title={fullDate(avis.date_soumission)}>
            {relativeTime(avis.date_soumission)}
          </time>
        </div>
        <p className={`agence-prio__detail agence-prio__detail--clamp${avis.commentaire ? '' : ' ui-item__text--empty'}`}>
          {avis.categorie_nom ? `Catégorie « ${avis.categorie_nom} » — ` : ''}
          {avis.commentaire || 'Aucun commentaire.'}
        </p>
        <p className="siege-note">Disparaît quand l’avis est marqué comme résolu.</p>
      </div>
      <Link to={lienAvis(isAgencyManager ? 'agency_manager' : 'cx_manager', avis.agence_id, 'critiques', { avisId: avis.feedback_id })} className="siege-link">
        Traiter l’avis<ArrowUpRightIcon size={13} aria-hidden="true" />
      </Link>
    </li>
  );
}

export default function PilotageAlertesActionsTab(props: Props) {
  const { isAgencyManager, alertes, recos, recosLoadingMore, nomForfait, agences, selectedAgenceId, onSelectAgence, onRefresh, onRetryRecos, onLoadMoreRecos, onMarquerRecoTraitee } = props;
  const [type, setType] = useState<TypeAlerte>('toutes');
  const [depliee, setDepliee] = useState(false);
  const { hash } = useLocation();

  const { seuil, avis, incluses } = alertes.donnees;
  const prete = alertes.charge;
  const target = useHashTarget(prete, `${seuil.length}-${avis.length}-${depliee}`);
  const cibleId = avisCible(hash);

  const compteurs = useMemo(() => compterAlertes(seuil, avis, selectedAgenceId), [seuil, avis, selectedAgenceId]);
  // Total sans filtre : sert à dire qu'un filtre masque des alertes existantes (jamais « aucune alerte » à tort).
  const totalGlobal = useMemo(() => compterAlertes(seuil, avis, null).total, [seuil, avis]);
  const filtrees = useMemo(() => filtrerAlertes({ seuil, avis, type, agenceId: selectedAgenceId }), [seuil, avis, type, selectedAgenceId]);
  const nbAvisVisibles = nombreAvisVisibles(filtrees.avis, depliee, cibleId);
  const avisVisibles = filtrees.avis.slice(0, nbAvisVisibles);
  const nbAffichees = filtrees.seuil.length + filtrees.avis.length;
  const filtreActif = type !== 'toutes' || !!selectedAgenceId;
  const forfait = messageForfait(nomForfait, !isAgencyManager);
  const chargement = alertes.statut === 'chargement' && !prete;
  const echecInitial = alertes.statut === 'erreur' && !prete;
  const actualisationEchouee = alertes.statut === 'erreur' && prete;
  const resetFiltres = () => { setType('toutes'); onSelectAgence(null); };

  const sousTitre = chargement
    ? 'Chargement…'
    : !prete || !incluses
      ? undefined
      : compteurs.total === 0
        ? undefined
        : `${compteurs.seuil} alerte${compteurs.seuil > 1 ? 's' : ''} de satisfaction · ${compteurs.avis} avis à risque dont ${compteurs.critiques} critique${compteurs.critiques > 1 ? 's' : ''} (note ≤ 2)`;

  return (
    <div className="agence">
      <Alert tone="info" title="Comment lire cette page">
        Les alertes sont recalculées à chaque ouverture : elles n’ont pas d’état « lu » ou « traité » et disparaissent d’elles-mêmes quand la situation redevient
        normale. Une alerte n’est pas un problème à traiter : c’est vous qui décidez d’en créer un.
      </Alert>

      <div className="alerte-toolbar">
        <div className="ui-segmented" role="group" aria-label="Type d'alerte">
          {TYPES.map((t) => (
            <button key={t.id} type="button" className="ui-segmented__item" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
              {t.label}{prete && incluses ? ` (${t.id === 'toutes' ? compteurs.total : t.id === 'seuil' ? compteurs.seuil : compteurs.avis})` : ''}
            </button>
          ))}
        </div>
        {!isAgencyManager && <AgenceFilterSelect agences={agences} selectedId={selectedAgenceId} onChange={onSelectAgence} label="Filtrer les alertes et recommandations par agence" />}
        <IconButton label="Actualiser les alertes" icon={<RefreshIcon size={16} />} onClick={onRefresh} />
      </div>

      <Card
        title="Alertes actives"
        subtitle={sousTitre}
        tone={prete && incluses && filtrees.seuil.length + filtrees.avis.filter((a) => tonAvis(a.note) === 'critical').length > 0 ? 'critical' : 'default'}
        aria-busy={chargement || undefined}
      >
        {actualisationEchouee && (
          <Alert tone="warning" title="Les alertes n’ont pas pu être actualisées : la liste affichée peut ne plus être à jour." action={<Button size="sm" variant="secondary" onClick={onRefresh}>Réessayer</Button>} />
        )}

        {chargement ? (
          <div className="agence-prio" role="status" aria-busy="true" aria-label="Chargement des alertes">
            {[0, 1, 2].map((i) => <Skeleton key={i} height={72} radius="var(--radius-md)" />)}
          </div>
        ) : echecInitial ? (
          <Alert tone="warning" title="Impossible de charger les alertes. Cela ne signifie pas qu’il n’y en a pas." action={<Button size="sm" variant="secondary" onClick={onRefresh}>Réessayer</Button>} />
        ) : !incluses ? (
          <Alert tone="warning" title={forfait.titre}>{forfait.detail}</Alert>
        ) : nbAffichees === 0 ? (
          <EmptyState
            compact
            illustration="no-alert"
            title={filtreActif && totalGlobal > 0 ? 'Aucune alerte pour ces filtres' : 'Aucune alerte active'}
            message={
              filtreActif && totalGlobal > 0
                ? `Il y a ${totalGlobal} alerte${totalGlobal > 1 ? 's' : ''} au total : élargissez le type ou l’agence pour les voir.`
                : isAgencyManager
                  ? 'Votre agence maintient un taux de satisfaction supérieur à son seuil et aucun avis ne déclenche d’alerte.'
                  : 'Aucune agence du réseau ne déclenche d’alerte pour le moment.'
            }
            action={filtreActif ? { label: 'Réinitialiser les filtres', onClick: resetFiltres } : undefined}
          />
        ) : (
          <>
            {filtrees.seuil.length > 0 && (
              <section aria-label="Alertes de satisfaction">
                <h3 className="agence-group-title">Satisfaction sous le seuil ({filtrees.seuil.length})</h3>
                <ul className="agence-prio">
                  {filtrees.seuil.map((a) => <LigneSeuil key={a.agence_id} alerte={a} isAgencyManager={isAgencyManager} cible={target === alerteSeuilAnchor(a.agence_id)} />)}
                </ul>
              </section>
            )}
            {filtrees.avis.length > 0 && (
              <section aria-label="Avis à risque">
                <h3 className="agence-group-title">Avis à risque ({filtrees.avis.length}) · critiques d’abord, puis du plus récent au plus ancien</h3>
                <ul className="agence-prio">
                  {avisVisibles.map((a) => <LigneAvis key={a.feedback_id} avis={a} isAgencyManager={isAgencyManager} cible={target === alerteFeedbackAnchor(a.feedback_id)} />)}
                </ul>
                <p className="siege-note" role="status">
                  {avisVisibles.length} avis affichés sur {filtrees.avis.length}.
                </p>
                {filtrees.avis.length > AVIS_VISIBLES && (
                  <Button className="agence-more" size="sm" variant="ghost" aria-expanded={nbAvisVisibles === filtrees.avis.length} onClick={() => setDepliee((v) => !v)}>
                    {nbAvisVisibles === filtrees.avis.length ? 'Réduire la liste' : `Afficher les ${filtrees.avis.length - AVIS_VISIBLES} autres avis`}
                  </Button>
                )}
              </section>
            )}
          </>
        )}
      </Card>

      <AgencyRecommendations
        titre={libelleRecommandations(recos.donnees.items)}
        recos={recos.donnees.items}
        total={recos.donnees.total}
        loadFailed={recos.statut === 'erreur'}
        loading={recos.statut === 'chargement'}
        loadingMore={recosLoadingMore}
        actionsEnCours={0}
        afficherLienActions={false}
        onMarquerTraitee={onMarquerRecoTraitee}
        onLoadMore={onLoadMoreRecos}
        onRetry={onRetryRecos}
      />
    </div>
  );
}
