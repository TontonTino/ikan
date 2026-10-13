import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Feedback } from '../../types';
import { AvisCarteMobile, SignauxAvis } from './avisAffichage';
import BadgeDiscordance from './BadgeDiscordance';

const avis = (discordance: boolean): Feedback => ({
  id: 'f1', qr_code_id: 'q1', note: 4, commentaire: 'Super accueil mais attente', date_soumission: '2026-10-10T10:00:00Z', statut_traitement: 'nouveau',
  analyse_ia: { id: 'a1', sentiment: 'negatif', criticite: 'elevee', theme_principal: 'attente', discordance_detectee: discordance },
} as Feedback);

describe('badge de discordance : icône + texte', () => {
  it('affiche une icône (svg) ET le texte « Avis contradictoire »', () => {
    const html = renderToStaticMarkup(<BadgeDiscordance discordance />);
    expect(html).toContain('<svg');
    expect(html).toContain('Avis contradictoire');
    expect(html).toContain('aria-hidden="true"'); // l'icône est décorative : le texte porte le sens
  });

  it('absent quand il n’y a pas de discordance', () => {
    expect(renderToStaticMarkup(<BadgeDiscordance discordance={false} />)).toBe('');
    expect(renderToStaticMarkup(<BadgeDiscordance />)).toBe('');
  });

  it('présent dans le tableau (cellule note et ton)', () => {
    const html = renderToStaticMarkup(<SignauxAvis feedback={avis(true)} />);
    expect(html).toContain('Avis contradictoire');
    expect(html).toContain('<svg');
    expect(renderToStaticMarkup(<SignauxAvis feedback={avis(false)} />)).not.toContain('Avis contradictoire');
  });

  it('présent sur la carte mobile, avec les autres signaux en texte', () => {
    const html = renderToStaticMarkup(<AvisCarteMobile feedback={avis(true)} afficherAgence={false} onConsulter={() => {}} />);
    expect(html).toContain('feedbacks-mobile-card');
    expect(html).toContain('Avis contradictoire');
    expect(html).toContain('<svg');
    expect(html).toContain('Élevée'); // gravité en texte
    expect(html).toContain('Négatif'); // ton en texte
    expect(html).toContain('Consulter');
    expect(renderToStaticMarkup(<AvisCarteMobile feedback={avis(false)} afficherAgence={false} onConsulter={() => {}} />)).not.toContain('Avis contradictoire');
  });
});
