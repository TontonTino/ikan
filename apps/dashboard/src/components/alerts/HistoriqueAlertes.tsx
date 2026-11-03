import React, { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import axios from 'axios';
import YamEtatVide from '../agent/YamEtatVide';
import AgenceFilterSelect from '../stats/AgenceFilterSelect';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Drawer from '../ui/Drawer';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import { fullDate } from '../ui/format';
import { ChevronDownIcon, FilterIcon } from '../common/Icons';
import { YAM_PRESENCE } from '../../config';
import { alertesApi } from '../../services/api';
import type { Agence, EpisodeDetail, EpisodeHistorique } from '../../types';
import { formaterNombre, formaterPourcentage } from '../../utils/formatNombre';
import { userFacingError } from '../../utils/userFacingError';
import {
  FILTRES_INITIAUX,
  OPTIONS_PERIODE,
  OPTIONS_STATUT,
  explicationCauseFin,
  filtresActifs,
  formaterDelaiExact,
  historiqueInitial,
  historiqueReducer,
  libelleCauseFin,
  parametresHistorique,
  prefixeDebut,
  segmentsPeriode,
  valeurDuree,
  phraseDuree,
  type EtatHistorique,
  type FiltrePeriode,
  type FiltreStatut,
  type FiltresHistorique,
} from '../../utils/episodesAlertes';
import BadgeGraviteAlerte from './BadgeGraviteAlerte';
import { PastilleEtatEpisode } from './EtatEpisode';

// ── Ligne de l'historique ──────────────────────────────────────────────────────────────────────────

/** La période d'un épisode en texte, avec chaque date dans <time> (date complète au survol). */
export function PeriodeEpisode({ episode, maintenant }: { episode: EpisodeHistorique; maintenant?: Date }) {
  return (
    <>
      {segmentsPeriode(episode, maintenant).map((s, i) =>
        s.iso ? <time key={i} dateTime={s.iso} title={fullDate(s.iso)}>{s.texte}</time> : <React.Fragment key={i}>{s.texte}</React.Fragment>,
      )}
    </>
  );
}

export function LigneHistorique({ episode, agencePropre, onDetail, maintenant }: { episode: EpisodeHistorique; agencePropre: boolean; onDetail: (id: string) => void; maintenant?: Date }) {
  const cause = episode.statut === 'terminee' ? libelleCauseFin(episode.fin_cause) : null;
  return (
    <li className="alerte-ligne alerte-histo__ligne">
      <div className="alerte-ligne__corps">
        <div className="alerte-ligne__qui">
          {!agencePropre && <strong className="alerte-ligne__agence">{episode.agence_nom}</strong>}
          <PastilleEtatEpisode statut={episode.statut} />
          {cause && <span className="alerte-histo__cause">{cause}</span>}
        </div>
        <p className="alerte-ligne__detail"><PeriodeEpisode episode={episode} maintenant={maintenant} /></p>
        <p className="alerte-ligne__meta">
          {phraseDuree(episode)}
          {episode.pris_en_charge_le && <>{' · '}Prise en charge{episode.pris_en_charge_par_nom ? <> par {episode.pris_en_charge_par_nom}</> : null}</>}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="alerte-ligne__action"
        aria-haspopup="dialog"
        aria-label={`Voir le détail de l’alerte${agencePropre ? '' : ` de ${episode.agence_nom}`}, ${(libelleCauseFin(episode.fin_cause) ?? '').toLowerCase() || 'en cours'}`}
        onClick={() => onDetail(episode.episode_id)}
      >
        Voir le détail
      </Button>
    </li>
  );
}

// ── Vue (sans effet : testable) ────────────────────────────────────────────────────────────────────

export interface VueHistoriqueProps {
  etat: EtatHistorique;
  filtres: FiltresHistorique;
  ouvert: boolean;
  /** Agency Manager : sa seule agence, pas de filtre d'agence. */
  agencePropre: boolean;
  agences: Pick<Agence, 'id' | 'nom' | 'ville'>[];
  onBascule: () => void;
  onFiltres: (f: FiltresHistorique) => void;
  onReessayer: () => void;
  onVoirPlus: () => void;
  onDetail: (id: string) => void;
  maintenant?: Date;
}

/**
 * « Historique des alertes » : repliée par défaut, sous la liste active. Section absente quand le serveur dit que les épisodes ne sont pas disponibles
 * (interrupteur coupé, forfait sans alertes) : la page reste alors exactement comme avant.
 */
export function VueHistorique({ etat, filtres, ouvert, agencePropre, agences, onBascule, onFiltres, onReessayer, onVoirPlus, onDetail, maintenant }: VueHistoriqueProps) {
  const idCorps = useId();
  const idTitre = useId();
  if (etat.charge && !etat.disponible) return null;
  if (!etat.charge && etat.statut === 'chargement') {
    // Réserve la place de l'en-tête replié : pas de saut de page quand la réponse arrive.
    return <div className="alerte-histo alerte-histo--attente" role="status" aria-busy="true" aria-label="Chargement de l’historique des alertes"><Skeleton height={56} radius="var(--radius-xl)" /></div>;
  }
  const actifs = filtresActifs(filtres);
  const premierEchec = etat.statut === 'erreur' && etat.episodes.length === 0;
  const actualisationEchouee = etat.statut === 'erreur' && etat.episodes.length > 0;
  const chargement = etat.statut === 'chargement';
  const vide = etat.statut === 'pret' && etat.episodes.length === 0;

  return (
    <section className="alerte-histo" aria-labelledby={idTitre}>
      <h2 id={idTitre} className="alerte-histo__titre">
        <button type="button" className="alerte-histo__bascule" aria-expanded={ouvert} aria-controls={idCorps} onClick={onBascule}>
          <span className="alerte-histo__intitule">Historique des alertes</span>
          <span className="alerte-histo__aide">Alertes de satisfaction terminées ou en cours</span>
          <ChevronDownIcon size={18} aria-hidden="true" className={`alerte-histo__chevron${ouvert ? ' is-ouvert' : ''}`} />
        </button>
      </h2>
      {ouvert && (
        <div id={idCorps} className="alerte-histo__corps" aria-busy={chargement || undefined}>
          <div className="alerte-histo__filtres" role="group" aria-label="Filtres de l’historique">
            <label className="alerte-histo__champ">
              <span>État</span>
              <select className="alerte-histo__select" value={filtres.statut} onChange={(e) => onFiltres({ ...filtres, statut: e.target.value as FiltreStatut })}>
                {OPTIONS_STATUT.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="alerte-histo__champ">
              <span>Période</span>
              <select className="alerte-histo__select" value={filtres.periode} onChange={(e) => onFiltres({ ...filtres, periode: e.target.value as FiltrePeriode })}>
                {OPTIONS_PERIODE.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            {!agencePropre && (
              <div className="alerte-histo__champ alerte-histo__champ--agence">
                <span>Agence</span>
                <AgenceFilterSelect agences={agences} selectedId={filtres.agenceId} onChange={(agenceId) => onFiltres({ ...filtres, agenceId })} label="Filtrer l’historique par agence" />
              </div>
            )}
            {actifs && <Button size="sm" variant="ghost" onClick={() => onFiltres(FILTRES_INITIAUX)}>Réinitialiser les filtres</Button>}
          </div>

          {actualisationEchouee && (
            <Alert tone="warning" title="L’historique n’a pas pu être actualisé : la liste affichée peut ne plus être à jour." action={<Button size="sm" variant="secondary" onClick={onReessayer}>Réessayer</Button>} />
          )}

          {chargement && etat.episodes.length === 0 ? (
            <div className="agence-prio" role="status" aria-busy="true" aria-label="Chargement de l’historique">
              {[0, 1, 2].map((i) => <Skeleton key={i} height={72} radius="var(--radius-md)" />)}
            </div>
          ) : premierEchec ? (
            <Alert tone="warning" title="Impossible de charger l’historique. Cela ne signifie pas qu’il est vide." action={<Button size="sm" variant="secondary" onClick={onReessayer}>Réessayer</Button>} />
          ) : vide ? (
            actifs ? (
              <EmptyState
                compact
                illustration={<span className="alerte-vide-filtre"><FilterIcon size={30} /></span>}
                title="Aucune alerte pour ces filtres"
                message="Élargissez l’état, la période ou l’agence pour voir d’autres alertes."
                action={{ label: 'Réinitialiser les filtres', onClick: () => onFiltres(FILTRES_INITIAUX) }}
              />
            ) : YAM_PRESENCE ? (
              <YamEtatVide
                titre="Pas encore d’historique."
                texte={agencePropre
                  ? 'Dès que la satisfaction de votre agence passera sous son seuil, l’alerte apparaîtra ici, avec ses dates et son issue, même une fois terminée.'
                  : 'Dès qu’une agence du réseau restera sous son seuil, l’alerte apparaîtra ici, avec ses dates et son issue, même une fois terminée.'}
              />
            ) : (
              <EmptyState compact illustration="no-alert" title="Pas encore d’historique" message="Les alertes de satisfaction apparaîtront ici, avec leurs dates et leur issue, même une fois terminées." />
            )
          ) : (
            <>
              <ul className="agence-prio alerte-liste alerte-histo__liste">
                {etat.episodes.map((e) => <LigneHistorique key={e.episode_id} episode={e} agencePropre={agencePropre} onDetail={onDetail} maintenant={maintenant} />)}
              </ul>
              <div className="alerte-pied">
                {etat.curseur && (
                  <Button className="alerte-voir-plus" variant="secondary" loading={etat.chargePlus} onClick={onVoirPlus}>Voir plus</Button>
                )}
                <p className="siege-note" role="status">
                  {formaterNombre(etat.episodes.length, 0)} alerte{etat.episodes.length > 1 ? 's' : ''} affichée{etat.episodes.length > 1 ? 's' : ''}{etat.curseur ? ', d’autres sont disponibles' : ''}.
                </p>
              </div>
              {etat.erreurPlus && (
                <Alert tone="warning" title="La suite de l’historique n’a pas pu être chargée." action={<Button size="sm" variant="secondary" onClick={onVoirPlus}>Réessayer</Button>} />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── Tiroir de détail ───────────────────────────────────────────────────────────────────────────────

export function ContenuDetailEpisode({ episode, agencePropre }: { episode: EpisodeDetail; agencePropre: boolean }) {
  const termine = episode.statut === 'terminee';
  const cause = termine ? libelleCauseFin(episode.fin_cause) : null;
  const explication = termine ? explicationCauseFin(episode.fin_cause) : null;
  const approx = episode.debut_approximatif !== false;
  return (
    <div className="alerte-detail">
      <div className="alerte-detail__etat">
        <PastilleEtatEpisode statut={episode.statut} />
        <BadgeGraviteAlerte gravite={episode.gravite_ouverture ?? undefined} />
      </div>
      <dl className="alerte-detail__liste">
        {!agencePropre && <><dt>Agence</dt><dd>{episode.agence_nom}</dd></>}
        <dt>Début de la situation</dt>
        <dd>
          {prefixeDebut(approx, episode.debut_remontee_limitee)} <time dateTime={episode.debut_condition}>{fullDate(episode.debut_condition)}</time>
          <span className="alerte-detail__note">Reconstitué d’après les avis reçus : date approximative{episode.debut_remontee_limitee ? ', et l’alerte est peut-être plus ancienne' : ''}.</span>
        </dd>
        <dt>Détectée par IKAN</dt>
        <dd><time dateTime={episode.detecte_le}>{fullDate(episode.detecte_le)}</time></dd>
        {termine && episode.fin_condition && (
          <>
            <dt>Fin de la situation</dt>
            <dd>Vers le <time dateTime={episode.fin_condition}>{fullDate(episode.fin_condition)}</time><span className="alerte-detail__note">Reconstituée d’après les avis reçus : date approximative.</span></dd>
          </>
        )}
        {termine && episode.terminee_le && (
          <>
            <dt>Fin constatée par IKAN</dt>
            <dd><time dateTime={episode.terminee_le}>{fullDate(episode.terminee_le)}</time></dd>
          </>
        )}
        {cause && (
          <>
            <dt>Cause de la fin</dt>
            <dd><strong>{cause}</strong>{explication && <span className="alerte-detail__note">{explication}</span>}</dd>
          </>
        )}
        <dt>Durée</dt>
        <dd>{valeurDuree(episode)}{episode.duree_en_cours ? ' (en cours)' : ''}</dd>
        <dt>À l’ouverture</dt>
        <dd>{formaterPourcentage(episode.taux_ouverture)} de satisfaction, pour un seuil de {formaterPourcentage(episode.seuil_ouverture)}</dd>
        {termine && episode.taux_fermeture != null && (
          <>
            <dt>À la fin</dt>
            <dd>{formaterPourcentage(episode.taux_fermeture)} de satisfaction{episode.seuil_fermeture != null ? `, pour un seuil de ${formaterPourcentage(episode.seuil_fermeture)}` : ''}</dd>
          </>
        )}
        <dt>Prise en charge</dt>
        <dd>
          {episode.pris_en_charge_le ? (
            <>
              {episode.pris_en_charge_par_nom ? <>Par <strong>{episode.pris_en_charge_par_nom}</strong>, le </> : 'Le '}
              <time dateTime={episode.pris_en_charge_le}>{fullDate(episode.pris_en_charge_le)}</time>
              {episode.delai_prise_en_charge_minutes != null && <span className="alerte-detail__note">Délai après la détection : {formaterDelaiExact(episode.delai_prise_en_charge_minutes)}.</span>}
            </>
          ) : termine ? 'Aucune prise en charge avant la fin de l’alerte.' : 'Pas encore prise en charge.'}
        </dd>
        {episode.pris_en_charge_le && episode.commentaire_prise_en_charge && (
          <>
            <dt>Commentaire</dt>
            <dd className="alerte-detail__commentaire">« {episode.commentaire_prise_en_charge} »</dd>
          </>
        )}
      </dl>
    </div>
  );
}

type EtatDetail = { statut: 'chargement' } | { statut: 'pret'; episode: EpisodeDetail } | { statut: 'introuvable' } | { statut: 'erreur'; message: string };

export function TiroirDetailEpisode({ episodeId, agencePropre, onFermer }: { episodeId: string | null; agencePropre: boolean; onFermer: () => void }) {
  const [etat, setEtat] = useState<EtatDetail>({ statut: 'chargement' });
  const requete = useRef(0);

  const charger = useCallback(async () => {
    if (!episodeId) return;
    const id = ++requete.current;
    setEtat({ statut: 'chargement' });
    try {
      const r = await alertesApi.episode(episodeId);
      if (id === requete.current) setEtat({ statut: 'pret', episode: r.data });
    } catch (e) {
      if (id !== requete.current) return;
      if (axios.isAxiosError(e) && e.response?.status === 404) setEtat({ statut: 'introuvable' });
      else setEtat({ statut: 'erreur', message: userFacingError(e, 'Impossible de charger le détail de cette alerte.') });
    }
  }, [episodeId]);

  useEffect(() => {
    charger();
    return () => { requete.current += 1; };
  }, [charger]);

  return (
    <Drawer
      open={episodeId !== null}
      onClose={onFermer}
      title={etat.statut === 'pret' ? (agencePropre ? 'Alerte de satisfaction' : etat.episode.agence_nom) : 'Détail de l’alerte'}
      subtitle={etat.statut === 'pret' && !agencePropre ? 'Alerte de satisfaction sous le seuil' : undefined}
      footer={<Button variant="secondary" onClick={onFermer}>Fermer</Button>}
    >
      {etat.statut === 'chargement' ? (
        <div role="status" aria-busy="true" aria-label="Chargement du détail" className="alerte-detail__attente">
          <Skeleton height={28} width="40%" radius="var(--radius-pill)" />
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} radius="var(--radius-md)" />)}
        </div>
      ) : etat.statut === 'introuvable' ? (
        <Alert tone="info" title="Cette alerte n’est plus disponible.">Elle a peut-être été retirée de l’historique. Fermez ce panneau et actualisez la liste.</Alert>
      ) : etat.statut === 'erreur' ? (
        <Alert tone="warning" title={etat.message} action={<Button size="sm" variant="secondary" onClick={charger}>Réessayer</Button>} />
      ) : (
        <ContenuDetailEpisode episode={etat.episode} agencePropre={agencePropre} />
      )}
    </Drawer>
  );
}

// ── Conteneur ──────────────────────────────────────────────────────────────────────────────────────

interface Props {
  isAgencyManager: boolean;
  agences: Agence[];
  /** Change quand la liste active est actualisée (prise en charge, bouton « Actualiser ») : l'historique est rechargé avec elle. */
  rafraichissement: number;
}

/**
 * Historique des alertes de seuil (GET /alertes/episodes, pagination par curseur). Une première page est chargée dès l'arrivée sur la page (c'est elle qui dit si
 * la section existe) ; le dépliage ne fait aucun appel de plus. Lecture seule : aucune action sur un épisode depuis l'historique.
 */
export default function HistoriqueAlertes({ isAgencyManager, agences, rafraichissement }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [filtres, setFiltres] = useState<FiltresHistorique>(FILTRES_INITIAUX);
  const [etat, dispatch] = useReducer(historiqueReducer, historiqueInitial);
  const [detailId, setDetailId] = useState<string | null>(null);
  const requete = useRef(0);

  const charger = useCallback(async () => {
    const id = ++requete.current;
    dispatch({ type: 'debut' });
    try {
      const r = await alertesApi.episodes(parametresHistorique(filtres, null));
      if (id !== requete.current) return;
      const disponible = r.data?.episodes_disponibles !== false && r.data?.alertes_incluses !== false;
      dispatch({ type: 'succes', episodes: r.data?.episodes ?? [], curseur: r.data?.curseur_suivant ?? null, disponible });
    } catch (e) {
      console.error('Erreur chargement de l’historique des alertes:', e);
      if (id === requete.current) dispatch({ type: 'echec' });
    }
  }, [filtres]);

  useEffect(() => {
    charger();
    return () => { requete.current += 1; };
  }, [charger, rafraichissement]);

  const voirPlus = async () => {
    if (!etat.curseur || etat.chargePlus) return;
    const id = requete.current;
    dispatch({ type: 'plus_debut' });
    try {
      const r = await alertesApi.episodes(parametresHistorique(filtres, etat.curseur));
      if (id !== requete.current) return;
      dispatch({ type: 'plus_succes', episodes: r.data?.episodes ?? [], curseur: r.data?.curseur_suivant ?? null });
    } catch (e) {
      console.error('Erreur chargement de la suite de l’historique:', e);
      if (id === requete.current) dispatch({ type: 'plus_echec' });
    }
  };

  return (
    <>
      <VueHistorique
        etat={etat}
        filtres={filtres}
        ouvert={ouvert}
        agencePropre={isAgencyManager}
        agences={agences}
        onBascule={() => setOuvert((v) => !v)}
        onFiltres={setFiltres}
        onReessayer={charger}
        onVoirPlus={voirPlus}
        onDetail={setDetailId}
      />
      <TiroirDetailEpisode key={detailId ?? 'ferme'} episodeId={detailId} agencePropre={isAgencyManager} onFermer={() => setDetailId(null)} />
    </>
  );
}
