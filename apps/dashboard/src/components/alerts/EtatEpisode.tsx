import React from 'react';
import Badge, { type BadgeTone } from '../ui/Badge';
import { ActivityIcon, CheckCircleIcon, CheckIcon } from '../common/Icons';
import { fullDate } from '../ui/format';
import { dateJourMois, dateRelativeAlerte, libelleStatutEpisode, prefixeDebut, type EpisodeAlerte } from '../../utils/episodesAlertes';
import type { StatutEpisode } from '../../types';

const TON: Record<StatutEpisode, BadgeTone> = { detectee: 'info', prise_en_charge: 'success', terminee: 'neutral' };

/**
 * UNE pastille d'état de l'alerte : « Détectée », « Prise en charge » ou « Terminée ». Texte ET icône (jamais la couleur seule) ; distincte du badge de
 * niveau (Critique / Important), qui dit la gravité, pas l'avancement. Rien si l'état est inconnu : jamais de valeur technique à l'écran.
 */
export function PastilleEtatEpisode({ statut }: { statut: StatutEpisode }) {
  const label = libelleStatutEpisode(statut);
  if (!label) return null;
  const icone = statut === 'prise_en_charge' ? <CheckCircleIcon size={12} /> : statut === 'terminee' ? <CheckIcon size={12} /> : <ActivityIcon size={12} />;
  return <Badge variant={TON[statut]} label={label} icon={icone} className="alerte-etat" />;
}

/** Une date relative (≤ 30 jours) ou absolue, dans <time> avec la date complète au survol. */
export function DateEnTime({ iso, className }: { iso: string; className?: string }) {
  return <time className={className} dateTime={iso} title={fullDate(iso)}>{dateRelativeAlerte(iso)}</time>;
}

/**
 * Suivi d'une alerte de seuil dans la liste active : début (toujours « environ » ou « au moins »), date de détection, et, une fois prise en charge, la
 * date, l'auteur et le commentaire. Les mêmes informations pour l'Agency Manager et le CX Manager (lecture seule).
 */
export default function SuiviEpisode({ episode, maintenant }: { episode: EpisodeAlerte; maintenant?: Date }) {
  return (
    <>
      {(episode.debut || episode.detecteLe) && (
        <p className="alerte-ligne__meta alerte-suivi">
          {episode.debut && (
            <span className="alerte-suivi__debut">
              {prefixeDebut(episode.debutApproximatif, episode.debutLimite)}{' '}
              <time dateTime={episode.debut} title={fullDate(episode.debut)}>{dateJourMois(episode.debut, maintenant)}</time>
            </span>
          )}
          {episode.debut && episode.detecteLe && ' · '}
          {episode.detecteLe && <span>Détectée <DateEnTime iso={episode.detecteLe} /></span>}
        </p>
      )}
      {episode.statut === 'prise_en_charge' && (
        <div className="alerte-suivi__pec">
          <p className="alerte-ligne__meta alerte-suivi__qui">
            Prise en charge{episode.prisEnChargeLe && <> <DateEnTime iso={episode.prisEnChargeLe} /></>}
            {episode.prisEnChargePar && <> par <strong>{episode.prisEnChargePar}</strong></>}
          </p>
          {episode.commentaire && (
            <p className="alerte-suivi__commentaire">
              <span className="ui-sr-only">Commentaire : </span>« {episode.commentaire} »
            </p>
          )}
        </div>
      )}
    </>
  );
}
