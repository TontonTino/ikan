import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { lienApercuAgence, lienAvis } from '../../utils/liensAgence';
import type { Agence, Alerte, AlerteFeedback } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import AgencyRecommendations, { type RecoAffichee } from '../../components/agency/AgencyRecommendations';
import RecommandationsParAgence from '../../components/agency/RecommandationsParAgence';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import IconButton from '../../components/ui/IconButton';
import Skeleton from '../../components/ui/Skeleton';
import { dateRelativeOuAbsolue, fullDate } from '../../components/ui/format';
import { ArrowUpRightIcon, CheckIcon, FilterIcon, RefreshIcon, TargetIcon } from '../../components/common/Icons';
import { raisonLabel, alerteFeedbackAnchor, alerteSeuilAnchor, libelleStatutAvis } from '../../components/alerts/alerteLabels';
import BadgeGraviteAlerte from '../../components/alerts/BadgeGraviteAlerte';
import BadgeNiveauAvis from '../../components/alerts/BadgeNiveauAvis';
import { libelleRecommandations } from '../../utils/sourceAnalyse';
import {
  AVIS_VISIBLES,
  avisCible,
  compterAlertes,
  filtrerAlertes,
  libelleVoirAvis,
  messageForfait,
  noteTriAvis,
  nombreAvisVisibles,
  decouperChiffres,
  partiesSynthese,
  phraseAgencesConcernees,
  syntheseAlertes,
  tonAvis,
  type TypeAlerte,
} from './alertesVue';
import type { AlertesData, RecosData } from './AlertesView';
import type { EtatSource } from './alertesVue';
import { formaterPourcentage } from '../../utils/formatNombre';

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

/** Texte dont les nombres sont mis en valeur (<b>) : le texte lu, copié ou annoncé reste identique. */
const avecChiffres = (texte: string) =>
  decouperChiffres(texte).map((m, i) => (m.nombre ? <b key={i} className="alerte-synthese__n">{m.texte}</b> : <React.Fragment key={i}>{m.texte}</React.Fragment>));

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

/** Action de la ligne : un vrai bouton (secondaire) plutôt qu'un lien de texte, pour qu'elle soit identifiable d'un coup d'œil. */
const CLASSE_ACTION = 'ui-btn ui-btn--secondary ui-btn--sm alerte-ligne__action';

/**
 * Ordre de lecture (et du DOM, donc des lecteurs d'écran) : 1) agence (et date) ; 2) niveau ; 3) raison ; 4) informations complémentaires,
 * en discret ; 5) action. L'agence est comprise avant les indicateurs ; une seule pastille (le niveau), la raison est du texte.
 */
export function LigneSeuil({ alerte, isAgencyManager, cible }: { alerte: Alerte; isAgencyManager: boolean; cible: boolean }) {
  const id = alerteSeuilAnchor(alerte.agence_id);
  return (
    <li id={id} tabIndex={-1} className={`alerte-ligne ui-alert-item${cible ? ' is-target' : ''}`}>
      <div className="alerte-ligne__corps">
        <div className="alerte-ligne__qui">
          <strong className="alerte-ligne__agence">{alerte.agence_nom}</strong>
        </div>
        <div className="alerte-ligne__niveau">
          <BadgeGraviteAlerte gravite={alerte.gravite} />
          <span className="alerte-ligne__raison">Satisfaction sous le seuil</span>
        </div>
        <p className="alerte-ligne__detail">
          <strong>{formaterPourcentage(alerte.taux_actuel)}</strong> sur les 7 derniers jours, pour un seuil de {formaterPourcentage(alerte.seuil)}
          {alerte.ecart_seuil != null && alerte.ecart_seuil > 0 ? ` (${alerte.ecart_seuil.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} points sous le seuil)` : ''}
        </p>
      </div>
      {isAgencyManager ? (
        <Link to="/statistiques" className={CLASSE_ACTION}>Analyser la tendance<ArrowUpRightIcon size={13} aria-hidden="true" /></Link>
      ) : (
        <Link to={lienApercuAgence(alerte.agence_id)} className={CLASSE_ACTION}>Voir l’agence<ArrowUpRightIcon size={13} aria-hidden="true" /></Link>
      )}
    </li>
  );
}

