import { describe, expect, it } from 'vitest';
import type { Issue } from '../types';
import { FILTRES_PAR_DEFAUT, TAILLE_PAGE, aDesFiltresActifs, annonceListe, ligneSuivante, parametresListe, texteActions, texteAvis, texteRetard } from './problemesListe';

const MAINTENANT = new Date('2026-11-04T12:00:00Z').getTime();
const JOUR = 86_400_000;
const il = (jours: number) => new Date(MAINTENANT - jours * JOUR).toISOString();

const ligne = (extra: Partial<Issue> = {}): Issue =>
  ({ id: 'i', statut: 'ouverte', severite: 'elevee', premiere_detection: il(5), date_limite_sla: il(3), en_retard: true, ...extra } as unknown as Issue);

describe('paramètres envoyés au serveur : seuls les filtres actifs', () => {
  it('par défaut : page et rien d’autre', () => {
    expect(parametresListe(FILTRES_PAR_DEFAUT)).toEqual({ limit: TAILLE_PAGE, offset: 0 });
  });

  it('chaque filtre actif devient son paramètre', () => {
    expect(parametresListe({ statut: 'resolue', gravite: 'critique', enRetard: true, tri: 'ancien', agenceId: 'ag1' }, 50)).toEqual({
      limit: 50, offset: 50, statut: 'resolue', severite: 'critique', agence_id: 'ag1', en_retard: true, tri: 'ancien',
    });
  });

  it('« En retard » désactivé : aucun paramètre en_retard (jamais en_retard=false, qui voudrait dire « tous les autres »)', () => {
    expect(parametresListe({ ...FILTRES_PAR_DEFAUT, enRetard: false })).not.toHaveProperty('en_retard');
  });

  it('le tri récent est le défaut du serveur : rien n’est envoyé', () => {
    expect(parametresListe({ ...FILTRES_PAR_DEFAUT, tri: 'recent' })).not.toHaveProperty('tri');
  });

  it('filtres actifs : état, gravité ou retard (le tri et l’agence ne comptent pas comme restriction)', () => {
    expect(aDesFiltresActifs(FILTRES_PAR_DEFAUT)).toBe(false);
    expect(aDesFiltresActifs({ ...FILTRES_PAR_DEFAUT, tri: 'ancien', agenceId: 'ag1' })).toBe(false);
    expect(aDesFiltresActifs({ ...FILTRES_PAR_DEFAUT, statut: 'ouverte' })).toBe(true);
    expect(aDesFiltresActifs({ ...FILTRES_PAR_DEFAUT, gravite: 'normale' })).toBe(true);
    expect(aDesFiltresActifs({ ...FILTRES_PAR_DEFAUT, enRetard: true })).toBe(true);
  });
});

describe('le retard : dit en mots, seulement si l’API le dit', () => {
  it('en_retard true : « Délai dépassé depuis N jours »', () => {
    expect(texteRetard(ligne(), MAINTENANT)).toBe('Délai dépassé depuis 3 jours');
    expect(texteRetard(ligne({ date_limite_sla: new Date(MAINTENANT - 3_600_000).toISOString() }), MAINTENANT)).toBe('Délai dépassé aujourd’hui');
  });

  it('en_retard null (pas de délai, ou problème résolu) : RIEN, jamais « à l’heure »', () => {
    expect(texteRetard(ligne({ en_retard: null, date_limite_sla: null }), MAINTENANT)).toBeNull();
    expect(texteRetard(ligne({ en_retard: undefined, date_limite_sla: null }), MAINTENANT)).toBeNull();
    expect(texteRetard(ligne({ en_retard: null, statut: 'resolue' }), MAINTENANT)).toBeNull();
  });

  it('en_retard false (délai tenu) : rien non plus', () => {
    expect(texteRetard(ligne({ en_retard: false, date_limite_sla: new Date(MAINTENANT + 3 * JOUR).toISOString() }), MAINTENANT)).toBeNull();
  });

  it('aucun cas ne produit une formule rassurante', () => {
    for (const en_retard of [true, false, null, undefined]) {
      for (const sla of [il(3), il(0), null, new Date(MAINTENANT + 2 * JOUR).toISOString()]) {
        const t = texteRetard(ligne({ en_retard, date_limite_sla: sla }), MAINTENANT);
        expect(t ?? '').not.toMatch(/à l[’']heure|dans les temps|tout va bien|respecté/i);
      }
    }
  });
});

describe('texte d’avancement : vrai ou absent', () => {
  it('actions : aucune / à faire sur total / rien si l’API ne dit rien', () => {
    expect(texteActions({})).toBeNull();
    expect(texteActions({ nb_actions: 0, nb_actions_a_faire: 0 })).toBe('Aucune action définie');
    expect(texteActions({ nb_actions: 3, nb_actions_a_faire: 1 })).toBe('1 à faire sur 3');
    expect(texteActions({ nb_actions: 2, nb_actions_a_faire: 0 })).toBe('Aucune à faire sur 2');
  });

  it('avis : aucun / n avis / rien si absent', () => {
    expect(texteAvis({})).toBeNull();
    expect(texteAvis({ nb_avis: 0 })).toBe('Aucun avis');
    expect(texteAvis({ nb_avis: 4 })).toBe('4 avis');
  });
});

describe('clavier dans la liste', () => {
  it('flèches, Début, Fin ; pas de rebouclage ; autre touche = rien', () => {
    expect(ligneSuivante('ArrowDown', 0, 3)).toBe(1);
    expect(ligneSuivante('ArrowDown', 2, 3)).toBe(2);
    expect(ligneSuivante('ArrowUp', 1, 3)).toBe(0);
    expect(ligneSuivante('ArrowUp', 0, 3)).toBe(0);
    expect(ligneSuivante('Home', 2, 3)).toBe(0);
    expect(ligneSuivante('End', 0, 3)).toBe(2);
    expect(ligneSuivante('a', 0, 3)).toBeNull();
    expect(ligneSuivante('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('annonce vocale de la liste', () => {
  it('vraie : total serveur, lignes chargées, filtres', () => {
    expect(annonceListe(50, 120, false)).toBe('50 chargés sur 120 problèmes.');
    expect(annonceListe(3, 3, true)).toBe('3 problèmes pour ces filtres.');
    expect(annonceListe(1, 1, false)).toBe('1 problème.');
    expect(annonceListe(0, 0, true)).toBe('Aucun problème pour ces filtres.');
    expect(annonceListe(0, 0, false)).toBe('Aucun problème suivi.');
  });
});
