import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YamChatPanel from './YamChatPanel';

const etat = vi.hoisted(() => ({ messages: [] as unknown[], loading: false }));
vi.mock('./useYamChat', () => ({
  MAX_QUESTION_LENGTH: 500,
  useYamChat: () => ({ messages: etat.messages, loading: etat.loading, send: () => undefined, retry: () => undefined, reset: () => undefined }),
}));

const rendre = () => renderToStaticMarkup(<YamChatPanel open onClose={() => undefined} />);

beforeEach(() => {
  etat.messages = [];
  etat.loading = false;
});

describe('panneau YAM : présence', () => {
  it('accueil : rendu 3D détourné AU-DESSUS du texte de bienvenue conservé, avec ses suggestions et son avertissement', () => {
    const html = rendre();
    const image = html.indexOf('/yam/yam-3d-face');
    expect(image).toBeGreaterThan(-1);
    expect(image).toBeLessThan(html.indexOf('Bonjour, je suis'));
    expect(html).toContain('<source type="image/webp" srcSet="/yam/yam-3d-face.webp 1x, /yam/yam-3d-face@2x.webp 2x"');
    expect(html).toContain('src="/yam/yam-3d-face.png"');
    expect(html).toContain('alt="YAM"');
    expect(html).toContain('loading="lazy"');
    expect(html).toMatch(/width="110"[^>]*height="161"|height="161"[^>]*width="110"/);
    expect(html).toContain('Y a-t-il des alertes critiques ?');
    expect(html).toContain('Mes réponses sont générées automatiquement');
    expect(html).toContain('Périmètre :');
    expect(html).toContain('Réponses générées automatiquement : vérifiez-les avant d’agir.');
  });

  it('dès qu’il y a un échange, le rendu 3D disparaît (pas de grande image dans une conversation)', () => {
    etat.messages = [{ id: 'u1', role: 'user', text: 'Bonjour' }];
    expect(rendre()).not.toContain('/yam/yam-3d-face');
  });

  it('attente : mascotte « réflexion » décorative + « YAM analyse vos avis… », indicateurs existants conservés', () => {
    etat.messages = [{ id: 'u1', role: 'user', text: 'Q' }];
    etat.loading = true;
    const html = rendre();
    expect(html).toContain('YAM analyse vos avis…');
    expect(html).toContain('data-yam-state="reflexion"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-yam-state="reflexion"|<svg[^>]*data-yam-state="reflexion"[^>]*aria-hidden="true"/);
    expect(html).toContain('YAM réfléchit');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('yam-dots');
  });

  it('erreur : mascotte « alerte » devant le message, texte et bouton Réessayer inchangés', () => {
    etat.messages = [{ id: 'e1', role: 'error', text: 'Impossible de joindre YAM. Vérifiez votre connexion internet, puis réessayez.', retryQuestion: 'Q' }];
    const html = rendre();
    expect(html).toContain('data-yam-state="alerte"');
    expect(html.indexOf('data-yam-state="alerte"')).toBeLessThan(html.indexOf('Impossible de joindre YAM.'));
    expect(html).toContain('Impossible de joindre YAM. Vérifiez votre connexion internet, puis réessayez.');
    expect(html).toContain('Réessayer');
    expect(html).toContain('role="alert"');
  });
});
