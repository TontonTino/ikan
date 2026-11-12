import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { lienApercuAgence } from '../../utils/liensAgence';
import type { Agence, Alerte } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import IconButton from '../../components/ui/IconButton';
import Skeleton from '../../components/ui/Skeleton';
import { ArrowUpRightIcon, FilterIcon, RefreshIcon } from '../../components/common/Icons';
import { alerteSeuilAnchor } from '../../components/alerts/alerteLabels';
import BadgeGraviteAlerte from '../../components/alerts/BadgeGraviteAlerte';
import SuiviEpisode, { PastilleEtatEpisode } from '../../components/alerts/EtatEpisode';
import { episodeDeAlerte, peutPrendreEnCharge } from '../../utils/episodesAlertes';
import {
  compterAlertes,
  filtrerAlertes,
  messageForfait,
  decouperChiffres,
  partiesSynthese,
  phraseAgencesConcernees,
  syntheseAlertes,
} from './alertesVue';
import type { AlertesData } from './AlertesView';
import type { EtatSource } from './alertesVue';
import { formaterNombre, formaterPourcentage } from '../../utils/formatNombre';
import { LIEN_FILE_A_TRAITER } from '../../utils/fileATraiter';

interface Props {
  isAgencyManager: boolean;
  alertes: EtatSource<AlertesData>;
  /** Nom du forfait sans alertes (lisible par le CX Manager uniquement). */
  nomForfait: string | null;
  agences: Agence[];
  selectedAgenceId: string | null;
  onSelectAgence: (id: string | null) => void;
  onRefresh: () => void;
  /** Agency Manager : ouvre la prise en charge d'une alerte détectée. Absent : aucun bouton (le CX Manager consulte seulement). */
  onPrendreEnCharge?: (alerte: Alerte) => void;
  /** « Historique des alertes » (repliée), affichée sous la liste des alertes actives. */
  historique?: React.ReactNode;
  /** Nombre d'avis de la file « À traiter » (même périmètre d'agence) ; null = inconnu (chargement ou erreur). */
  avisATraiter?: number | null;
}


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
export function LigneSeuil({ alerte, isAgencyManager, cible, onPrendreEnCharge }: { alerte: Alerte; isAgencyManager: boolean; cible: boolean; onPrendreEnCharge?: (alerte: Alerte) => void }) {
  const id = alerteSeuilAnchor(alerte.agence_id);
  const episode = episodeDeAlerte(alerte);
  const prendre = onPrendreEnCharge && peutPrendreEnCharge(alerte, isAgencyManager);
  return (
    <li id={id} tabIndex={-1} className={`alerte-ligne ui-alert-item${cible ? ' is-target' : ''}`}>
      <div className="alerte-ligne__corps">
        <div className="alerte-ligne__qui">
          <strong className="alerte-ligne__agence">{alerte.agence_nom}</strong>
          {episode && <PastilleEtatEpisode statut={episode.statut} />}
        </div>
        <div className="alerte-ligne__niveau">
          <BadgeGraviteAlerte gravite={alerte.gravite} />
          <span className="alerte-ligne__raison">Satisfaction sous le seuil</span>
        </div>
        <p className="alerte-ligne__detail">
          <strong>{formaterPourcentage(alerte.taux_actuel)}</strong> sur les 7 derniers jours, pour un seuil de {formaterPourcentage(alerte.seuil)}
          {alerte.ecart_seuil != null && alerte.ecart_seuil > 0 ? ` (${alerte.ecart_seuil.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} points sous le seuil)` : ''}
        </p>
        {episode && <SuiviEpisode episode={episode} />}
      </div>
      <div className="alerte-ligne__actions">
        {prendre && (
          <Button variant="primary" size="sm" className="alerte-ligne__prendre" onClick={() => onPrendreEnCharge(alerte)} aria-label={`Prendre en charge l’alerte de ${alerte.agence_nom}`} aria-haspopup="dialog">
            Prendre en charge
          </Button>
        )}
        {isAgencyManager ? (
          <Link to="/statistiques" className={CLASSE_ACTION}>Analyser la tendance<ArrowUpRightIcon size={13} aria-hidden="true" /></Link>
        ) : (
          <Link to={lienApercuAgence(alerte.agence_id)} className={CLASSE_ACTION}>Voir l’agence<ArrowUpRightIcon size={13} aria-hidden="true" /></Link>
        )}
      </div>
    </li>
  );
}

