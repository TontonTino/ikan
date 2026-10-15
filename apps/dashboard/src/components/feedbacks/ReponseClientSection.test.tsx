import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReponseClientFormulaire } from './ReponseClientSection';
import { MESSAGE_AVERTISSEMENT_REPONSE } from './DemandeContactBlocs';
import type { EtatBrouillon } from '../../utils/brouillonReponse';
import sourceSection from './ReponseClientSection.tsx?raw';

const noop = () => undefined;
const BROUILLON: EtatBrouillon = {
  statut: 'ok',
  brouillon: { disponible: true, registre: 'critique', texte: 'Bonjour,\n\nNous vous présentons nos excuses.', canal_suggere: 'telephone' },
};

function rendu(over: Partial<React.ComponentProps<typeof ReponseClientFormulaire>> = {}) {
  return renderToStaticMarkup(
    <ReponseClientFormulaire
      demande={null}
      brouillon={{ statut: 'ok', brouillon: { disponible: false, raison: 'aucun_suivi' } }}
      contenu=""
      canal="telephone"
      enregistrement={false}
      confirmationRemplacement={false}
      onContenu={noop} onCanal={noop} onUtiliserBrouillon={noop} onConfirmerRemplacement={noop} onAnnulerRemplacement={noop} onSubmit={noop}
      {...over}
    />,
  );
}

describe('section « Répondre au client »', () => {
  it('visible sans aucune demande de contact : formulaire vide, 5 canaux dont « Autre / sans contact »', () => {
    const html = rendu();
    expect(html).toContain('Répondre au client');
    expect(html).toContain('<textarea');
    for (const libelle of ['Téléphone', 'WhatsApp', 'E-mail', 'SMS', 'Autre / sans contact']) expect(html).toContain(libelle);
    expect(html).toContain('0 / 2000 caractères');
  });

  it('avis sans suivi ou réponse déjà enregistrée : ni brouillon ni bouton « Utiliser ce brouillon »', () => {
    for (const raison of ['aucun_suivi', 'reponse_existante']) {
      const html = rendu({ brouillon: { statut: 'ok', brouillon: { disponible: false, raison, texte: null } } });
      expect(html).not.toContain('Utiliser ce brouillon');
      expect(html).not.toContain('Brouillon proposé');
      expect(html).not.toContain('remerci'); // pas de bouton « remerciement »
    }
  });

  it('brouillon disponible : texte, registre, mention « aucun message envoyé », bouton', () => {
    const html = rendu({ brouillon: BROUILLON });
    expect(html).toContain('Brouillon proposé · Avis critique');
    expect(html).toContain('Nous vous présentons nos excuses.');
    expect(html).toContain('Utiliser ce brouillon');
    expect(html).toContain('Relisez-le et adaptez-le');
    expect(html).toContain('n’envoie aucun message');
  });

  it('chargement : message d’attente, formulaire utilisable ; erreur : message neutre, formulaire utilisable', () => {
    const charge = rendu({ brouillon: { statut: 'chargement' } });
    expect(charge).toContain('Préparation d’un brouillon');
    expect(charge).toContain('<textarea');
    const erreur = rendu({ brouillon: { statut: 'erreur' } });
    expect(erreur).toContain('Le brouillon n’est pas disponible pour le moment');
    expect(erreur).toContain('<textarea');
    expect(erreur).not.toContain('Utiliser ce brouillon');
  });

  it('confirmation avant de remplacer un texte déjà saisi', () => {
    const html = rendu({ brouillon: BROUILLON, contenu: 'Mon texte', confirmationRemplacement: true });
    expect(html).toContain('Remplacer le texte que vous avez saisi');
    expect(html).toContain('Remplacer mon texte');
    expect(html).toContain('Garder mon texte');
    expect(html).not.toContain('>Utiliser ce brouillon<');
  });

  it('avertissement AM-07 seulement pour une demande non traitée', () => {
    expect(rendu({ demande: { traitee: false } })).toContain(MESSAGE_AVERTISSEMENT_REPONSE);
    expect(rendu({ demande: { traitee: true } })).not.toContain(MESSAGE_AVERTISSEMENT_REPONSE);
    expect(rendu({ demande: null })).not.toContain(MESSAGE_AVERTISSEMENT_REPONSE);
  });

  it('bouton d’enregistrement désactivé tant que la zone est vide ou pendant l’enregistrement', () => {
    const desactive = /<button type="submit" disabled=""/;
    expect(rendu({ contenu: '' })).toMatch(desactive);
    expect(rendu({ contenu: '   ' })).toMatch(desactive);
    expect(rendu({ contenu: 'ok', enregistrement: true })).toMatch(desactive);
    expect(rendu({ contenu: 'ok' })).not.toMatch(desactive);
  });

  it('canal courant signalé par aria-pressed, cibles d’au moins 44 px, longueur limitée à 2000', () => {
    const html = rendu({ canal: 'autre' });
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(4);
    expect(html).toContain('min-height:44px');
    expect(html).toContain('maxLength="2000"');
  });

  it('le texte saisi n’est jamais interprété comme du HTML', () => {
    const html = rendu({ contenu: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
  });
});

describe('câblage (garde au niveau du source : pas d’environnement DOM dans ce projet)', () => {
  const src = sourceSection.split('\r\n').join('\n');

  it('le brouillon n’est jamais envoyé : un seul appel d’enregistrement, dans le gestionnaire du formulaire', () => {
    expect(src.match(/envoyerReponseClient\(/g)?.length).toBe(1);
    expect(src.indexOf('envoyerReponseClient(')).toBeGreaterThan(src.indexOf('const soumettre = async'));
  });

  it('le texte saisi est conservé quand l’enregistrement échoue (effacé seulement après le succès de l’appel)', () => {
    const iDebut = src.indexOf('const soumettre = async');
    const iAppel = src.indexOf('await feedbacksApi.envoyerReponseClient');
    const iCatch = src.indexOf('} catch (err)', iAppel);
    const iFinally = src.indexOf('} finally', iCatch);
    expect(iDebut).toBeGreaterThan(-1);
    expect(iAppel).toBeGreaterThan(iDebut);
    expect(src.slice(iDebut, iAppel)).not.toContain('setContenu(');          // rien n'est effacé avant la réponse de l'API
    expect(src.slice(iAppel, iCatch)).toContain("setContenu('')");           // effacé après le succès
    expect(src.slice(iCatch, iFinally)).not.toContain('setContenu(');       // jamais en cas d'échec
  });

  it('un changement d’avis réinitialise la saisie et ignore la réponse tardive du brouillon précédent', () => {
    expect(src.match(/if \(courant\.current === id\) setBrouillon/g)?.length).toBe(2);   // succès ET erreur
    expect(src).toMatch(/courant\.current = feedbackId;[\s\S]*setContenu\(''\)/);
  });
});
