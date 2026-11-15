import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgenceContexteItem } from '../../types';
import { CheckIcon, LayoutGridIcon, SearchIcon, StoreIcon } from '../common/Icons';
import { agencesParVille, nombreAgences } from '../../utils/perimetre';

interface Props {
  /** Carte qui ouvre la liste : sert à placer la liste et à lui rendre le focus à la fermeture. */
  ancre: React.RefObject<HTMLElement>;
  organisation: string;
  agences: AgenceContexteItem[];
  chargement: boolean;
  erreur: string;
  /** Agence affichée (null : toutes les agences). */
  selection: string | null;
  onChoisir: (agenceId: string | null) => void;
  onGererAgences: () => void;
  onReessayer: () => void;
  onFermer: () => void;
}

const LARGEUR = 320;
/** Au-delà, un champ de recherche aide ; en dessous, la liste se lit d'un coup d'œil. */
const SEUIL_RECHERCHE = 6;

/**
 * Liste du sélecteur de périmètre.
 *  - En portail et en position fixe : le menu latéral coupe tout ce qui dépasse de ses bords (c'était la cause des textes rognés).
 *  - À droite de la carte sur ordinateur ; sous la carte, à sa largeur, quand la place manque (tiroir mobile).
 *  - Combobox accessible : le focus reste dans la recherche, les flèches parcourent les options (aria-activedescendant),
 *    Entrée choisit, Échap ferme et rend le focus à la carte.
 *  - Agences regroupées par ville : la ville n'est plus répétée sous chaque nom. L'agence affichée porte une coche
 *    (la couleur n'est pas seule à le dire).
 */
