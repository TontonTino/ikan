import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { VeilleThemeBucket } from '../../types';
import { themeLabel } from '../../utils/themeLabels';

const COLORS = ['var(--color-primary)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-error)', 'var(--color-info)', 'var(--color-text-muted)'];

export default function VeilleThemeChart({ data }: { data: VeilleThemeBucket[] }) {
  if (!data.length) return <p style={{ margin: 0, padding: 24, color: 'var(--color-text-muted)' }}>Aucune mention sur la période.</p>;
  const labels = data.map((item) => ({ ...item, nom: themeLabel(item.theme_principal) }));
  const nonClasse = data.find((item) => item.theme_principal === null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', alignItems: 'center', gap: 16 }}>
      <div role="img" aria-label={`Répartition des ${data.reduce((sum, item) => sum + item.count, 0)} mentions par thème`} style={{ width: '100%', height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart><Pie data={labels} dataKey="count" nameKey="nom" cx="50%" cy="50%" outerRadius={90} label>
            {labels.map((item, index) => <Cell key={item.nom} fill={COLORS[index % COLORS.length]} />)}
          </Pie><Tooltip formatter={(value: number, name: string) => [`${value} mention${value > 1 ? 's' : ''}`, name]} /></PieChart>
        </ResponsiveContainer>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {labels.filter((item) => item.theme_principal !== null).map((item, index) => (
          <li key={item.nom} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: 'var(--color-text-body)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[index % COLORS.length] }} />{item.nom}</span>
            <strong>{item.count} · {item.pourcentage}%</strong>
          </li>
        ))}
        {nonClasse && <li style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}><span>Non classé</span><strong>{nonClasse.count} · {nonClasse.pourcentage}%</strong></li>}
      </ul>
    </div>
  );
}
