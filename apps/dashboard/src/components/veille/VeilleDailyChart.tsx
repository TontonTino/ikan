import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { VeilleSyntheseJour } from '../../types';

// Visuellement masqué mais accessible aux lecteurs d'écran (même donnée que le graphique).
const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export default function VeilleDailyChart({ data }: { data: VeilleSyntheseJour[] }) {
  if (data.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>
        Aucune mention datée sur la période sélectionnée.
      </div>
    );
  }

  const total = data.reduce((acc, j) => acc + j.positif + j.neutre + j.negatif, 0);
  const description = `Évolution journalière du sentiment des mentions, du ${data[0].date} au ${data[data.length - 1].date}, ${total} mentions au total : ${data
    .map((j) => `${j.date} : ${j.positif} positif, ${j.neutre} neutre, ${j.negatif} négatif`)
    .join(' ; ')}.`;

  return (
    <div>
      <div role="img" aria-label={description} style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--color-primary-dark)', borderRadius: '10px', border: 'none', color: '#FFFFFF', fontSize: '0.78rem' }}
            />
            <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
            <Bar dataKey="positif" name="Positif" stackId="sentiment" fill="var(--color-success)" />
            <Bar dataKey="neutre" name="Neutre" stackId="sentiment" fill="var(--color-text-muted)" />
            <Bar dataKey="negatif" name="Négatif" stackId="sentiment" fill="var(--color-error)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table style={srOnlyStyle}>
        <caption>Détail journalier du sentiment des mentions</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Positif</th>
            <th scope="col">Neutre</th>
            <th scope="col">Négatif</th>
          </tr>
        </thead>
        <tbody>
          {data.map((j) => (
            <tr key={j.date}>
              <th scope="row">{j.date}</th>
              <td>{j.positif}</td>
              <td>{j.neutre}</td>
              <td>{j.negatif}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