export default function SelecteurPerimetre({
  ancre, organisation, agences, chargement, erreur, selection, onChoisir, onGererAgences, onReessayer, onFermer,
}: Props) {
  const idBase = useId();
  const listeRef = useRef<HTMLDivElement>(null);
  const champRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [recherche, setRecherche] = useState('');
  const [position, setPosition] = useState<React.CSSProperties | null>(null);

  const groupes = useMemo(() => agencesParVille(agences, recherche), [agences, recherche]);
  // Options dans l'ordre affiché : « Toutes les agences » (masquée pendant une recherche), puis les agences.
  const options = useMemo(
    () => [...(recherche.trim() ? [] : [null]), ...groupes.flatMap((g) => g.agences.map((a) => a.id))] as (string | null)[],
    [groupes, recherche],
  );
  const [actif, setActif] = useState(0);
  useEffect(() => {
    const i = options.indexOf(selection);
    setActif(i >= 0 ? i : 0);
  }, [options, selection]);

  const idOption = (id: string | null) => `${idBase}-${id ?? 'toutes'}`;

  // Placement à côté de la carte, recalculé au redimensionnement et au défilement.
  useLayoutEffect(() => {
    const placer = () => {
      const r = ancre.current?.getBoundingClientRect();
      if (!r) return;
      const marge = 12;
      const aDroite = r.right + marge + LARGEUR <= window.innerWidth - marge;
      if (aDroite) {
        const top = Math.max(marge, Math.min(r.top, window.innerHeight - 360));
        setPosition({ left: r.right + marge, top, width: LARGEUR, maxHeight: window.innerHeight - top - marge });
      } else {
        const top = r.bottom + 8;
        setPosition({ left: r.left, top, width: r.width, maxHeight: window.innerHeight - top - marge });
      }
    };
    placer();
    window.addEventListener('resize', placer);
    window.addEventListener('scroll', placer, true);
    return () => {
      window.removeEventListener('resize', placer);
      window.removeEventListener('scroll', placer, true);
    };
  }, [ancre]);

  // Fermeture au clic extérieur (la carte elle-même bascule l'ouverture).
  useEffect(() => {
    const surPointeur = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (listeRef.current?.contains(cible) || ancre.current?.contains(cible)) return;
      onFermer();
    };
    document.addEventListener('pointerdown', surPointeur);
    return () => document.removeEventListener('pointerdown', surPointeur);
  }, [ancre, onFermer]);

  // Focus à l'ouverture, une fois la liste placée (elle n'existe pas avant) : la recherche si elle existe, sinon la liste.
  const placee = position !== null;
  useEffect(() => {
    if (placee) (champRef.current ?? optionsRef.current)?.focus();
  }, [placee]);

  // L'option active reste visible quand on la déplace au clavier.
  useEffect(() => {
    const el = document.getElementById(idOption(options[actif] ?? null));
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [actif, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const fermerEtRendreFocus = () => {
    onFermer();
    ancre.current?.focus();
  };

  const surTouche = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActif(0); }
    else if (e.key === 'End') { e.preventDefault(); setActif(options.length - 1); }
    else if (e.key === 'Enter' && options.length) { e.preventDefault(); onChoisir(options[actif] ?? null); }
    else if (e.key === 'Escape') { e.preventDefault(); fermerEtRendreFocus(); }
    else if (e.key === 'Tab') onFermer();
  };

  const avecRecherche = agences.length > SEUIL_RECHERCHE;
  const idListe = `${idBase}-liste`;

  const option = (id: string | null, contenu: React.ReactNode, extra = '') => {
    const index = options.indexOf(id);
    const choisie = id === selection;
    return (
      <div
        key={id ?? 'toutes'}
        id={idOption(id)}
        role="option"
        aria-selected={choisie}
        className={`perimetre-option${choisie ? ' is-choisie' : ''}${index === actif ? ' is-active' : ''}${extra}`}
        onMouseEnter={() => setActif(index)}
        onClick={() => onChoisir(id)}
      >
        {contenu}
        <span className="perimetre-option__coche" aria-hidden="true">{choisie && <CheckIcon size={16} />}</span>
      </div>
    );
  };

  if (!position) return null;

  return createPortal(
    <div
      ref={listeRef}
      className="perimetre-liste"
      style={{ position: 'fixed', zIndex: 75, ...position }}
      onKeyDown={surTouche}
      tabIndex={-1}
    >
      <div className="perimetre-liste__entete">
        <span className="perimetre-liste__surtitre">Afficher</span>
        <span className="perimetre-liste__org" title={organisation}>{organisation}</span>
      </div>

      {avecRecherche && (
        <label className="perimetre-recherche">
          <SearchIcon size={16} aria-hidden="true" />
          <input
            ref={champRef}
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Agence ou ville"
            aria-label="Rechercher une agence ou une ville"
            role="combobox"
            aria-expanded="true"
            aria-controls={idListe}
            aria-activedescendant={options.length ? idOption(options[actif] ?? null) : undefined}
            aria-autocomplete="list"
          />
        </label>
      )}

      <div
        ref={optionsRef}
        id={idListe}
        role="listbox"
        aria-label={`Périmètre affiché dans ${organisation}`}
        className="perimetre-liste__options"
        // Sans recherche, la liste elle-même prend le focus et annonce l'option active.
        tabIndex={avecRecherche ? -1 : 0}
        aria-activedescendant={!avecRecherche && options.length ? idOption(options[actif] ?? null) : undefined}
      >
        {!recherche.trim() && option(
          null,
          <>
            <span className="perimetre-option__icone" aria-hidden="true"><LayoutGridIcon size={16} /></span>
            <span className="perimetre-option__texte">
              <span className="perimetre-option__nom">Toutes les agences</span>
              <span className="perimetre-option__detail">
                {chargement || erreur ? 'Vue du réseau' : `Vue du réseau · ${nombreAgences(agences.length)}`}
              </span>
            </span>
          </>,
          ' perimetre-option--reseau',
        )}

        {chargement && (
          <div role="status" aria-label="Chargement des agences" className="perimetre-squelettes">
            {[0, 1, 2, 3].map((i) => <span key={i} className="perimetre-squelette" />)}
          </div>
        )}

        {erreur && (
          <div role="alert" className="perimetre-message">
            <span>{erreur}</span>
            <button type="button" className="perimetre-lien" onClick={onReessayer}>Réessayer</button>
          </div>
        )}

        {!chargement && !erreur && groupes.map((groupe) => (
          <div key={groupe.ville} role="group" aria-label={groupe.ville} className="perimetre-groupe">
            <div className="perimetre-groupe__titre" aria-hidden="true">{groupe.ville}</div>
            {groupe.agences.map((agence) => option(
              agence.id,
              <>
                <span className="perimetre-option__icone" aria-hidden="true"><StoreIcon size={16} /></span>
                <span className="perimetre-option__texte">
                  <span className="perimetre-option__nom" title={agence.nom}>{agence.nom}</span>
                </span>
              </>,
            ))}
          </div>
        ))}

        {!chargement && !erreur && recherche.trim() && groupes.length === 0 && (
          <div className="perimetre-message">
            <span>Aucune agence ne correspond à « {recherche.trim()} ».</span>
            <button type="button" className="perimetre-lien" onClick={() => { setRecherche(''); champRef.current?.focus(); }}>
              Effacer la recherche
            </button>
          </div>
        )}
      </div>

      <div className="perimetre-liste__pied">
        <button type="button" className="perimetre-lien" onClick={onGererAgences}>Gérer les agences</button>
      </div>
    </div>,
    document.body,
  );
}
