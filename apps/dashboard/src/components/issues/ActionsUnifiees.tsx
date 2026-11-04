import React from 'react';
import { Link } from 'react-router-dom';
import type { UserRole } from '../../types';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { CheckCircleIcon, UsersIcon } from '../common/Icons';
import { fullDate, shortDate } from '../ui/format';
import { lienAvis } from '../../utils/liensAgence';
import { joursDepuis, libelleJours } from '../../utils/issueSuivi';
import { extraitCommentaire } from '../../pages/cx/pilotageFormatters';
import {
  NOTE_EN_RETARD,
  NOTE_MES_ACTIONS,
  aDesFiltresActions,
  peutTerminerLigne,
  texteRetardAction,
  type FiltresActions,
  type LigneAction,
  type TypeActions,
} from '../../utils/actionsUnifiees';

/** Identifiant DOM du bouton qui ouvre le problème d'une ligne : le panneau y rend le focus quand il se ferme. */
export const idOuvrirProbleme = (cle: string): string => `action-ligne-${cle}`;

interface BarreProps {
  filtres: FiltresActions;
  onChange: (suite: Partial<FiltresActions>) => void;
  /** Totaux affichés dans les segments ; null : pas encore connus (rien n'est affiché plutôt qu'un zéro trompeur). */
  totalEnCours: number | null;
  totalTerminees: number | null;
}

/**
 * Segments « En cours / Terminées » et filtres de la liste : type (problème ou avis), « En retard » (actions de problème dont l'échéance est dépassée),
 * « Mes actions » (actions de problème dont je suis le responsable). Les deux dernières ne concernent pas les actions sur avis : la page le dit.
 */
export function BarreFiltresActions({ filtres, onChange, totalEnCours, totalTerminees }: BarreProps) {
  const enCours = filtres.segment === 'en_cours';
  return (
    <div className="pb-barre-actions">
      <div className="ui-segmented" role="group" aria-label="État des actions">
        <button type="button" className="ui-segmented__item" aria-pressed={enCours} onClick={() => onChange({ segment: 'en_cours' })} style={{ minHeight: 44 }}>
          En cours{totalEnCours !== null ? ` (${totalEnCours})` : ''}
        </button>
        <button type="button" className="ui-segmented__item" aria-pressed={!enCours} onClick={() => onChange({ segment: 'terminees', enRetard: false })} style={{ minHeight: 44 }}>
          Terminées{totalTerminees !== null ? ` (${totalTerminees})` : ''}
        </button>
      </div>
      <div className="pb-filtres" role="group" aria-label="Filtres des actions">
        <label className="pb-filtre">
          <span>Type</span>
          <select value={filtres.type} onChange={(e) => onChange({ type: e.target.value as TypeActions })}>
            <option value="tous">Problèmes et avis</option>
            <option value="probleme">Problèmes</option>
            <option value="avis">Avis</option>
          </select>
        </label>
        {enCours && (
          <button type="button" className="pb-bascule" aria-pressed={filtres.enRetard} onClick={() => onChange({ enRetard: !filtres.enRetard })} title="Seulement les actions de problème dont l’échéance est dépassée">
            <span aria-hidden="true" className="pb-bascule__coche">{filtres.enRetard ? '✓' : ''}</span>
            En retard
          </button>
        )}
        <button type="button" className="pb-bascule" aria-pressed={filtres.mesActions} onClick={() => onChange({ mesActions: !filtres.mesActions })} title="Seulement les actions de problème dont vous êtes le responsable">
          <span aria-hidden="true" className="pb-bascule__coche">{filtres.mesActions ? '✓' : ''}</span>
          Mes actions
        </button>
        {aDesFiltresActions(filtres) && <Button variant="ghost" onClick={() => onChange({ type: 'tous', enRetard: false, mesActions: false })}>Effacer les filtres</Button>}
      </div>
      {enCours && filtres.enRetard && <p className="pb-note">{NOTE_EN_RETARD}</p>}
      {filtres.mesActions && <p className="pb-note">{NOTE_MES_ACTIONS}</p>}
    </div>
  );
}

export interface ConfirmationAvis {
  ouverte: boolean;
  occupe: boolean;
  onDemander: () => void;
  onConfirmer: () => void;
  onAnnuler: () => void;
}

interface LigneProps {
  ligne: LigneAction;
  /** Le CX Manager suit un réseau : l'agence est affichée. */
  afficherAgence: boolean;
  role: UserRole | undefined;
  moiId: string | undefined;
  maintenant: number;
  /** Problème dont le panneau est ouvert : la ligne correspondante est annoncée. */
  problemeOuvertId: string | null;
  onOuvrirProbleme: (issueId: string) => void;
  onTerminer: (ligne: LigneAction) => void;
  confirmationAvis?: ConfirmationAvis;
}

/**
 * Une action, quelle que soit son origine. Le type (« Problème » / « Avis ») est le SEUL badge. Un problème s'ouvre dans le panneau (la liste reste visible) ;
 * un avis s'ouvre dans « Avis clients ». « Terminer » : CX Manager, ou Agency Manager sur ses propres actions de problème ; la confirmation est celle de la fiche du problème.
 */