export function LigneAvis({ avis, isAgencyManager, cible }: { avis: AlerteFeedback; isAgencyManager: boolean; cible: boolean }) {
  const id = alerteFeedbackAnchor(avis.feedback_id);
  const statut = libelleStatutAvis(avis.statut_traitement);
  return (
    <li id={id} tabIndex={-1} className={`alerte-ligne ui-alert-item${cible ? ' is-target' : ''}`}>
      <div className="alerte-ligne__corps">
        <div className="alerte-ligne__qui">
          {!isAgencyManager && <strong className="alerte-ligne__agence">{avis.agence_nom}</strong>}
          <time className="alerte-ligne__date" dateTime={avis.date_soumission} title={fullDate(avis.date_soumission)}>
            {dateRelativeOuAbsolue(avis.date_soumission)}
          </time>
        </div>
        <div className="alerte-ligne__niveau">
          <BadgeNiveauAvis note={avis.note} />
          <span className="alerte-ligne__raison">{raisonLabel(avis.raison)}</span>
        </div>
        <p className="alerte-ligne__meta">
          {avis.categorie_nom ? `Catégorie « ${avis.categorie_nom} » · ` : ''}Note {avis.note}/5
          {statut && (
            <>
              {' · '}
              <span className="alerte-ligne__statut">
                {avis.statut_traitement === 'en_cours' ? <TargetIcon size={13} aria-hidden="true" /> : <CheckIcon size={13} aria-hidden="true" />}
                {statut}
              </span>
            </>
          )}
        </p>
        <p className={`alerte-ligne__detail alerte-ligne__detail--clamp${avis.commentaire ? '' : ' ui-item__text--empty'}`}>{avis.commentaire || 'Aucun commentaire.'}</p>
      </div>
      <Link to={lienAvis(isAgencyManager ? 'agency_manager' : 'cx_manager', avis.agence_id, 'critiques', { avisId: avis.feedback_id })} className={CLASSE_ACTION}>
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
  const synthese = useMemo(() => syntheseAlertes({ seuil, avis, agenceId: selectedAgenceId, cx: !isAgencyManager }), [seuil, avis, selectedAgenceId, isAgencyManager]);
  const nbAvisVisibles = nombreAvisVisibles(filtrees.avis, depliee, cibleId);
  const avisVisibles = filtrees.avis.slice(0, nbAvisVisibles);
  const nbAffichees = filtrees.seuil.length + filtrees.avis.length;
  const filtreActif = type !== 'toutes' || !!selectedAgenceId;
  const forfait = messageForfait(nomForfait, !isAgencyManager);
  const chargement = alertes.statut === 'chargement' && !prete;
  const echecInitial = alertes.statut === 'erreur' && !prete;
  const actualisationEchouee = alertes.statut === 'erreur' && prete;
  const resetFiltres = () => { setType('toutes'); onSelectAgence(null); };

  return (
    <div className="agence">
      {prete && incluses && synthese && (
        <p className="alerte-synthese">
          <span className="alerte-synthese__titre">{avecChiffres(partiesSynthese(synthese).titre)} :</span>{' '}
          <span className="alerte-synthese__detail">{avecChiffres(partiesSynthese(synthese).detail)}</span>
          {phraseAgencesConcernees(synthese) && <span className="alerte-synthese__plus">{avecChiffres(phraseAgencesConcernees(synthese) ?? '')}</span>}
          {synthese.avisLePlusAncien && <span className="alerte-synthese__plus">Avis le plus ancien : <time dateTime={synthese.avisLePlusAncien} title={fullDate(synthese.avisLePlusAncien)}>{dateRelativeOuAbsolue(synthese.avisLePlusAncien)}</time></span>}
        </p>
      )}

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
        className="alerte-carte"
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
            illustration={filtreActif && totalGlobal > 0 ? <span className="alerte-vide-filtre"><FilterIcon size={30} /></span> : 'no-alert'}
            title={filtreActif && totalGlobal > 0 ? 'Aucune alerte pour ces filtres' : 'Aucune alerte active'}
            message={
              filtreActif && totalGlobal > 0
                ? `Ces filtres masquent les alertes : il y a ${totalGlobal} alerte${totalGlobal > 1 ? 's' : ''} au total. Élargissez le type ou l’agence pour les voir.`
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
                <h3 className="alerte-groupe-titre">Satisfaction sous le seuil ({filtrees.seuil.length})</h3>
                <p className="siege-note">
                  {isAgencyManager
                    ? 'Chaque alerte disparaît quand la satisfaction des 7 derniers jours repasse au-dessus du seuil.'
                    : 'Chaque alerte est affichée après 48 h sous le seuil ; elle disparaît quand la satisfaction des 7 derniers jours repasse au-dessus.'}
                </p>
                <ul className="agence-prio alerte-liste">
                  {filtrees.seuil.map((a) => <LigneSeuil key={a.agence_id} alerte={a} isAgencyManager={isAgencyManager} cible={target === alerteSeuilAnchor(a.agence_id)} />)}
                </ul>
              </section>
            )}
            {filtrees.avis.length > 0 && (
              <section aria-label="Avis à risque">
                <h3 className="alerte-groupe-titre">Avis à risque ({filtrees.avis.length})</h3>
                <p className="siege-note">{noteTriAvis(filtrees.avis) ? `${noteTriAvis(filtrees.avis)} ` : ''}Chaque alerte disparaît quand l’avis est marqué comme résolu.</p>
                <ul className="agence-prio alerte-liste">
                  {avisVisibles.map((a) => <LigneAvis key={a.feedback_id} avis={a} isAgencyManager={isAgencyManager} cible={target === alerteFeedbackAnchor(a.feedback_id)} />)}
                </ul>
                <div className="alerte-pied">
                  {filtrees.avis.length > AVIS_VISIBLES && (
                    <Button className="alerte-voir-plus" variant="secondary" aria-expanded={nbAvisVisibles === filtrees.avis.length} onClick={() => setDepliee((v) => !v)}>
                      {libelleVoirAvis(filtrees.avis.length, nbAvisVisibles === filtrees.avis.length)}
                    </Button>
                  )}
                  <p className="siege-note" role="status">
                    {avisVisibles.length} avis affichés sur {filtrees.avis.length}
                  </p>
                </div>
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
        vueGroupee={!isAgencyManager ? <RecommandationsParAgence agenceId={selectedAgenceId} onModifiee={onRetryRecos} /> : undefined}
      />
    </div>
  );
}
