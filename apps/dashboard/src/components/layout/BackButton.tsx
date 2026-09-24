import React, { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '../common/Icons';

export interface BackButtonProps {
  /** Route de repli, utilisée quand il n'y a aucun historique interne à l'app (arrivée directe par URL). */
  fallbackTo: string;
  /** Complément du libellé de repli, ex. « au Répertoire » -> « Retour au Répertoire ». */
  fallbackLabel: string;
}

// Origines connues (state.retour) -> complément de phrase correct en français.
const RETOUR_LABELS: Record<string, string> = {
  'Vue Siège': 'à la Vue Siège',
  Répertoire: 'au Répertoire',
};

/**
 * React Router 7 (BrowserRouter) stocke `idx` dans history.state : 0 = première entrée de cet onglet pour l'app,
 * donc aucune page précédente de l'app. Sans cette vérification, navigate(-1) renverrait hors de l'app
 * (nouvel onglet, lien collé, favori).
 */
function aUnHistoriqueApp(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

/**
 * Bouton « Retour » unique de l'app, rendu par DashboardLayout pour les routes de sa table BACK_ROUTES.
 * - historique interne présent : navigate(-1) (vrai retour) ; libellé « Retour à <origine> » si l'origine
 *   est connue (location.state.retour), « Retour » sinon ;
 * - sinon : navigate(fallbackTo, { replace: true }), libellé « Retour <fallbackLabel> ».
 */
export default function BackButton({ fallbackTo, fallbackLabel }: BackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // L'origine survit aux changements d'onglet de la page (setSearchParams en replace supprime location.state).
  const memo = useRef<{ path: string; retour?: string }>({ path: '' });
  const retourState = (location.state as { retour?: string } | null)?.retour;
  if (retourState) memo.current = { path: location.pathname, retour: retourState };
  else if (memo.current.path !== location.pathname) memo.current = { path: location.pathname };
  const retour = memo.current.retour;

  const avecHistorique = aUnHistoriqueApp();
  const libelle = !avecHistorique
    ? `Retour ${fallbackLabel}`
    : retour
      ? `Retour ${RETOUR_LABELS[retour] ?? `à ${retour}`}`
      : 'Retour';

  return (
    <button
      type="button"
      onClick={() => (aUnHistoriqueApp() ? navigate(-1) : navigate(fallbackTo, { replace: true }))}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        background: 'var(--color-surface)',
        color: 'var(--color-text-main)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-pill)',
        padding: '7px 14px',
        fontSize: '0.84rem',
        fontWeight: 700,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      <ArrowLeftIcon size={16} />
      {libelle}
    </button>
  );
}
