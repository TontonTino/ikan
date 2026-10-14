import React, { useCallback, useId, useReducer, useRef, useState } from 'react';
import type { HistoriqueSuggestion, IdeaStatus, Suggestion } from '../../types';
import { ClockIcon } from '../../components/common/Icons';
import { STATUS_LABELS, STATUS_STYLE } from './pilotageConstants';
import {
  CHANGEMENT_FERME, LONGUEUR_MAX_COMMENTAIRE, actionsPossibles, changementReducer, commentaireAEnvoyer, compteurCommentaire, dateHeure,
  libelleDernierChangement, libelleRole, libelleTransition, nomAuteur, type EtatChangement, type ResultatChangement,
} from './suggestionsHistorique';

const bouton: React.CSSProperties = { minHeight: 44, minWidth: 44, padding: '8px 14px', fontSize: '0.8rem', borderRadius: '10px', fontWeight: 700 };

// ── Dernier changement ────────────────────────────────────────────────────────────────────────────

/** « Traité par Awa Traoré, le 13 octobre 2026 » (+ commentaire). Rien tant que la suggestion n'a jamais changé de statut. */
export function DernierChangement({ entree }: { entree: HistoriqueSuggestion | null | undefined }) {
  if (!entree) return null;
  return (
    <div style={{ marginTop: '10px' }}>
      <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', fontWeight: 700 }}>{libelleDernierChangement(entree)}</p>
      {entree.commentaire && <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#64748B', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>« {entree.commentaire} »</p>}
    </div>
  );
}

// ── Historique complet ────────────────────────────────────────────────────────────────────────────

export type EtatHistorique = { statut: 'chargement' | 'pret' | 'erreur'; entrees: HistoriqueSuggestion[] };

/** Liste chronologique (du plus ancien au plus récent) : lisible sans la couleur, à la souris, au clavier et sur téléphone. */
export function HistoriqueListe({ etat, onRetry, id }: { etat: EtatHistorique; onRetry?: () => void; id?: string }) {
  if (etat.statut === 'chargement') {
    return <p id={id} role="status" aria-busy="true" style={{ margin: 0, fontSize: '0.8rem', color: '#64748B' }}>Chargement de l’historique…</p>;
  }
  if (etat.statut === 'erreur') {
    return (
      <div id={id} role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.8rem', color: '#B91C1C' }}>
        <span>Impossible de charger l’historique. Cela ne signifie pas qu’il est vide.</span>
        {onRetry && <button type="button" className="btn-secondary" style={bouton} onClick={onRetry}>Réessayer</button>}
      </div>
    );
  }
  if (etat.entrees.length === 0) {
    return <p id={id} style={{ margin: 0, fontSize: '0.8rem', color: '#64748B' }}>Aucun changement de statut pour le moment.</p>;
  }
  return (
    <ol id={id} aria-label="Historique des changements de statut" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {etat.entrees.map((e) => {
        const role = libelleRole(e.auteur_role);
        return (
          <li key={e.id} style={{ borderLeft: '3px solid #CBD5E1', paddingLeft: '10px', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 800, color: '#0F172A' }}>{libelleTransition(e)}</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: '#475569', overflowWrap: 'anywhere' }}>
              <time dateTime={e.date}>{dateHeure(e.date)}</time> · par {nomAuteur(e)}{role ? ` (${role})` : ''}
            </p>
            {e.commentaire && <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#334155', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>« {e.commentaire} »</p>}
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
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px' }}
    >
      <label htmlFor={champ} style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A' }}>
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
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontFamily: 'inherit', fontSize: '0.84rem', resize: 'vertical' }}
      />
      <p id={aide} className="suggestion-compteur" style={{ margin: 0, fontSize: '0.74rem', color: '#64748B', textAlign: 'right' }}>{compteurCommentaire(etat.commentaire)} caractères</p>
      {etat.erreur && <p role="alert" style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: '#B91C1C' }}>{etat.erreur}</p>}
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
  const st = STATUS_STYLE[s.statut] || { bg: '#F8FAFB', text: '#475569', border: '#E2E8F0' };
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
      style={{ background: '#FFFFFF', borderRadius: '20px', padding: '22px', border: '1px solid #E8ECE6', boxShadow: '0 2px 10px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, padding: '3px 10px', borderRadius: '9999px', fontSize: '0.74rem', fontWeight: 800 }}>
            {STATUS_LABELS[s.statut]}
          </span>
          <span style={{ fontSize: '0.76rem', color: '#64748B', fontWeight: 600 }}>
            Déposée le {new Date(s.date_soumission).toLocaleDateString('fr-FR')}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5, fontWeight: 500, overflowWrap: 'anywhere' }}>"{s.contenu}"</p>
        <DernierChangement entree={s.dernier_changement} />
      </div>

      {historiqueOuvert && (
        <div style={{ padding: '12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px' }}>
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
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', borderTop: '1px solid #F1F4EE', paddingTop: '12px' }}>
          {chargerHistorique && (
            <button type="button" className="btn-secondary" style={{ ...bouton, marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              aria-expanded={historiqueOuvert} aria-controls={historiqueOuvert ? idHistorique : undefined} onClick={basculerHistorique}>
              <ClockIcon size={14} aria-hidden="true" />
              {historiqueOuvert ? 'Masquer l’historique' : 'Voir l’historique'}
            </button>
          )}
          {actionsPossibles(s.statut).map((a) => (
            <button key={a.cible + a.libelle} type="button" className={a.cible === 'rejete' ? 'btn-secondary' : 'btn-primary'}
              style={a.cible === 'rejete' ? { ...bouton, color: '#B91C1C', background: '#FFFFFF', border: '1px solid #FCA5A5' } : bouton}
              onClick={() => dispatch({ type: 'ouvrir', cible: a.cible })}>
              {a.libelle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
