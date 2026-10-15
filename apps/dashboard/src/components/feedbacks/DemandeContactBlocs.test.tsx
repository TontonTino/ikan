import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AvertissementReponse, ConfirmationRecontact, ConsentementContact, CoordonneesMasquees, InfoTraitement,
  MESSAGE_AVERTISSEMENT_REPONSE, MESSAGE_CONFIRMATION_RECONTACT,
} from './DemandeContactBlocs';
import WhatsAppReplyButton from './WhatsAppReplyButton';
import sourcePageDemandes from '../../pages/agency/DemandesRappelPage.tsx?raw';
import sourceFicheAvis from './FeedbackTreatmentModal.tsx?raw';
import sourceSectionReponse from './ReponseClientSection.tsx?raw';

/** Parcourt l'arbre d'éléments React (sans DOM) et renvoie ceux qui satisfont `test`. */
function trouver(noeud: React.ReactNode, test: (e: React.ReactElement) => boolean, trouves: React.ReactElement[] = []): React.ReactElement[] {
  React.Children.forEach(noeud, (enfant) => {
    if (!React.isValidElement(enfant)) return;
    if (test(enfant)) trouves.push(enfant);
    trouver((enfant.props as { children?: React.ReactNode }).children, test, trouves);
  });
  return trouves;
}

const arbre = (props: Partial<React.ComponentProps<typeof ConfirmationRecontact>> = {}) => {
  const surAnnuler = vi.fn();
  const surConfirmer = vi.fn();
  const racine = ConfirmationRecontact({ onAnnuler: surAnnuler, onConfirmer: surConfirmer, ...props }) as React.ReactElement;
  const boutons = trouver(racine, (e) => e.type === 'button');
  return { racine, boutons, surAnnuler, surConfirmer };
};

describe('confirmation avant « Marquer comme recontacté »', () => {
  it('affiche le message exact et deux boutons Annuler / Confirmer', () => {
    const html = renderToStaticMarkup(<ConfirmationRecontact onAnnuler={() => {}} onConfirmer={() => {}} />);
    expect(MESSAGE_CONFIRMATION_RECONTACT).toBe('Les coordonnées du client seront masquées une fois la demande traitée.');
    expect(html).toContain(MESSAGE_CONFIRMATION_RECONTACT);
    expect(html).toContain('Annuler');
    expect(html).toContain('Confirmer');
    expect(html).toContain('role="group"');
  });

  it('boutons natifs (opérables au clavier), type="button", cibles de 44 px minimum', () => {
    const { boutons } = arbre();
    expect(boutons).toHaveLength(2);
    for (const b of boutons) {
      const p = b.props as { type: string; style: { minHeight: number; minWidth: number } };
      expect(p.type).toBe('button');
      expect(p.style.minHeight).toBeGreaterThanOrEqual(44);
      expect(p.style.minWidth).toBeGreaterThanOrEqual(44);
    }
  });

  it('Annuler n’enregistre rien, Confirmer enregistre', () => {
    const { boutons, surAnnuler, surConfirmer } = arbre();
    const [annuler, confirmer] = boutons.map((b) => b.props as { onClick: () => void; children: React.ReactNode });
    annuler.onClick();
    expect(surAnnuler).toHaveBeenCalledTimes(1);
    expect(surConfirmer).not.toHaveBeenCalled();
    confirmer.onClick();
    expect(surConfirmer).toHaveBeenCalledTimes(1);
  });

  it('Échap annule, les autres touches non', () => {
    const { racine, surAnnuler } = arbre();
    const { onKeyDown } = racine.props as { onKeyDown: (e: { key: string }) => void };
    onKeyDown({ key: 'Enter' });
    onKeyDown({ key: 'a' });
    expect(surAnnuler).not.toHaveBeenCalled();
    onKeyDown({ key: 'Escape' });
    expect(surAnnuler).toHaveBeenCalledTimes(1);
  });

  it('le focus initial est sur « Annuler » (choix le moins lourd de conséquences) et pas sur « Confirmer »', () => {
    const [annuler, confirmer] = arbre().boutons.map((b) => b.props as { autoFocus?: boolean });
    expect(annuler.autoFocus).toBe(true);
    expect(confirmer.autoFocus).toBeUndefined();
  });

  it('pendant l’enregistrement les deux boutons sont désactivés (pas de double envoi)', () => {
    for (const b of arbre({ chargement: true }).boutons) expect((b.props as { disabled: boolean }).disabled).toBe(true);
    for (const b of arbre({ chargement: false }).boutons) expect((b.props as { disabled: boolean }).disabled).toBe(false);
  });
});

describe('avertissement à côté du formulaire « Enregistrer une réponse »', () => {
  it('dit que l’enregistrement marque la demande comme recontactée et masque les coordonnées', () => {
    const html = renderToStaticMarkup(<AvertissementReponse />);
    expect(MESSAGE_AVERTISSEMENT_REPONSE).toBe('Enregistrer la réponse marque la demande comme recontactée et masque les coordonnées du client.');
    expect(html).toContain(MESSAGE_AVERTISSEMENT_REPONSE);
    expect(html).toContain('role="note"');
    expect(html).toContain('<svg'); // icône + texte, jamais la couleur seule
  });
});

