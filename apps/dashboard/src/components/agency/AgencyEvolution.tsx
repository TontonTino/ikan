import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TendanceSatisfaction } from '../../types';
import Chart, { ChartTooltip, DATAVIZ, chartAxisProps, chartGridProps } from '../ui/Chart';
import { FAIBLE_VOLUME_POINT } from '../../pages/cx/siege/siegeData';
import { interpretationEvolution, resumeAccessibleEvolution } from './agenceVue';
import YamNote from '../agent/YamNote';
import type { ElargirPeriode } from '../ui/GraphiqueVide';
import { formaterDateAxe, formaterPourcentage } from '../../utils/formatNombre';

/**
 * Date d'un relevé en toutes lettres. L'API écrit un jour « AAAA-MM-JJ », ou pour une semaine la date de son lundi déjà en clair
 * (« 4 août ») : celle-ci se lit « Semaine du 4 août », pour ne pas la confondre avec un jour.
 */
export const dateReleve = (date: string): string => (/^\d{4}-\d{2}-\d{2}/.test(date) ? formaterDateAxe(date, true) : `Semaine du ${date}`);

/** Point plein si le volume est suffisant, creux sinon : l'information ne repose pas sur la couleur seule. */
function Point(props: { cx?: number; cy?: number; payload?: TendanceSatisfaction }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const faible = payload.nombre_feedbacks < FAIBLE_VOLUME_POINT;
  return <circle cx={cx} cy={cy} r={4} fill={faible ? 'var(--color-surface)' : DATAVIZ.positive} stroke={DATAVIZ.positive} strokeWidth={2} />;
}

export function TableauEvolution({ points }: { points: TendanceSatisfaction[] }) {
  return (
    <div className="ui-table-wrap" style={{ overflowX: 'auto' }}>
      <table className="ui-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <caption className="ui-sr-only">Satisfaction par relevé</caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', padding: 'var(--space-2)' }}>Date</th>
            <th scope="col" style={{ textAlign: 'right', padding: 'var(--space-2)' }}>Satisfaction</th>
            <th scope="col" style={{ textAlign: 'right', padding: 'var(--space-2)' }}>Avis</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              <th scope="row" style={{ textAlign: 'left', padding: 'var(--space-2)', fontWeight: 'var(--weight-semibold)' }}>{dateReleve(p.date)}</th>
              <td style={{ textAlign: 'right', padding: 'var(--space-2)' }}>{formaterPourcentage(p.taux)}</td>
              <td style={{ textAlign: 'right', padding: 'var(--space-2)' }}>
                {p.nombre_feedbacks}
                {p.nombre_feedbacks < FAIBLE_VOLUME_POINT ? ' (faible volume)' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AgencyEvolution({ points, periode, elargir }: { points: TendanceSatisfaction[]; periode: string; elargir?: ElargirPeriode }) {
  return (
    <>
    <Chart
      title="Évolution de la satisfaction"
      subtitle={
        points.length
          ? `${periode} · part des avis notés 4 ou 5 sur 5. ${interpretationEvolution(points)} Pas de comparaison avec la période précédente. Point creux : moins de ${FAIBLE_VOLUME_POINT} avis, à interpréter avec prudence.`
          : undefined
      }
      height={240}
      isEmpty={points.length === 0}
      emptyTitle={`Aucun relevé de satisfaction sur ${periode}.`}
      emptyAction={elargir}
      table={<TableauEvolution points={points} />}
    >
      {() => (
        <div role="img" aria-label={`Courbe de la satisfaction. ${resumeAccessibleEvolution(points)}`} style={{ width: '100%', height: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gradAgenceEvolution" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={DATAVIZ.positive} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={DATAVIZ.positive} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="date" tickFormatter={(v) => formaterDateAxe(v)} {...chartAxisProps} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => formaterPourcentage(v, 0)} width={48} {...chartAxisProps} />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={(l) => dateReleve(String(l))}
                    formatter={(v) => formaterPourcentage(Number(v))}
                  />
                }
              />
              <Area type="linear" dataKey="taux" name="Satisfaction" stroke={DATAVIZ.positive} strokeWidth={2.5} fill="url(#gradAgenceEvolution)" dot={<Point />} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Chart>
    <YamNote pointsFaibleVolume={points.filter((p) => p.nombre_feedbacks < FAIBLE_VOLUME_POINT).length} />
    </>
  );
}
