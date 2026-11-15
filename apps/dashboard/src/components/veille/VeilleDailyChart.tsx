import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { VeilleSyntheseJour } from '../../types';
import { formaterDateAxe } from '../../utils/formatNombre';
import { jourComplet, jourRelatifOuAbsolu } from '../../utils/dateJour';

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

/** Étiquette de l'infobulle : le jour selon la convention du dashboard (relative jusqu'à 30 jours, puis « 12 oct. 2026 »), date complète au survol. Jamais l'ISO brute. */
export function EtiquetteJour({ jour }: { jour: string }) {
  return <time dateTime={jour} title={jourComplet(jour)}>{jourRelatifOuAbsolu(jour)}</time>;
}

/** Infobulle : le jour (convention du dashboard) puis le détail chiffré, ton par ton, avec son libellé (jamais la couleur seule). */
function InfobulleJour({ active, payload, label }: any) {
  const jour = payload?.[0]?.payload as VeilleSyntheseJour | undefined;
  if (!active || !jour) return null;
  const total = jour.positif + jour.neutre + jour.negatif;
  return (
    <div className="veille-infobulle" role="status">
      <strong><EtiquetteJour jour={String(label)} /> · {total} mention{total > 1 ? 's' : ''}</strong>
      {(['positif', 'neutre', 'negatif'] as const).map((cle) => (
        <span key={cle}>
          <i className={`veille-ton__pastille veille-ton__pastille--${cle}`} aria-hidden="true" />
          {cle === 'positif' ? 'Positif' : cle === 'neutre' ? 'Neutre' : 'Négatif'} : {jour[cle]}
        </span>
      ))}
    </div>
  );
}

export default function VeilleDailyChart({ data }: { data: VeilleSyntheseJour[] }) {
  if (data.length === 0) {
    return <p className="veille-vide-court">Aucune mention datée sur la période sélectionnée.</p>;
  }

  const total = data.reduce((acc, j) => acc + j.positif + j.neutre + j.negatif, 0);
  const description = `Évolution journalière du ton des mentions, du ${jourComplet(data[0].date)} au ${jourComplet(data[data.length - 1].date)}, ${total} mentions au total : ${data
    .map((j) => `${jourComplet(j.date)} : ${j.positif} positif, ${j.neutre} neutre, ${j.negatif} négatif`)
    .join(' ; ')}.`;

  return (
    <div>
      <ul className="veille-ton__legende veille-ton__legende--ligne" aria-hidden="true">
        <li><span className="veille-ton__pastille veille-ton__pastille--positif" />Positif</li>
        <li><span className="veille-ton__pastille veille-ton__pastille--neutre" />Neutre</li>
        <li><span className="veille-ton__pastille veille-ton__pastille--negatif" />Négatif</li>
      </ul>
      <div role="img" aria-label={description} style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--dataviz-grid)" />
            <XAxis dataKey="date" tickFormatter={(v) => formaterDateAxe(v)} tick={{ fontSize: 12, fill: 'var(--dataviz-axis)' }} tickLine={false} axisLine={{ stroke: 'var(--color-trait)' }} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--dataviz-axis)' }} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<InfobulleJour />} cursor={{ fill: 'var(--color-bg)' }} />
            <Bar dataKey="positif" name="Positif" stackId="sentiment" fill="var(--dataviz-positive)" maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="neutre" name="Neutre" stackId="sentiment" fill="var(--color-border)" maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="negatif" name="Négatif" stackId="sentiment" fill="var(--dataviz-critical)" maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table style={srOnlyStyle}>
        <caption>Détail journalier du ton des mentions</caption>
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
              <th scope="row">{jourComplet(j.date)}</th>
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
