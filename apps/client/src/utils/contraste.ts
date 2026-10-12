/** Rapport de contraste WCAG 2.x entre deux couleurs (texte normal : 4,5:1 minimum, AA). Logique pure, testée par `npm test`. */

export type Rvb = [number, number, number];

export function lireCouleur(hex: string): Rvb {
  const h = hex.trim().replace(/^#/, '');
  const pleine = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(pleine)) throw new Error(`Couleur invalide : ${hex}`);
  return [0, 2, 4].map((i) => parseInt(pleine.slice(i, i + 2), 16)) as Rvb;
}

/** Couleur `fg` avec opacité `alpha` posée sur le fond opaque `bg` (ex. rgba(255,255,255,0.85) sur le vert du bandeau). */
export function melanger(fg: Rvb, bg: Rvb, alpha: number): Rvb {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rvb;
}

export function luminance([r, v, b]: Rvb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(v) + 0.0722 * lin(b);
}

export function rapportContraste(a: Rvb | string, b: Rvb | string): number {
  const la = luminance(typeof a === 'string' ? lireCouleur(a) : a);
  const lb = luminance(typeof b === 'string' ? lireCouleur(b) : b);
  const [clair, fonce] = la >= lb ? [la, lb] : [lb, la];
  return (clair + 0.05) / (fonce + 0.05);
}
