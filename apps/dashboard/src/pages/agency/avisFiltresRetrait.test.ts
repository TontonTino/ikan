// CX-04 : « les filtres actifs sont affichés et supprimables un par un ». Même enchaînement que la page « Avis du réseau » :
// filtresActifs() (liste affichée) -> retirerFiltre() = reduireFiltres({ type: 'definir', champ: cle, valeur: 'all' | '' }) -> parametresApi().
import { describe, expect, it } from 'vitest';
import sourcePage from './FeedbacksPage.tsx?raw';
import { FILTRES_INITIAUX, filtresActifs, parametresApi, reduireFiltres, type FiltresAvis } from './avisFiltres';

const AIDE = { nomAgence: (id: string) => (id === 'ag-1' ? 'Agence Lyon' : undefined), libelleTheme: (t: string) => `Thème ${t}` };
const TOUS: FiltresAvis = {
  ...FILTRES_INITIAUX, agenceId: 'ag-1', periode: '30', sentiment: 'negatif', theme: 'attente', note: '5', criticite: 'elevee',
  discordance: 'oui', recherche: 'retard', page: 3,
};
const CLES = ['agenceId', 'sentiment', 'theme', 'periode', 'note', 'criticite', 'discordance', 'recherche'] as const;
const PARAMETRE_API: Record<(typeof CLES)[number], string> = {
  agenceId: 'agence_id', sentiment: 'sentiment', theme: 'theme', periode: 'date_debut', note: 'note', criticite: 'criticite', discordance: 'discordance', recherche: 'q',
};

// Ce que fait le bouton « Retirer le filtre … » de FeedbacksPage (retirerFiltre).
const retirer = (f: FiltresAvis, cle: (typeof CLES)[number]) => reduireFiltres(f, { type: 'definir', champ: cle, valeur: cle === 'recherche' ? '' : 'all' });

describe('les huit filtres combinés sont tous affichés, avec leur libellé exact', () => {
  it('liste des filtres actifs', () => {
    expect(filtresActifs(TOUS, AIDE)).toEqual([
      { cle: 'agenceId', libelle: 'Agence : Agence Lyon' },
      { cle: 'sentiment', libelle: 'Ton : Négatif' },
      { cle: 'theme', libelle: 'Thème : Thème attente' },
      { cle: 'periode', libelle: 'Période : 30 derniers jours' },
      { cle: 'note', libelle: 'Note : 5/5' },
      { cle: 'criticite', libelle: 'Gravité : Élevée' },
      { cle: 'discordance', libelle: 'Avis contradictoires' },
      { cle: 'recherche', libelle: 'Recherche : « retard »' },
    ]);
  });

  it('tous les filtres sont envoyés au serveur en même temps (ET)', () => {
    const p = parametresApi(TOUS, { maintenant: new Date('2026-10-30T10:00:00') });
    for (const cle of CLES) expect(p, cle).toHaveProperty(PARAMETRE_API[cle]);
    expect(p).toMatchObject({ agence_id: 'ag-1', sentiment: 'negatif', theme: 'attente', note: 5, criticite: 'elevee', discordance: true, q: 'retard' });
  });
});

describe('retrait un par un', () => {
  it.each(CLES)('retirer « %s » ne retire que lui, de la liste affichée comme de la requête', (cle) => {
    const apres = retirer(TOUS, cle);
    const avant = filtresActifs(TOUS, AIDE).map((f) => f.cle);
    expect(filtresActifs(apres, AIDE).map((f) => f.cle)).toEqual(avant.filter((c) => c !== cle));
    const p = parametresApi(apres, { maintenant: new Date('2026-10-30T10:00:00') });
    expect(p).not.toHaveProperty(PARAMETRE_API[cle]);
    for (const autre of CLES.filter((c) => c !== cle)) expect(p, `${autre} conservé`).toHaveProperty(PARAMETRE_API[autre]);
    expect(apres.page).toBe(0);                                      // un changement de filtre revient à la page 1
  });

  it('retirer tous les filtres un par un, dans n’importe quel ordre, ramène à l’état initial', () => {
    let f = TOUS;
    for (const cle of [...CLES].reverse()) f = retirer(f, cle);
    expect(filtresActifs(f, AIDE)).toEqual([]);
    expect(f).toEqual({ ...FILTRES_INITIAUX, page: 0 });
    expect(parametresApi(f)).toEqual({ limit: 25, offset: 0 });
  });

  it('« Tout réinitialiser » vide la liste et conserve l’agence imposée par la page', () => {
    const f = reduireFiltres(TOUS, { type: 'reinitialiser', agenceId: 'ag-fixe' });
    expect(filtresActifs(f, { ...AIDE, agenceFixe: true })).toEqual([]);
    expect(f.agenceId).toBe('ag-fixe');
    expect(reduireFiltres(TOUS, { type: 'reinitialiser' }).agenceId).toBe('all');
  });

  it('l’agence imposée par la page n’est jamais proposée comme filtre à retirer', () => {
    expect(filtresActifs(TOUS, { ...AIDE, agenceFixe: true }).map((f) => f.cle)).not.toContain('agenceId');
  });
});

describe('le bouton de retrait de la page fait bien ce qui est testé ci-dessus', () => {
  const source = sourcePage.replace(/\r\n/g, '\n');
  it('même action que retirer() : « all » sauf la recherche qui revient à vide (et vide aussi la saisie)', () => {
    expect(source).toContain("dispatch({ type: 'definir', champ: cle, valeur: cle === 'recherche' ? '' : 'all' })");
    expect(source).toContain("if (cle === 'recherche') setSaisie('')");
  });
  it('un bouton accessible par filtre actif, plus un bouton « Tout réinitialiser »', () => {
    expect(source).toContain('aria-label={`Retirer le filtre ${f.libelle}`}');
    expect(source).toContain('Tout réinitialiser');
  });
});
