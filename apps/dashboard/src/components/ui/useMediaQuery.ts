import { useEffect, useState } from 'react';

/** Suit une media query CSS (ex. '(min-width: 1025px)'). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Point de rupture où la sidebar passe de tiroir (mobile/tablette) à barre fixe. */
export const DESKTOP_QUERY = '(min-width: 1025px)';