export function LigneActionItem({ ligne, afficherAgence, role, moiId, maintenant, problemeOuvertId, onOuvrirProbleme, onTerminer, confirmationAvis }: LigneProps) {
  const probleme = ligne.origine === 'probleme';
  const retard = texteRetardAction(ligne);
  const ouverte = probleme && problemeOuvertId === ligne.issueId;
  return (
    <Card as="li" padding="sm" className={`ui-item${ligne.terminee ? ' ui-action-card--done' : ''}`} aria-current={ouverte ? 'true' : undefined} data-origine={ligne.origine}>
      <div className="ui-item__head">
        <Badge variant="outline" label={probleme ? 'Problème' : 'Avis'} />
      </div>

      <h3 className="ui-item__title">{ligne.titre}</h3>

      {!probleme && ligne.avisDate && (
        <p className="pb-note" style={{ margin: 0 }}>
          Avis du <time dateTime={ligne.avisDate} title={fullDate(ligne.avisDate)}>{shortDate(ligne.avisDate)}</time> · note {ligne.avisNote}/5
          {ligne.avisCommentaire ? <> : « {extraitCommentaire(ligne.avisCommentaire, 140)} »</> : ' · aucun commentaire laissé par le client'}
        </p>
      )}

      <div className="ui-item__meta">
        {afficherAgence && ligne.agenceNom && (
          <>
            <span>{ligne.agenceNom}</span>
            <span className="ui-item__meta-sep" aria-hidden="true" />
          </>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <UsersIcon size={14} aria-hidden="true" />
          {probleme
            ? (ligne.responsableNom ? `Responsable : ${ligne.responsableId === moiId ? 'Vous' : ligne.responsableNom}` : 'Sans responsable')
            : (ligne.responsableNom ? `Assignée à ${ligne.responsableNom}` : 'Non assignée')}
        </span>
        {probleme && !ligne.terminee && (
          <>
            <span className="ui-item__meta-sep" aria-hidden="true" />
            {ligne.echeance
              ? <span>Échéance <time dateTime={ligne.echeance} title={fullDate(ligne.echeance)}>{shortDate(ligne.echeance)}</time></span>
              : <span>Sans échéance</span>}
          </>
        )}
        {!probleme && !ligne.terminee && ligne.depuis && (
          <>
            <span className="ui-item__meta-sep" aria-hidden="true" />
            <span>En cours depuis {libelleJours(joursDepuis(ligne.depuis, maintenant))}</span>
          </>
        )}
        {ligne.terminee && ligne.dateFin && (
          <>
            <span className="ui-item__meta-sep" aria-hidden="true" />
            <span>{probleme ? 'Terminée' : 'Réalisée'} le <time dateTime={ligne.dateFin} title={fullDate(ligne.dateFin)}>{shortDate(ligne.dateFin)}</time></span>
          </>
        )}
        {retard && (
          <>
            <span className="ui-item__meta-sep" aria-hidden="true" />
            <span className="pb-retard">{retard}</span>
          </>
        )}
      </div>

      <div className="ui-item__foot">
        {probleme ? (
          <button type="button" id={idOuvrirProbleme(ligne.cle)} className="ui-item__link pb-lien" onClick={() => ligne.issueId && onOuvrirProbleme(ligne.issueId)}>
            Voir le problème « {extraitCommentaire(ligne.issueTitre ?? '', 70)} »
          </button>
        ) : (
          <Link to={lienAvis(role === 'agency_manager' ? 'agency_manager' : 'cx_manager', ligne.agenceId, undefined, { avisId: ligne.id })} className="ui-item__link" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
            Retrouver l’avis dans « Avis clients »
          </Link>
        )}
        <span className="ui-item__spacer" />
        {probleme && peutTerminerLigne(ligne, role, moiId) && (
          <Button variant="secondary" icon={<CheckCircleIcon size={15} />} onClick={() => onTerminer(ligne)}>Terminer</Button>
        )}
        {!probleme && !ligne.terminee && confirmationAvis && !confirmationAvis.ouverte && (
          <Button variant="secondary" icon={<CheckCircleIcon size={15} />} onClick={confirmationAvis.onDemander}>Marquer comme réalisée</Button>
        )}
      </div>

      {!probleme && !ligne.terminee && confirmationAvis?.ouverte && (
        <div role="group" aria-label="Confirmer que l’action est réalisée" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-bg, var(--color-bg-subtle))', border: '1px solid var(--color-warning-border)' }}>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-main)', lineHeight: 1.5 }}>
            En confirmant, l’avis passera à « Résolu » et sortira des alertes. Cela n’indique pas que le client est satisfait.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button onClick={confirmationAvis.onConfirmer} loading={confirmationAvis.occupe}>Confirmer : l’action est réalisée</Button>
            <Button variant="ghost" onClick={confirmationAvis.onAnnuler} disabled={confirmationAvis.occupe}>Annuler</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
