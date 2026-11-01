import React, { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import type { EvolutionPoint } from '../../types';
import { combinerSatisfactionEtVolume, libelleDatePoint } from '../../utils/satisfactionSeries';

interface Props {
  satisfaction: EvolutionPoint[];
  volume: EvolutionPoint[];
  height?: number;
}

function PointTooltip({ active, payload, label }: any) {
  const point = payload?.find((item: any) => item?.payload)?.payload;
  if (!active || !point || point.sansAvis) return null;

  return (
    <div className="stats-cx__tooltip" role="status">
      <strong>{libelleDatePoint(point.date, point.label || label)}</strong>
      <span><i className="stats-cx__dot stats-cx__dot--green" />Satisfaction : {point.satisfaction}% ({point.feedbacks} avis notés)</span>
      <span><i className="stats-cx__dot stats-cx__dot--red" />Avis négatifs ou critiques reçus : {point.recus}</span>
      <span><i className="stats-cx__dot stats-cx__dot--teal" />Pris en charge : {point.traites}</span>
    </div>
  );
}

export default function SatisfactionVolumeChart({ satisfaction, volume, height = 440 }: Props) {
  const rows = useMemo(() => combinerSatisfactionEtVolume(satisfaction, volume), [satisfaction, volume]);

  if (!satisfaction.length) {
    return <div className="stats-cx__chart-empty" style={{ height }}>Aucune donnée de satisfaction disponible pour cette période.</div>;
  }

  const syncId = 'stats-cx-satisfaction-volume';
  const sharedChartProps = {
    data: rows,
    syncId,
    accessibilityLayer: true,
    margin: { top: 8, right: 12, left: 8, bottom: 0 },
  };

  return (
    <div className="stats-cx__chart-stack" style={{ height }} aria-label="Satisfaction et avis négatifs ou critiques par période">
      <section className="stats-cx__chart-zone" aria-labelledby="stats-cx-satisfaction-zone">
        <div className="stats-cx__chart-zone-heading">
          <h4 id="stats-cx-satisfaction-zone">Satisfaction</h4>
          <span className="stats-cx__satisfaction-key"><i aria-hidden="true" />Notes 4 ou 5 · %</span>
        </div>
        <div className="stats-cx__chart-plot stats-cx__chart-plot--satisfaction">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart {...sharedChartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E6EBE8" vertical={false} />
              <XAxis dataKey="label" hide />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} stroke="#52625E" fontSize={11} tickLine={false} axisLine={false} width={48} />
              <Tooltip content={<PointTooltip />} cursor={{ stroke: '#62736E', strokeDasharray: '3 3' }} />
              <Line dataKey="satisfaction" name="Satisfaction" type="linear" stroke="#367A32" strokeWidth={3} connectNulls={false} dot={{ r: 4, fill: '#367A32', stroke: '#FFFFFF', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#245D25', stroke: '#FFFFFF', strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="stats-cx__chart-zone" aria-labelledby="stats-cx-volume-zone">
        <div className="stats-cx__chart-zone-heading">
          <h4 id="stats-cx-volume-zone">Avis négatifs ou critiques</h4>
          <div className="stats-cx__chart-legend" aria-label="Légende des volumes">
            <span><i className="stats-cx__legend-swatch stats-cx__legend-swatch--red" />Reçus</span>
            <span><i className="stats-cx__legend-swatch stats-cx__legend-swatch--teal" />Pris en charge</span>
          </div>
        </div>
        <div className="stats-cx__chart-plot stats-cx__chart-plot--volume">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart {...sharedChartProps} barCategoryGap="24%">
              <CartesianGrid strokeDasharray="3 3" stroke="#E6EBE8" vertical={false} />
              <XAxis dataKey="label" stroke="#52625E" fontSize={11} tickLine={false} minTickGap={24} axisLine={{ stroke: '#CBD5D1' }} height={30} />
              <YAxis allowDecimals={false} stroke="#52625E" fontSize={11} tickLine={false} axisLine={false} width={48} />
              <Tooltip content={<PointTooltip />} cursor={{ fill: '#EEF3F0' }} />
              <Bar dataKey="recus" name="Avis négatifs ou critiques reçus" fill="#B42318" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Bar dataKey="traites" name="Pris en charge" fill="#086B67" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <p className="stats-cx__chart-note">Les deux zones partagent les mêmes périodes. La comparaison temporelle ne prouve pas de lien de causalité.</p>
    </div>
  );
}
