import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ParametresVue, type ParametresVueProps } from './AdminSettingsPage';
import source from './AdminSettingsPage.tsx?raw';

const SETTINGS = {
  id: 's1', nom_application: 'IKAN AI', seuil_alerte_defaut: 80, retention_mois: 24, mode_ia: 'hybride', notifications_email_actives: true,
  date_modification: '2026-09-28T09:49:47Z', valeurs_hors_bornes: [] as string[],
  bornes: { retention_mois: { min: 1, max: 120 }, nom_application: { max_caracteres: 255 } },
};
const rendu = (extra: Partial<ParametresVueProps> = {}) =>
  renderToStaticMarkup(
    <ParametresVue settings={SETTINGS} nom="IKAN AI" retentionTexte="24" erreurs={{}} saving={false} onNom={() => {}} onRetention={() => {}} onSave={() => {}} {...extra} />,
  );

describe('Paramètres système — paramètres sans effet cachés', () => {
  it('n’affiche ni le seuil par défaut, ni le mode d’analyse, ni les notifications e-mail', () => {
    const html = rendu();
    for (const interdit of ['param-seuil-alerte', 'param-mode-ia', 'Mode d’analyse', 'Seuil d\'alerte par défaut', 'notifications par e-mail', 'type="checkbox"', 'type="range"']) {
      expect(html).not.toContain(interdit);
    }
  });

  it('affiche le nom, la durée de conservation et la note « bientôt disponibles »', () => {
    const html = rendu();
    expect(html).toContain('id="param-nom"');
    expect(html).toContain('id="param-retention"');
    expect(html).toContain('Autres paramètres : bientôt disponibles');
    expect(html).toContain('De 1 à 120 mois');
  });

  it('n’envoie que les deux paramètres affichés (mise à jour partielle : les autres ne sont jamais touchés)', () => {
    expect(source).toMatch(/updateSettings\(\{ nom_application: nom\.trim\(\), retention_mois: Number\(retentionTexte\.trim\(\)\) \}\)/);
    for (const cache of ['seuil_alerte_defaut:', 'mode_ia:', 'notifications_email_actives:']) {
      expect(source.split('updateSettings(')[1].split(')')[0]).not.toContain(cache);
    }
  });
});

describe('Paramètres système — erreurs', () => {
  it('marque le champ fautif et affiche le message du serveur', () => {
    const html = rendu({ erreurs: { retention_mois: 'La durée de conservation doit être un nombre entier de mois, de 1 à 120.' } });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('La durée de conservation doit être un nombre entier de mois, de 1 à 120.');
    expect(html).toContain('aria-describedby="param-retention-erreur"');
  });

  it('aucune erreur : aucun champ marqué invalide', () => {
    expect(rendu()).not.toContain('aria-invalid');
  });

  it('le contrôle côté interface précède l’envoi', () => {
    expect(source.indexOf('erreurRetention(retentionTexte')).toBeGreaterThan(-1);
    expect(source.indexOf('erreurRetention(retentionTexte')).toBeLessThan(source.indexOf('systemApi.updateSettings'));
    expect(source).toMatch(/if \(e1 \|\| e2\) return;/);
  });

  it('valeur historique hors bornes : avertissement sans la corriger en silence', () => {
    const html = rendu({ settings: { ...SETTINGS, retention_mois: -5, valeurs_hors_bornes: ['retention_mois'] }, retentionTexte: '-5' });
    expect(html).toContain('hors des limites autorisées');
    expect(html).toContain('-5 mois');
    expect(rendu()).not.toContain('hors des limites autorisées');
  });
});
