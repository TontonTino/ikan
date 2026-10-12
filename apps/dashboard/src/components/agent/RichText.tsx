import React from 'react';

/**
 * Rendu léger des réponses de YAM (gras, listes, tableaux, titres) sans
 * dangerouslySetInnerHTML : uniquement des nœuds React, donc aucun HTML/script
 * renvoyé par le LLM ne peut être injecté dans la page.
 */

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const TABLE_SEPARATOR = /^[\s|:-]+$/;

/**
 * Rubriques que YAM place en tête de chaque bloc (« SITUATION », « RECOMMANDATION »…). On les rend comme de
 * vrais intitulés, en distinguant ce qui est observé de ce qui est supposé ou suggéré. Une suggestion n'est
 * jamais présentée comme une action exécutée.
 */
type SectionKind = 'fait' | 'interpretation' | 'hypothese' | 'reco' | 'donnees';
const SECTIONS: Record<string, { label: string; kind: SectionKind }> = {
  SITUATION: { label: 'Situation', kind: 'fait' },
  INTERPRETATION: { label: 'Interprétation', kind: 'interpretation' },
  'CAUSE PROBABLE': { label: 'Cause probable (hypothèse)', kind: 'hypothese' },
  RECOMMANDATION: { label: 'Recommandation (suggestion à valider, rien n’est exécuté)', kind: 'reco' },
  RECOMMANDATIONS: { label: 'Recommandations (suggestions à valider, rien n’est exécuté)', kind: 'reco' },
  DONNEES: { label: 'Données', kind: 'donnees' },
};

function sectionDe(line: string): { label: string; kind: SectionKind } | null {
  const t = line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*{1,2}|\*{1,2}$/g, '')
    .replace(/:$/, '')
    .trim();
  if (!t || t.length > 24) return null;
  const cle = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  // Uniquement si la ligne est écrite en capitales : un mot courant dans une phrase n'est pas une rubrique.
  if (t !== t.toUpperCase()) return null;
  return SECTIONS[cle] ?? null;
}

/** Retire un astérisque isolé en début/fin de ligne (italique mal fermé par le modèle). */
function sansAsterisqueIsole(line: string): string {
  // On ignore d'abord les paires **gras** : il ne doit rester qu'un seul astérisque, isolé.
  if ((line.replace(/\*\*[^*]+\*\*/g, '').match(/\*/g) ?? []).length !== 1) return line;
  return line.replace(/^(\s*)\*(?=[^\s*])/, '$1').replace(/(?<=[^\s*])\*(\s*)$/, '$1');
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export default function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(sansAsterisqueIsole);
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  // Rubrique en cours : les blocs suivants lui sont rattachés jusqu'à la rubrique suivante.
  let rubrique: { label: string; kind: SectionKind; children: React.ReactNode[] } | null = null;
  const ajouter = (node: React.ReactNode) => (rubrique ? rubrique.children.push(node) : blocks.push(node));
  const fermerRubrique = () => {
    if (!rubrique) return;
    const r = rubrique;
    rubrique = null;
    blocks.push(
      <section key={key++} className={`yam-section yam-section--${r.kind}`}>
        <p className="yam-section-title">{r.label}</p>
        {r.children}
      </section>,
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const rub = sectionDe(line);
    if (rub) {
      fermerRubrique();
      rubrique = { ...rub, children: [] };
      i += 1;
      continue;
    }

    // Tableau à tabulations (« Id⇥Agence⇥Score ») : plusieurs lignes consécutives contenant des tabulations
    if (line.includes('\t') && i + 1 < lines.length && lines[i + 1].includes('\t')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('\t')) {
        rows.push(lines[i].split('\t').map((c) => c.trim()));
        i += 1;
      }
      const [head, ...body] = rows;
      ajouter(
        <div key={key++} className="yam-table-wrap">
          <table className="yam-table">
            <thead>
              <tr>{head.map((c, ci) => <th key={ci}>{renderInline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Tableau : lignes consécutives commençant par « | »
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!TABLE_SEPARATOR.test(lines[i].trim())) rows.push(splitRow(lines[i]));
        i += 1;
      }
      if (rows.length > 0) {
        const [head, ...body] = rows;
        ajouter(
          <div key={key++} className="yam-table-wrap">
            <table className="yam-table">
              <thead>
                <tr>{head.map((c, ci) => <th key={ci}>{renderInline(c)}</th>)}</tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    // Liste à puces / numérotée : lignes consécutives du même type
    const kind = BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : null;
    if (kind) {
      const pattern = kind === 'ul' ? BULLET : NUMBERED;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push((lines[i].match(pattern) as RegExpMatchArray)[1]);
        i += 1;
      }
      const Tag = kind;
      ajouter(
        <Tag key={key++} className="yam-list">
          {items.map((it, ii) => <li key={ii}>{renderInline(it)}</li>)}
        </Tag>,
      );
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      ajouter(<p key={key++} className="yam-heading">{renderInline(heading[1])}</p>);
      i += 1;
      continue;
    }

    // Paragraphe : lignes consécutives « normales » (retours à la ligne conservés)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('|') &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !sectionDe(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    ajouter(
      <p key={key++} className="yam-paragraph">
        {para.map((p, pi) => (
          <React.Fragment key={pi}>
            {pi > 0 && <br />}
            {renderInline(p)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  fermerRubrique();
  return <>{blocks}</>;
}
