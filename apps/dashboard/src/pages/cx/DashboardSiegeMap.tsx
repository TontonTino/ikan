import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { MapPin } from '@phosphor-icons/react';
import { pinIcon } from '../../components/map/pinIcon';
import type { KPIAgence } from '../../types';
import 'leaflet/dist/leaflet.css';

type AgenceAvecCoordonnees = KPIAgence & { latitude: number; longitude: number };

type Props = {
  agences: AgenceAvecCoordonnees[];
  onVoirAgence: (agenceId: string) => void;
};

const agenceColor = (taux: number) =>
  taux >= 80 ? '#3C7730' : taux >= 60 ? '#F59E0B' : '#DC2626';
const agenceStatus = (taux: number) =>
  taux >= 80 ? 'Satisfaisant' : taux >= 60 ? 'À surveiller' : 'Critique';

export default function DashboardSiegeMap({ agences, onVoirAgence }: Props) {
  const centerLat = agences.reduce((sum, agence) => sum + agence.latitude, 0) / agences.length;
  const centerLng = agences.reduce((sum, agence) => sum + agence.longitude, 0) / agences.length;

  return (
    <>
      <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid #E8ECE6' }}>
        <MapContainer center={[centerLat, centerLng]} zoom={7} style={{ height: '420px', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {agences.map((agence) => (
            <Marker
              key={agence.agence_id}
              position={[agence.latitude, agence.longitude]}
              icon={pinIcon(agenceColor(agence.taux_satisfaction))}
              title={agence.agence_nom}
            >
              <Popup>
                <div style={{ minWidth: '160px' }}>
                  <strong style={{ color: '#02302D' }}>{agence.agence_nom}</strong>
                  <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{agence.ville}</div>
                  <div style={{ marginTop: '6px', fontSize: '0.80rem' }}>
                    Satisfaction : <strong style={{ color: agenceColor(agence.taux_satisfaction) }}>{agence.taux_satisfaction}%</strong>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: agenceColor(agence.taux_satisfaction), fontWeight: 700 }}>Statut : {agenceStatus(agence.taux_satisfaction)}</div>
                  <div style={{ fontSize: '0.78rem' }}>Avis : {agence.nombre_feedbacks}</div>
                  <button type="button" onClick={() => onVoirAgence(agence.agence_id)} className="btn-primary" style={{ marginTop: '8px', padding: '5px 10px', fontSize: '0.76rem', borderRadius: '8px' }}>
                    Voir l'agence
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
        {[
          { color: '#3C7730', label: '≥ 80% — Excellent' },
          { color: '#F59E0B', label: '60-80% — À surveiller' },
          { color: '#DC2626', label: '< 60% — Critique' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.80rem', fontWeight: 600 }}>
            <MapPin size={18} weight="fill" color={color} aria-hidden="true" />
            {label}
          </div>
        ))}
      </div>
    </>
  );
}
