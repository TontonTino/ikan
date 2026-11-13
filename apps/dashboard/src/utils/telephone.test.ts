import { describe, expect, it } from 'vitest';
import { formaterTelephone, telephoneCompact } from './telephone';

describe('formaterTelephone (lot 6)', () => {
  it('un numéro du Burkina Faso s’affiche par groupes de deux chiffres', () => {
    expect(formaterTelephone('+22656465888')).toBe('+226 56 46 58 88');
    expect(formaterTelephone('+226 72 95 92 48')).toBe('+226 72 95 92 48');
    expect(formaterTelephone('0022670123456')).toBe('+226 70 12 34 56');
    expect(formaterTelephone('+226-70.12.34.56')).toBe('+226 70 12 34 56');
  });

  it('8 chiffres sans indicatif : groupés, sans indicatif inventé', () => {
    expect(formaterTelephone('70123456')).toBe('70 12 34 56');
  });

  it('un autre numéro reste tel que saisi (pas de regroupement deviné)', () => {
    expect(formaterTelephone('+33 6 12 34 56 78')).toBe('+33 6 12 34 56 78');
    expect(formaterTelephone('+2257012345')).toBe('+2257012345');
  });

  it('vide ou absent : chaîne vide', () => {
    expect(formaterTelephone('')).toBe('');
    expect(formaterTelephone(null)).toBe('');
    expect(formaterTelephone(undefined)).toBe('');
  });

  it('le lien « tel: » utilise la forme compacte', () => {
    expect(telephoneCompact('+226 56 46 58 88')).toBe('+22656465888');
  });
});
