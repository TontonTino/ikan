import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LegendeVolume from './LegendeVolume';
import { FAIBLE_VOLUME_POINT } from '../../pages/cx/siege/siegeData';
import sourcePicture from '../agent/YamPicture3D.tsx?raw';

describe('légende des points de courbe', () => {
  it('montre un point plein et un point creux, chacun avec sa phrase (la forme dit la différence)', () => {
    const html = renderToStaticMarkup(<LegendeVolume />);
    expect(html).toContain(`${FAIBLE_VOLUME_POINT} avis ou plus`);
    expect(html).toContain(`Moins de ${FAIBLE_VOLUME_POINT} avis : à lire avec prudence`);
    expect(html).toContain('fill="var(--dataviz-positive)"');
    expect(html).toContain('fill="var(--color-surface)"');
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(2);
  });
});

describe('image 3D de YAM', () => {
  it('importée dans le build (assets/), plus servie depuis un dossier public à part', () => {
    expect(sourcePicture).toContain("from '../../assets/yam/yam-3d-face.png'");
    expect(sourcePicture).not.toContain('"/yam/');
  });

  it('si elle ne charge pas, la mascotte dessinée la remplace (jamais d’icône cassée)', () => {
    expect(sourcePicture).toContain('onError={() => setEnErreur(true)}');
    expect(sourcePicture).toContain('if (enErreur) return <YamMascot');
  });
});
