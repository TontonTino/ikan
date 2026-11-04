import React, { useState } from 'react';
import type { Issue } from '../../types';
import Badge from '../ui/Badge';
import { fullDate, shortDate } from '../ui/format';
import { ISSUE_SEVERITE_LABELS, ISSUE_STATUT_BADGE_VARIANT, ISSUE_STATUT_LABELS } from '../../pages/cx/pilotageConstants';
import { libelleEnregistre } from '../../utils/issueSuivi';
import { ligneSuivante, texteActions, texteAvis, texteRetard } from '../../utils/problemesListe';

/** Identifiant DOM de la ligne (ou de la carte) d'un problème : le panneau y rend le focus quand il se ferme. */
export const idLigneProbleme = (id: string): string => `pb-ligne-${id}`;

interface CommunProps {
  issues: Issue[];
  /** Le CX Manager suit un réseau : l'agence est affichée. L'Agency Manager n'en a qu'une : rien à dire. */
  afficherAgence: boolean;
  /** Problème dont le panneau est ouvert. */
  ouvertId: string | null;
  onOuvrir: (issue: Issue) => void;
  maintenant: number;
}

/** Échéance de la prochaine action à faire ; « Sans échéance » si des actions restent sans date ; un tiret s'il n'y a rien à faire ; rien si l'API ne le dit pas. */
export function CelluleEcheance({ issue }: { issue: Issue }) {
  if (issue.prochaine_echeance) {
    return <time dateTime={issue.prochaine_echeance} title={fullDate(issue.prochaine_echeance)}>{shortDate(issue.prochaine_echeance)}</time>;
  }
  if ((issue.nb_actions_a_faire ?? 0) > 0) return <span>Sans échéance</span>;
  if (issue.nb_actions_a_faire === undefined) return null;
  return <span className="pb-muet" title="Aucune action à faire"><span aria-hidden="true">—</span><span className="ui-sr-only">Aucune action à faire</span></span>;
}

/** Titre et ligne de contexte : agence (CX), avis, ancienneté, retard dit en mots (jamais par la seule couleur). */
function CelluleProbleme({ issue, afficherAgence, maintenant }: { issue: Issue; afficherAgence: boolean; maintenant: number }) {
  const avis = texteAvis(issue);
  const retard = texteRetard(issue, maintenant);
  const contexte = [
    afficherAgence && issue.agence_nom ? <span key="agence" className="pb-agence">{issue.agence_nom}</span> : null,
    avis ? <span key="avis">{avis}</span> : null,
    <span key="date"><time dateTime={issue.premiere_detection} title={fullDate(issue.premiere_detection)}>{libelleEnregistre(issue.premiere_detection, maintenant)}</time></span>,
  ].filter(Boolean);
  return (
    <div className="pb-probleme">
      <span className="pb-titre">{issue.titre}</span>
      <span className="pb-contexte">
        {contexte.map((c, i) => (
          <React.Fragment key={i}>{i > 0 && <span className="pb-sep" aria-hidden="true">·</span>}{c}</React.Fragment>
        ))}
      </span>
      {retard && <span className="pb-retard">{retard}</span>}
    </div>
  );
}

/** Navigation au clavier d'un ensemble de lignes : flèches, Début, Fin ; le focus va à la ligne voulue. */
function useNavigationLignes(issues: Issue[]) {
  const [actif, setActif] = useState(0);
  const index = Math.min(actif, Math.max(issues.length - 1, 0));
  const surTouche = (e: React.KeyboardEvent, position: number, ouvrir: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ouvrir();
      return;
    }
    const cible = ligneSuivante(e.key, position, issues.length);
    if (cible === null) return;
    e.preventDefault();
    setActif(cible);
    document.getElementById(idLigneProbleme(issues[cible].id))?.focus();
  };
  return { index, setActif, surTouche };
}

