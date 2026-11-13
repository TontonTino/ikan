import React, { useCallback, useId, useReducer, useRef, useState } from 'react';
import type { HistoriqueSuggestion, IdeaStatus, Suggestion } from '../../types';
import { ClockIcon } from '../../components/common/Icons';
import { STATUS_LABELS, STATUS_STYLE } from './pilotageConstants';
import {
  CHANGEMENT_FERME, LONGUEUR_MAX_COMMENTAIRE, actionsPossibles, changementReducer, commentaireAEnvoyer, compteurCommentaire, dateHeure,
  libelleDernierChangement, libelleRole, libelleTransition, nomAuteur, type EtatChangement, type ResultatChangement,
} from './suggestionsHistorique';

const bouton: React.CSSProperties = { minHeight: 44, minWidth: 44, padding: '8px 14px', fontSize: 'var(--text-xs)', borderRadius: '10px', fontWeight: 'var(--weight-semibold)' };

// ── Dernier changement ────────────────────────────────────────────────────────────────────────────

/** « Traité par Awa Traoré, le 13 octobre 2026 » (+ commentaire). Rien tant que la suggestion n'a jamais changé de statut. */
export function DernierChangement({ entree }: { entree: HistoriqueSuggestion | null | undefined }) {
  if (!entree) return null;
  return (
    <div style={{ marginTop: '10px' }}>
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>{libelleDernierChangement(entree)}</p>
      {entree.commentaire && <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>« {entree.commentaire} »</p>}
    </div>
  );
}

// ── Historique complet ────────────────────────────────────────────────────────────────────────────

export type EtatHistorique = { statut: 'chargement' | 'pret' | 'erreur'; entrees: HistoriqueSuggestion[] };

/** Liste chronologique (du plus ancien au plus récent) : lisible sans la couleur, à la souris, au clavier et sur téléphone. */
export function HistoriqueListe({ etat, onRetry, id }: { etat: EtatHistorique; onRetry?: () => void; id?: string }) {
  if (etat.statut === 'chargement') {
    return <p id={id} role="status" aria-busy="true" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>Chargement de l’historique…</p>;
  }
  if (etat.statut === 'erreur') {
    return (
      <div id={id} role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: 'var(--color-critique-texte)' }}>
        <span>Impossible de charger l’historique. Cela ne signifie pas qu’il est vide.</span>
        {onRetry && <button type="button" className="btn-secondary" style={bouton} onClick={onRetry}>Réessayer</button>}
      </div>
    );
  }
  if (etat.entrees.length === 0) {
    return <p id={id} style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>Aucun changement de statut pour le moment.</p>;
  }
  return (
    <ol id={id} aria-label="Historique des changements de statut" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {etat.entrees.map((e) => {
        const role = libelleRole(e.auteur_role);
        return (
          <li key={e.id} style={{ borderLeft: '3px solid var(--color-trait)', paddingLeft: '10px', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>{libelleTransition(e)}</p>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', overflowWrap: 'anywhere' }}>
              <time dateTime={e.date}>{dateHeure(e.date)}</time> · par {nomAuteur(e)}{role ? ` (${role})` : ''}
            </p>
            {e.commentaire && <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-encre)', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>« {e.commentaire} »</p>}
          </li>
        );
      })}
    </ol>
  );
}

// ── Formulaire de changement de statut ────────────────────────────────────────────────────────────

export function FormulaireChangement({ etat, onCommentaire, onConfirmer, onAnnuler }: {
  etat: EtatChangement; onCommentaire: (texte: string) => void; onConfirmer: () => void; onAnnuler: () => void;
}) {
  const champ = useId();
  const aide = useId();
  if (!etat.cible) return null;
  return (
    <form
      aria-label={`Changer le statut : ${STATUS_LABELS[etat.cible]}`}
      onSubmit={(e) => { e.preventDefault(); onConfirmer(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !etat.envoi) onAnnuler(); }}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'var(--color-bg)', border: '1px solid var(--color-trait)', borderRadius: '12px' }}
    >
      <label htmlFor={champ} className="t-xs t-semi t-encre">
        Passer à « {STATUS_LABELS[etat.cible]} » — commentaire (facultatif)
      </label>
      <textarea
        id={champ}
        rows={3}
        value={etat.commentaire}
        maxLength={LONGUEUR_MAX_COMMENTAIRE}
        onChange={(e) => onCommentaire(e.target.value)}
        aria-describedby={aide}
        disabled={etat.envoi}
        autoFocus
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', fontFamily: 'inherit', fontSize: 'var(--text-sm)', resize: 'vertical' }}
      />
      <p id={aide} className="suggestion-compteur" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', textAlign: 'right' }}>{compteurCommentaire(etat.commentaire)} caractères</p>
      {etat.erreur && <p role="alert" style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-critique-texte)' }}>{etat.erreur}</p>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button type="button" className="btn-secondary" style={bouton} onClick={onAnnuler} disabled={etat.envoi}>Annuler</button>
        <button type="submit" className="btn-primary" style={bouton} disabled={etat.envoi}>{etat.envoi ? 'Enregistrement…' : 'Confirmer'}</button>
      </div>
    </form>
  );
}