export default function PilotageAlertesActionsTab(props: Props) {
  const { isAgencyManager, alertes, nomForfait, agences, selectedAgenceId, onSelectAgence, onRefresh, onPrendreEnCharge, historique, avisATraiter = null } = props;

  // La page Alertes ne garde que les alertes de seuil (lot 3) : les avis à risque sont dans la file « À traiter » de la page Avis.
  const { seuil, incluses } = alertes.donnees;
  const prete = alertes.charge;
  const target = useHashTarget(prete, `${seuil.length}`);

  const compteurs = useMemo(() => compterAlertes(seuil, [], selectedAgenceId), [seuil, selectedAgenceId]);
  // Total sans filtre : sert à dire qu'un filtre masque des alertes existantes (jamais « aucune alerte » à tort).
  const totalGlobal = useMemo(() => compterAlertes(seuil, [], null).total, [seuil]);
  const filtrees = useMemo(() => filtrerAlertes({ seuil, avis: [], type: 'seuil', agenceId: selectedAgenceId }), [seuil, selectedAgenceId]);
  const synthese = useMemo(() => syntheseAlertes({ seuil, avis: [], agenceId: selectedAgenceId, cx: !isAgencyManager }), [seuil, selectedAgenceId, isAgencyManager]);
  const nbAffichees = filtrees.seuil.length;
  const filtreActif = !!selectedAgenceId;
  const forfait = messageForfait(nomForfait, !isAgencyManager);
  const chargement = alertes.statut === 'chargement' && !prete;
  const echecInitial = alertes.statut === 'erreur' && !prete;
  const actualisationEchouee = alertes.statut === 'erreur' && prete;
  const resetFiltres = () => onSelectAgence(null);
  const lienFile = `${LIEN_FILE_A_TRAITER}${selectedAgenceId && !isAgencyManager ? `&agence=${encodeURIComponent(selectedAgenceId)}` : ''}`;

  return (
    <div className="agence">
      {prete && incluses && synthese && (
        <p className="alerte-synthese">
          <span className="alerte-synthese__titre">{avecChiffres(partiesSynthese(synthese).titre)} :</span>{' '}
          <span className="alerte-synthese__detail">{avecChiffres(partiesSynthese(synthese).detail)}</span>
          {phraseAgencesConcernees(synthese) && <span className="alerte-synthese__plus">{avecChiffres(phraseAgencesConcernees(synthese) ?? '')}</span>}
        </p>
      )}

      <div className="alerte-toolbar">
        {!isAgencyManager && <AgenceFilterSelect agences={agences} selectedId={selectedAgenceId} onChange={onSelectAgence} label="Filtrer les alertes par agence" />}
        <IconButton label="Actualiser les alertes" icon={<RefreshIcon size={16} />} onClick={onRefresh} />
      </div>

      {/* Renvoi vers LA file d'avis (même compteur que l'onglet « À traiter » et que la cloche). */}
      <p className="alerte-renvoi-file">
        <span>
          {avisATraiter === null
            ? 'Les avis qui demandent un geste sont dans la file « À traiter » de la page Avis.'
            : <>{avecChiffres(`${formaterNombre(avisATraiter, 0)} avis à traiter`)}{' '}dans la page Avis{avisATraiter === 0 ? ' : rien en attente.' : '.'}</>}
        </span>
        <Link to={lienFile} className={CLASSE_ACTION}>Voir les avis à traiter<ArrowUpRightIcon size={13} aria-hidden="true" /></Link>
      </p>

      <Card
        title="Alertes de satisfaction"
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
            title={filtreActif && totalGlobal > 0 ? 'Aucune alerte pour cette agence' : 'Aucune alerte active'}
            message={
              filtreActif && totalGlobal > 0
                ? `Ce filtre masque les alertes : il y a ${totalGlobal} alerte${totalGlobal > 1 ? 's' : ''} au total. Choisissez « Toutes les agences » pour les voir.`
                : isAgencyManager
                  ? 'Votre agence maintient un taux de satisfaction supérieur à son seuil.'
                  : 'Aucune agence du réseau n’est sous son seuil de satisfaction pour le moment.'
            }
            action={filtreActif ? { label: 'Réinitialiser le filtre', onClick: resetFiltres } : undefined}
          />
        ) : (
          <section aria-label="Alertes de satisfaction">
            <h3 className="alerte-groupe-titre">Satisfaction sous le seuil ({compteurs.seuil})</h3>
            <p className="siege-note">
              {isAgencyManager
                ? 'Chaque alerte disparaît quand la satisfaction des 7 derniers jours repasse au-dessus du seuil.'
                : 'Chaque alerte est affichée après 48 h sous le seuil ; elle disparaît quand la satisfaction des 7 derniers jours repasse au-dessus.'}
            </p>
            <ul className="agence-prio alerte-liste">
              {filtrees.seuil.map((a) => <LigneSeuil key={a.agence_id} alerte={a} isAgencyManager={isAgencyManager} cible={target === alerteSeuilAnchor(a.agence_id)} onPrendreEnCharge={onPrendreEnCharge} />)}
            </ul>
          </section>
        )}
      </Card>

      {historique}
    </div>
  );
}
