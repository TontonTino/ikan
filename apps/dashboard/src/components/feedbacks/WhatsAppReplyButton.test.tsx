import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WhatsAppReplyButton from './WhatsAppReplyButton';

const rendu = (props: React.ComponentProps<typeof WhatsAppReplyButton>) =>
  renderToStaticMarkup(<WhatsAppReplyButton {...props} />);

describe('WhatsAppReplyButton — états initiaux', () => {
  it('sans numéro : bouton désactivé et explication claire', () => {
    const html = rendu({ telephone: null, telephoneWhatsapp: null });
    expect(html).toContain('disabled');
    expect(html).toContain('n’a pas laissé de numéro');
    expect(html).not.toContain('Ouvrir WhatsApp');
  });

  it('numéro stocké invalide : message clair, aucun bouton WhatsApp', () => {
    const html = rendu({ telephone: '0100000001', telephoneWhatsapp: null });
    expect(html).toContain('0100000001');
    expect(html).toContain('n’est pas valide');
    expect(html).not.toContain('<button');
  });

  it('numéro valide : bouton « Répondre au client » actif', () => {
    const html = rendu({ telephone: '70 12 34 56', telephoneWhatsapp: '22670123456' });
    expect(html).toContain('Répondre au client');
    expect(html).not.toContain('disabled');
  });
});
