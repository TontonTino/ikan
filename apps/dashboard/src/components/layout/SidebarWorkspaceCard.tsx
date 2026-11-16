import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { agencesApi } from '../../services/api';
import type { AgenceContexteItem, User } from '../../types';
import { ChevronRightIcon, SelecteurIcon } from '../common/Icons';
import Tooltip from '../ui/Tooltip';
import { initialesOrganisation } from '../../utils/initialesOrganisation';
import { agenceAffichee } from '../../utils/perimetre';
import { logoOrganisation } from '../../utils/logoOrganisation';
import SelecteurPerimetre from './SelecteurPerimetre';

interface SidebarWorkspaceCardProps {
  user: User | null;
  collapsed?: boolean;
}

/** « Agence Pissy » → tel quel ; « Pissy » → « Agence Pissy ». */
const nomAgence = (nom: string) => (nom.trim().toLowerCase().startsWith('agence') ? nom.trim() : `Agence ${nom.trim()}`);

/**
 * Carte d'espace, en haut du menu : QUI (l'organisation) et QUOI (le périmètre affiché), lisibles sans survol.
 * Même anatomie pour les trois rôles : logo, nom, ligne de contexte, indice d'action à droite.
 *  - Responsable expérience client : sélecteur de périmètre ; le nom seul sur tout le réseau, l'agence en 2e ligne si une est consultée ; icône ⇅.
 *  - Responsable d'agence : son agence ; ouvre « Mon agence » ; icône ›.
 *  - Admin : carte d'information, sans action.
 * Menu replié : le logo seul ; nom et contexte dans l'info-bulle et le nom accessible.
 */
export default function SidebarWorkspaceCard({ user, collapsed = false }: SidebarWorkspaceCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const carteRef = useRef<HTMLButtonElement>(null);
  const [logoEnErreur, setLogoEnErreur] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const [agences, setAgences] = useState<AgenceContexteItem[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');
  useEffect(() => setLogoEnErreur(false), [user?.organisation_logo]);

  const estCx = user?.role === 'cx_manager';
  const estAgence = user?.role === 'agency_manager';
  const estAdmin = user?.role === 'admin';

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try { setAgences((await agencesApi.listContext()).data); }
    catch { setErreur('Impossible de charger les agences.'); }
    finally { setChargement(false); }
  }, []);

  // Responsable expérience client : la liste est chargée une fois, pour afficher le nom de l'agence consultée dès l'arrivée.
  useEffect(() => { if (estCx) void charger(); }, [estCx, charger]);
  // Changer de page referme le sélecteur.
  useEffect(() => setOuvert(false), [location.pathname]);

  if (!user) return null;

  const organisation = estAdmin ? 'IKAN AI' : (user.organisation_nom || 'Organisation');
  const logo = !estAdmin && !logoEnErreur ? logoOrganisation(user.organisation_logo, user.organisation_nom) : null;
  const selection = estCx ? agenceAffichee(location.pathname) : null;
  const agenceCourante = selection ? agences.find((a) => a.id === selection) : undefined;

  const contexte = estAdmin
    ? 'Administration'
    : estAgence
      ? (user.agence_nom ? nomAgence(user.agence_nom) : 'Mon agence')
      : selection
        ? (agenceCourante?.nom ?? 'Agence')
        : 'Toutes les agences';
  // Responsable expérience client sur tout le réseau : le nom de l'organisation suffit, la ligne de contexte n'est pas affichée
  // (elle reste dans le nom accessible). Elle réapparaît dès qu'une agence précise est consultée.
  const contexteVisible = estCx && !selection ? null : contexte;

  const vignette = (
    <span className={`espace-logo${logo?.officiel ? ' espace-logo--officiel' : logo || estAdmin ? ' espace-logo--image' : ''}`} aria-hidden="true">
      {estAdmin ? <img src="/ikanai-mark.png" alt="" /> : logo ? <img src={logo.src} alt="" onError={() => setLogoEnErreur(true)} /> : initialesOrganisation(organisation)}
    </span>
  );
  const textes = !collapsed && (
    <span className="espace-textes">
      <span className="espace-nom" title={organisation}>{organisation}</span>
      {contexteVisible && <span className="espace-contexte" title={contexteVisible}>{contexteVisible}</span>}
    </span>
  );
  const classe = `espace-carte${collapsed ? ' espace-carte--replie' : ''}`;
  const infobulle = (noeud: React.ReactElement) => (collapsed ? (
    <Tooltip content={<><strong>{organisation}</strong>{contexteVisible && <><br />{contexteVisible}</>}</>} placement="right" decorative delay={0}>{noeud}</Tooltip>
  ) : noeud);

  let carte: React.ReactElement;
  if (estCx) {
    carte = (
      <button
        ref={carteRef}
        type="button"
        className={`${classe}${ouvert ? ' is-ouverte' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-label={`Périmètre affiché : ${organisation}, ${contexte}. Changer de périmètre.`}
        onClick={() => setOuvert((o) => !o)}
      >
        {vignette}
        {textes}
        {!collapsed && <span className="espace-indice" aria-hidden="true"><SelecteurIcon size={16} /></span>}
      </button>
    );
  } else if (estAgence) {
    carte = (
      <button
        type="button"
        className={classe}
        aria-label={`${organisation}, ${contexte}. Ouvrir Mon agence.`}
        onClick={() => navigate('/mon-agence')}
      >
        {vignette}
        {textes}
        {!collapsed && <span className="espace-indice" aria-hidden="true"><ChevronRightIcon size={16} /></span>}
      </button>
    );
  } else {
    carte = (
      <div className={`${classe} espace-carte--info`} role="group" aria-label={`${organisation}, ${contexte}`}>
        {vignette}
        {textes}
      </div>
    );
  }

  return (
    <div className="espace">
      {infobulle(carte)}
      {estCx && ouvert && (
        <SelecteurPerimetre
          ancre={carteRef}
          organisation={organisation}
          agences={agences}
          chargement={chargement}
          erreur={erreur}
          selection={selection}
          onChoisir={(id) => { setOuvert(false); navigate(id ? `/agences/${id}/apercu` : '/siege'); }}
          onGererAgences={() => { setOuvert(false); navigate('/admin/gestion-agences'); }}
          onReessayer={() => void charger()}
          onFermer={() => setOuvert(false)}
        />
      )}
    </div>
  );
}
