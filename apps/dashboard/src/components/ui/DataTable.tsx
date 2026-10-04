import React, { useMemo, useState } from 'react';
import EmptyState from './EmptyState';
import Skeleton from './Skeleton';
import { ChevronDownIcon } from '../common/Icons';

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Rendu de la cellule (défaut : row[key]). */
  render?: (row: T) => React.ReactNode;
  /** Valeur de tri ; si fournie, la colonne est triable. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  /** Chiffres alignés (tabular-nums). */
  numeric?: boolean;
  width?: number | string;
}

export interface DataTableProps<T> {
  /** Description du tableau pour les lecteurs d'écran (caption masqué). */
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Libellé accessible d'une ligne cliquable (ex. « Ouvrir l'agence Paris 11 »). */
  rowLabel?: (row: T) => string;
  loading?: boolean;
  /** Nombre de lignes skeleton pendant le chargement. */
  skeletonRows?: number;
  emptyTitle?: string;
  emptyMessage?: string;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
}

/**
 * Tableau de données : en-tête collant, tri accessible (aria-sort), lignes
 * activables au clavier, états chargement/vide. Défile horizontalement dans
 * son conteneur sur petit écran (jamais la page).
 * Pas de glassmorphism ni d'effet sur les tableaux (lisibilité d'abord).
 */
export default function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  loading = false,
  skeletonRows = 5,
  emptyTitle = 'Aucun élément à afficher.',
  emptyMessage,
  defaultSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // valeurs absentes toujours en fin
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base' }) * dir;
    });
  }, [rows, columns, sort]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' }));

  if (!loading && rows.length === 0) {
    return (
      <div className="ui-table-wrap">
        <EmptyState compact title={emptyTitle} message={emptyMessage} />
      </div>
    );
  }

  return (
    <div className="ui-table-wrap" aria-busy={loading || undefined}>
      <table className="ui-table">
        <caption className="ui-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  data-align={c.align}
                  style={c.width != null ? { width: c.width } : undefined}
                  aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortValue ? (
                    <button type="button" className="ui-table__sort" onClick={() => toggleSort(c.key)}>
                      {c.header}
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-flex',
                          opacity: active ? 1 : 0.35,
                          transform: active && sort!.direction === 'asc' ? 'rotate(180deg)' : undefined,
                        }}
                      >
                        <ChevronDownIcon size={12} />
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} data-align={c.align}>
                      <Skeleton variant="text" width={c.numeric ? 48 : '70%'} />
                    </td>
                  ))}
                </tr>
              ))
            : sorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={onRowClick ? 'ui-table__row--clickable' : undefined}
                  {...(onRowClick
                    ? {
                        tabIndex: 0,
                        'aria-label': rowLabel?.(row),
                        onClick: () => onRowClick(row),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        },
                      }
                    : {})}
                >
                  {columns.map((c) => (
                    <td key={c.key} data-align={c.align} data-numeric={c.numeric || undefined}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