describe('câblage dans les écrans (garde au niveau du source : pas d’environnement DOM dans ce projet)', () => {
  const lire = (source: string) => source.split('\r\n').join('\n');

  it('page Demandes de rappel : le bouton ouvre la confirmation, seule la confirmation appelle l’API', () => {
    const page = lire(sourcePageDemandes);
    expect(page).toContain('Marquer comme recontacté');
    expect(page).not.toMatch(/onClick=\{\(\) => marquerTraitee\(/);          // le bouton n'enregistre jamais directement
    expect(page.match(/marquerTraitee\(/g)?.length).toBe(1);                   // un seul appel : celui de onConfirmer
    expect(page).toMatch(/onConfirmer=\{\(\) => marquerTraitee\(d\.id\)\}/);
    expect(page).toContain('<ConfirmationRecontact');
    expect(page).not.toContain('Marquer traitée');
  });

  it('section « Répondre au client » : l’avertissement précède le formulaire et ne s’affiche que pour une demande non traitée', () => {
    const section = lire(sourceSectionReponse);
    const avertissement = section.indexOf('<AvertissementReponse />');
    const formulaire = section.indexOf('<form onSubmit={onSubmit}>');
    expect(avertissement).toBeGreaterThan(-1);
    expect(avertissement).toBeLessThan(formulaire);
    expect(section).toMatch(/enregistrerTraiteLaDemande\(demande\) && <AvertissementReponse \/>/);
    // la fiche d'un avis utilise cette section (et n'a plus de second formulaire de réponse)
    const fiche = lire(sourceFicheAvis);
    expect(fiche).toContain('<ReponseClientSection');
    expect(fiche).not.toContain('Enregistrer une réponse au client');
  });

  it('aucun bouton WhatsApp pour une demande masquée, dans la page comme dans la fiche', () => {
    expect(lire(sourcePageDemandes)).toMatch(/isAgencyManager && !d\.coordonnees_masquees && \(/);
    expect(lire(sourceFicheAvis)).toMatch(/isAgencyManager && !feedback\.demande_contact\.coordonnees_masquees && \(/);
  });
});

describe('état masqué, consentement et traçabilité', () => {
  it('coordonnées masquées : message explicite (texte + icône)', () => {
    const html = renderToStaticMarkup(<CoordonneesMasquees />);
    expect(html).toContain('Coordonnées masquées : la demande a été traitée.');
    expect(html).toContain('<svg');
  });

  it('consentement : oui avec date et durée annoncée, sans aucune date d’expiration', () => {
    const html = renderToStaticMarkup(
      <ConsentementContact demande={{ traitee: false, consentement_contact: true, consentement_date: '2026-10-01T10:00:00Z', consentement_retention_mois: 24 }} />,
    );
    expect(html).toContain('Consentement : oui');
    expect(html).toContain('01 octobre 2026');
    expect(html).toContain('conservation annoncée au client : 24 mois');
    expect(html).not.toMatch(/jusqu|expir|supprim|purg/i);
  });

  it('lignes antérieures à la migration 030 : « Consentement non enregistré », sans blocage', () => {
    expect(renderToStaticMarkup(<ConsentementContact demande={{ traitee: false }} />)).toContain('Consentement non enregistré');
    expect(renderToStaticMarkup(<ConsentementContact demande={{ traitee: false, consentement_contact: null }} />)).toContain('Consentement non enregistré');
    expect(renderToStaticMarkup(<ConsentementContact demande={{ traitee: false, consentement_contact: false }} />)).toContain('Consentement : non');
  });

  it('traitement : date et auteur, ou « date non enregistrée » pour une demande traitée avant la migration 032', () => {
    const html = renderToStaticMarkup(<InfoTraitement demande={{ traitee: true, date_traitement: '2026-10-13T09:30:00Z', traitee_par_nom: 'Awa Traoré' }} />);
    expect(html).toContain('Recontactée le 13 octobre 2026');
    expect(html).toContain('par Awa Traoré');
    expect(renderToStaticMarkup(<InfoTraitement demande={{ traitee: true }} />)).toContain('Recontactée (date non enregistrée)');
    expect(renderToStaticMarkup(<InfoTraitement demande={{ traitee: false }} />)).toBe('');
  });
});

describe('bouton WhatsApp et demande masquée', () => {
  it('masquée : aucun bouton et pas le faux message « numéro non laissé »', () => {
    expect(renderToStaticMarkup(<WhatsAppReplyButton telephone={undefined} telephoneWhatsapp={null} masque />)).toBe('');
  });

  it('non masquée : comportement inchangé (bouton avec numéro, message sans numéro)', () => {
    expect(renderToStaticMarkup(<WhatsAppReplyButton telephone="+226 70 12 34 56" telephoneWhatsapp="22670123456" />)).toContain('Répondre au client');
    expect(renderToStaticMarkup(<WhatsAppReplyButton telephone={undefined} />)).toContain('n’a pas laissé de numéro');
  });
});
