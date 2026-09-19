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

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export default function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
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
        blocks.push(
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
      blocks.push(
        <Tag key={key++} className="yam-list">
          {items.map((it, ii) => <li key={ii}>{renderInline(it)}</li>)}
        </Tag>,
      );
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push(<p key={key++} className="yam-heading">{renderInline(heading[1])}</p>);
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
      !HEADING.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
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

  return <>{blocks}</>;
}