/**
 * Tableau des problèmes (ordinateur). Une ligne = un problème, activable au clavier (Entrée / Espace), flèches Haut/Bas, Début, Fin entre les lignes
 * (un seul arrêt de tabulation pour tout le tableau). Colonnes : Problème, Gravité, État, Actions, Échéance. Un seul badge de gravité et un seul d'état.
 */
export function ProblemesTableau({ issues, afficherAgence, ouvertId, onOuvrir, maintenant }: CommunProps) {
  const { index, setActif, surTouche } = useNavigationLignes(issues);
  return (
    <div className="pb-tableau-conteneur">
      <table className="pb-tableau">
        <caption className="ui-sr-only">Problèmes à traiter. Flèches haut et bas pour changer de ligne, Entrée pour ouvrir le détail.</caption>
        <thead>
          <tr>
            <th scope="col">Problème</th>
            <th scope="col">Gravité</th>
            <th scope="col">État</th>
            <th scope="col" className="pb-col-secondaire">Actions</th>
            <th scope="col" className="pb-col-secondaire">Échéance</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, i) => (
            <tr
              key={issue.id}
              id={idLigneProbleme(issue.id)}
              className="pb-ligne"
              tabIndex={i === index ? 0 : -1}
              aria-current={ouvertId === issue.id ? 'true' : undefined}
              onFocus={() => setActif(i)}
              onClick={() => onOuvrir(issue)}
              onKeyDown={(e) => surTouche(e, i, () => onOuvrir(issue))}
            >
              <td><CelluleProbleme issue={issue} afficherAgence={afficherAgence} maintenant={maintenant} /></td>
              <td><Badge label={ISSUE_SEVERITE_LABELS[issue.severite]} value={issue.severite} /></td>
              <td><Badge label={ISSUE_STATUT_LABELS[issue.statut]} variant={ISSUE_STATUT_BADGE_VARIANT[issue.statut]} /></td>
              <td className="pb-actions-cellule pb-col-secondaire">{texteActions(issue) ?? ''}</td>
              <td className="pb-echeance pb-col-secondaire"><CelluleEcheance issue={issue} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Cartes des problèmes (tablette, mobile) : titre, agence (CX), deux badges, UNE ligne d'avancement. Cible ≥ 44 px, un bouton par carte. */
export function ProblemesCartes({ issues, afficherAgence, ouvertId, onOuvrir, maintenant }: CommunProps) {
  const { index, setActif, surTouche } = useNavigationLignes(issues);
  return (
    <ul className="pb-cartes" aria-label="Problèmes à traiter">
      {issues.map((issue, i) => {
        const retard = texteRetard(issue, maintenant);
        const actions = texteActions(issue);
        return (
          <li key={issue.id}>
            <button
              type="button"
              id={idLigneProbleme(issue.id)}
              className="pb-carte"
              tabIndex={i === index ? 0 : -1}
              aria-current={ouvertId === issue.id ? 'true' : undefined}
              onFocus={() => setActif(i)}
              onClick={() => onOuvrir(issue)}
              onKeyDown={(e) => { if (e.key !== 'Enter' && e.key !== ' ') surTouche(e, i, () => onOuvrir(issue)); }}
            >
              {afficherAgence && issue.agence_nom && <span className="pb-agence">{issue.agence_nom}</span>}
              <span className="pb-titre">{issue.titre}</span>
              <span className="pb-carte__badges">
                <Badge label={ISSUE_SEVERITE_LABELS[issue.severite]} value={issue.severite} />
                <Badge label={ISSUE_STATUT_LABELS[issue.statut]} variant={ISSUE_STATUT_BADGE_VARIANT[issue.statut]} />
              </span>
              {(retard || actions) && (
                <span className="pb-contexte">
                  {retard && <span className="pb-retard">{retard}</span>}
                  {retard && actions && <span className="pb-sep" aria-hidden="true">·</span>}
                  {actions && <span>{actions}</span>}
                </span>
              )}
              <span className="pb-contexte">
                Enregistré <time dateTime={issue.premiere_detection} title={fullDate(issue.premiere_detection)}>{libelleEnregistre(issue.premiere_detection, maintenant)}</time>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