// ── Carte ─────────────────────────────────────────────────────────────────────────────────────────

interface Props {
  suggestion: Suggestion;
  /** Enregistre le changement ; un refus renvoie {ok:false, message} (le formulaire et le commentaire sont conservés). */
  updateStatut: (id: string, statut: IdeaStatus, commentaire?: string) => Promise<ResultatChangement | void>;
  /** Charge l'historique complet à la demande. Absent : pas de bouton d'historique. */
  chargerHistorique?: (id: string) => Promise<HistoriqueSuggestion[]>;
}

export default function SuggestionCarte({ suggestion: s, updateStatut, chargerHistorique }: Props) {
  const st = STATUS_STYLE[s.statut] || { bg: 'var(--color-bg)', text: 'var(--color-text-2)', border: 'var(--color-trait)' };
  const [changement, dispatch] = useReducer(changementReducer, CHANGEMENT_FERME);
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const [historique, setHistorique] = useState<EtatHistorique>({ statut: 'chargement', entrees: [] });
  const idHistorique = useId();
  const requete = useRef(0);

  const lireHistorique = useCallback(async () => {
    if (!chargerHistorique) return;
    const id = ++requete.current;
    setHistorique((h) => ({ ...h, statut: 'chargement' }));
    try {
      const entrees = await chargerHistorique(s.id);
      if (id === requete.current) setHistorique({ statut: 'pret', entrees });
    } catch {
      if (id === requete.current) setHistorique((h) => ({ ...h, statut: 'erreur' }));
    }
  }, [chargerHistorique, s.id]);

  const basculerHistorique = () => {
    const ouvrir = !historiqueOuvert;
    setHistoriqueOuvert(ouvrir);
    if (ouvrir) void lireHistorique();
  };

  const confirmer = async () => {
    if (!changement.cible) return;
    dispatch({ type: 'envoyer' });
    const resultat = await updateStatut(s.id, changement.cible, commentaireAEnvoyer(changement.commentaire));
    if (resultat && !resultat.ok) {
      dispatch({ type: 'echec', message: resultat.message });      // la saisie reste intacte
      return;
    }
    dispatch({ type: 'succes' });
    if (historiqueOuvert) void lireHistorique();
  };

  return (
    <div
      style={{ background: 'var(--color-surface)', borderRadius: '20px', padding: '22px', border: '1px solid var(--color-trait)', display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, padding: '3px 10px', borderRadius: '9999px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
            {STATUS_LABELS[s.statut]}
          </span>
          <span className="t-xs t-2 t-semi">
            Déposée le {new Date(s.date_soumission).toLocaleDateString('fr-FR')}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-encre)', lineHeight: 1.5, fontWeight: 'var(--weight-normal)', overflowWrap: 'anywhere' }}>"{s.contenu}"</p>
        <DernierChangement entree={s.dernier_changement} />
      </div>

      {historiqueOuvert && (
        <div style={{ padding: '12px', background: 'var(--color-bg)', border: '1px solid var(--color-trait)', borderRadius: '12px' }}>
          <HistoriqueListe id={idHistorique} etat={historique} onRetry={() => void lireHistorique()} />
        </div>
      )}

      <FormulaireChangement
        etat={changement}
        onCommentaire={(commentaire) => dispatch({ type: 'saisir', commentaire })}
        onConfirmer={() => void confirmer()}
        onAnnuler={() => dispatch({ type: 'annuler' })}
      />

      {!changement.cible && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', borderTop: '1px solid var(--color-trait)', paddingTop: '12px' }}>
          {chargerHistorique && (
            <button type="button" className="btn-secondary" style={{ ...bouton, marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              aria-expanded={historiqueOuvert} aria-controls={historiqueOuvert ? idHistorique : undefined} onClick={basculerHistorique}>
              <ClockIcon size={14} aria-hidden="true" />
              {historiqueOuvert ? 'Masquer l’historique' : 'Voir l’historique'}
            </button>
          )}
          {actionsPossibles(s.statut).map((a) => (
            <button key={a.cible + a.libelle} type="button" className={a.cible === 'rejete' ? 'btn-secondary' : 'btn-primary'}
              style={a.cible === 'rejete' ? { ...bouton, color: 'var(--color-critique-texte)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' } : bouton}
              onClick={() => dispatch({ type: 'ouvrir', cible: a.cible })}>
              {a.libelle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
