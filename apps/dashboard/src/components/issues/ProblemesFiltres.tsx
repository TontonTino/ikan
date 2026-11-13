import React from 'react';
import type { CriticiteType, IssueStatut } from '../../types';
import Button from '../ui/Button';
import { LIBELLES, NIVEAUX_URGENCE, PROBLEME_STATUT_LABELS, type NiveauUrgence } from '../../utils/vocabulaire';
import { aDesFiltresActifs, FILTRES_PAR_DEFAUT, type FiltresProblemes, type TriListe } from '../../utils/problemesListe';

const STATUTS: IssueStatut[] = ['ouverte', 'reouverte', 'action_en_cours', 'resolue', 'verifiee'];

interface Props {
  filtres: FiltresProblemes;
  onChange: (suite: Partial<FiltresProblemes>) => void;
}

/**
 * Filtres de la liste, TOUS appliqués par le serveur (donc vrais sur l'ensemble des problèmes, pas seulement sur les lignes déjà chargées) :
 * état (un statut réel à la fois, vocabulaire des badges), gravité, « En retard » (délai de traitement dépassé), tri. Chaque changement relance la liste.
 */
export default function ProblemesFiltres({ filtres, onChange }: Props) {
  return (
    <div className="pb-filtres" role="group" aria-label="Filtres des problèmes">
      <label className="pb-filtre">
        <span>État</span>
        <select value={filtres.statut ?? ''} onChange={(e) => onChange({ statut: (e.target.value || null) as IssueStatut | null })}>
          <option value="">Tous les états</option>
          {STATUTS.map((s) => <option key={s} value={s}>{PROBLEME_STATUT_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="pb-filtre">
        <span>{LIBELLES.urgence}</span>
        <select value={filtres.gravite ?? ''} onChange={(e) => onChange({ gravite: (e.target.value || null) as NiveauUrgence | null })}>
          <option value="">Toutes</option>
          {NIVEAUX_URGENCE.map((n) => <option key={n.valeur} value={n.valeur}>{n.libelle}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="pb-bascule"
        aria-pressed={filtres.enRetard}
        onClick={() => onChange({ enRetard: !filtres.enRetard })}
        title="Seulement les problèmes encore à traiter dont le délai de traitement est dépassé"
      >
        <span aria-hidden="true" className="pb-bascule__coche">{filtres.enRetard ? '✓' : ''}</span>
        En retard
      </button>
      <label className="pb-filtre">
        <span>Tri</span>
        <select value={filtres.tri} onChange={(e) => onChange({ tri: e.target.value as TriListe })}>
          <option value="recent">Plus récents</option>
          <option value="ancien">Plus anciens</option>
        </select>
      </label>
      {aDesFiltresActifs(filtres) && (
        <Button variant="ghost" onClick={() => onChange({ statut: FILTRES_PAR_DEFAUT.statut, gravite: FILTRES_PAR_DEFAUT.gravite, enRetard: FILTRES_PAR_DEFAUT.enRetard })}>
          Effacer les filtres
        </Button>
      )}
    </div>
  );
}
