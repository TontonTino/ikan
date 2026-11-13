import { describe, expect, it } from 'vitest';
import sourceAgence from '../components/agency/AgencyEvolution.tsx?raw';
import sourceVeille from '../components/veille/VeilleDailyChart.tsx?raw';
import { construireSynthese } from '../components/agent/construireSynthese';
import { satisfactionTexte } from '../pages/cx/siege/siegeData';
import {
  ESPACE_INSECABLE, MOIS_COURTS, cleSemaineIso, formaterDateAxe, formaterNombre, formaterPourcentage, formaterValeurApi, libelleSemaine,
  lundiSemaineIso,
} from './formatNombre';

const NB = ' ';

describe('formaterPourcentage', () => {
  it.each([
    [0, `0${NB}%`],
    [100, `100${NB}%`],
    [61.1, `61,1${NB}%`],
    [55.55, `55,6${NB}%`],
    [55.5, `55,5${NB}%`],
    [33.33333, `33,3${NB}%`],
    [-45.5, `-45,5${NB}%`],
    [1234.5, `1${' '}234,5${NB}%`],
  ])('%s -> %s', (valeur, attendu) => {
    expect(formaterPourcentage(valeur)).toBe(attendu);
  });

  it('virgule décimale et espace insécable, jamais un point ni une espace ordinaire', () => {
    const texte = formaterPourcentage(61.1);
    expect(texte).toContain(',');
    expect(texte).not.toContain('.');
    expect(texte).toContain(ESPACE_INSECABLE);
    expect(texte).not.toContain(' %');
  });

  it('valeur absente ou non finie : « — », jamais « NaN » ni « undefined » ni un zéro inventé', () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formaterPourcentage(v)).toBe('—');
    }
    expect(formaterPourcentage('12' as unknown as number)).toBe('—');
  });

  it('nombre de décimales réglable', () => {
    expect(formaterPourcentage(61.15, 0)).toBe(`61${NB}%`);
    expect(formaterPourcentage(33.333, 3)).toBe(`33,333${NB}%`);
  });
});

describe('formaterNombre', () => {
  it('séparateurs français, aucune décimale inutile', () => {
    expect(formaterNombre(61.1)).toBe('61,1');
    expect(formaterNombre(50)).toBe('50');
    expect(formaterNombre(null)).toBe('—');
  });
});

