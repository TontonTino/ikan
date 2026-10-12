import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RichText from './RichText';

const html = (text: string) => renderToStaticMarkup(<RichText text={text} />);

describe('RichText — réponses de YAM', () => {
  it('rend les rubriques en sections distinctes et qualifie hypothèse et recommandation', () => {
    const out = html('**SITUATION**\nTrois avis négatifs.\n\n**CAUSE PROBABLE**\nLes données suggèrent un manque de personnel.\n\n**RECOMMANDATION**\nFormer l’équipe.');
    expect(out).toContain('yam-section--fait');
    expect(out).toContain('Cause probable (hypothèse)');
    expect(out).toContain('yam-section--reco');
    expect(out).toContain('rien n’est exécuté');
  });

  it('accepte les rubriques sans accent, en titre markdown ou suivies de deux-points', () => {
    const out = html('INTERPRETATION\nTexte.\n\n## DONNÉES :\n- 5 avis');
    expect(out).toContain('Interprétation');
    expect(out).toContain('yam-section--donnees');
    expect(out).toContain('<li>5 avis</li>');
  });

  it('ne prend pas un mot courant d’une phrase pour une rubrique', () => {
    const out = html('La situation est stable.');
    expect(out).not.toContain('yam-section');
  });

  it('rend un tableau à tabulations et un tableau markdown', () => {
    expect(html('Agence\tScore\nTunis\t0,9')).toContain('<th>Agence</th>');
    expect(html('| Agence | Score |\n|---|---|\n| Tunis | 0,9 |')).toContain('<td>Tunis</td>');
  });

  it('retire un astérisque isolé mais conserve le gras', () => {
    const out = html('*Mettre en place un suivi\nAvec **gras** conservé.*');
    expect(out).not.toContain('*');
    expect(out).toContain('<strong>gras</strong>');
  });

  it('n’injecte jamais de HTML renvoyé par le modèle', () => {
    expect(html('<script>alert(1)</script>')).not.toContain('<script>');
  });
});