describe('formaterDateAxe (lot 6 : des dates en clair)', () => {
  it('« 2026-08-04 » devient « 4 août » : jour sans zéro initial, mois abrégé', () => {
    expect(formaterDateAxe('2026-08-04')).toBe('4 août');
    expect(formaterDateAxe('2026-08-11')).toBe('11 août');
    expect(formaterDateAxe('2026-12-31T08:00:00Z')).toBe('31 déc.');
    expect(formaterDateAxe('2026-01-05 10:00')).toBe('5 janv.');
    expect(formaterDateAxe('2026-09-01')).toBe('1 sept.');
  });

  it('infobulle : avec l’année, « 4 août 2026 » (même formateur, pas de second format)', () => {
    expect(formaterDateAxe('2026-08-04', true)).toBe('4 août 2026');
    expect(formaterDateAxe('2026-12-31T08:00:00Z', true)).toBe('31 déc. 2026');
  });

  it('toute autre valeur est rendue telle quelle (libellés déjà lisibles)', () => {
    expect(formaterDateAxe('4 août')).toBe('4 août');
    expect(formaterDateAxe('4 août', true)).toBe('4 août');
    expect(formaterDateAxe('')).toBe('');
    expect(formaterDateAxe(42)).toBe('42');
  });

  it('mêmes mois abrégés qu’Intl fr-FR', () => {
    MOIS_COURTS.forEach((mois, i) => {
      const intl = new Date(Date.UTC(2026, i, 15)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
      expect(mois).toBe(intl);
    });
  });
});

describe('semaines ISO', () => {
  it('cleSemaineIso et lundiSemaineIso sont réciproques, y compris au passage d’année', () => {
    expect(cleSemaineIso('2026-08-04')).toBe('2026-W32');
    expect(cleSemaineIso('2026-08-09')).toBe('2026-W32');
    expect(cleSemaineIso('2025-12-29')).toBe('2026-W01');
    expect(cleSemaineIso('2027-01-03')).toBe('2026-W53');
    expect(cleSemaineIso('2026-01-01')).toBe('2026-W01');
    expect(lundiSemaineIso('2026-W32')?.toISOString().slice(0, 10)).toBe('2026-08-03');
    expect(lundiSemaineIso('2026-W01')?.toISOString().slice(0, 10)).toBe('2025-12-29');
    expect(lundiSemaineIso('pas une semaine')).toBeNull();
  });

  it('libelleSemaine : « Semaine du 3 au 9 août 2026 »', () => {
    expect(libelleSemaine(new Date(Date.UTC(2026, 7, 3)))).toBe('Semaine du 3 au 9 août 2026');
    expect(libelleSemaine(new Date(Date.UTC(2026, 7, 31)))).toBe('Semaine du 31 août au 6 sept. 2026');
    expect(libelleSemaine(new Date(Date.UTC(2025, 11, 29)))).toBe('Semaine du 29 déc. 2025 au 4 janv. 2026');
  });
});

describe('axes de graphique', () => {
  it('Agency Manager et Veille : dates d’axe en clair', () => {
    expect(sourceAgence).toContain('<XAxis dataKey="date" tickFormatter={(v) => formaterDateAxe(v)}');
    expect(sourceVeille).toContain('<XAxis dataKey="date" tickFormatter={(v) => formaterDateAxe(v)}');
  });

  it('infobulle du graphique de l’Agency Manager : date du relevé en toutes lettres (plus la date brute)', () => {
    expect(sourceAgence).toContain('labelFormatter={(l) => dateReleve(String(l))}');
    expect(sourceAgence).not.toContain('labelFormatter={(l) => String(l)}');
  });
});

describe('formaterValeurApi (valeurs d’indicateur renvoyées par l’API)', () => {
  it('un pourcentage « 61.1% » devient « 61,1 % » (espace insécable)', () => {
    expect(formaterValeurApi('61.1%', 61.1)).toBe(`61,1${NB}%`);
    expect(formaterValeurApi('0.0%', 0)).toBe(`0${NB}%`);
    expect(formaterValeurApi('100.0 %', 100)).toBe(`100${NB}%`);
  });

  it('toute autre valeur est rendue telle quelle (nombre, texte, durée, absence)', () => {
    expect(formaterValeurApi(18, 18)).toBe(18);
    expect(formaterValeurApi('48h', 48)).toBe('48h');
    expect(formaterValeurApi("Pas d'avis", null)).toBe("Pas d'avis");
    expect(formaterValeurApi(null, null)).toBeNull();
    expect(formaterValeurApi(undefined, undefined)).toBeUndefined();
  });

  it('pourcentage sans valeur numérique exploitable : texte de l’API inchangé (jamais « NaN » ni « — » inventé)', () => {
    expect(formaterValeurApi('61.1%', null)).toBe('61.1%');
    expect(formaterValeurApi('61.1%', Number.NaN)).toBe('61.1%');
  });
});

describe('cohérence avec la bande de synthèse de YAM', () => {
  it('le même rendu « 55,6 % » partout', () => {
    expect(satisfactionTexte(55.6, 45)).toBe(`55,6${NB}%`);
    const synthese = construireSynthese({ jours: 30, nbAvis: 45, satisfaction: 55.6, agencesSousSeuil: [], agencesCritiques: [] });
    expect(synthese.message).toContain(`55,6${NB}% de satisfaction`);
    expect(synthese.message).toContain(satisfactionTexte(55.6, 45));
  });

  it('« Pas d’avis » reste « Pas d’avis » (jamais 0 %)', () => {
    expect(satisfactionTexte(null, 0)).toBe("Pas d'avis");
    expect(satisfactionTexte(0, 0)).toBe("Pas d'avis");
  });
});
