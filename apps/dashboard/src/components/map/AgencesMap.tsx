import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { pinIcon } from './pinIcon';
import 'leaflet/dist/leaflet.css';
import { STATUT_SEUIL_LABEL, satisfactionTexte, type StatutSeuil } from '../../pages/cx/siege/siegeData';
import { LegendeCarte, ListeAgencesCarte, STATUT_COULEUR, STATUT_EXPLICATION, STATUT_SYMBOLE } from './LegendeCarte';

export interface AgenceCarte {
  id: string;
  nom: string;
  ville?: string | null;
  latitude: number;
  longitude: number;
  /** null si aucun avis sur la période. */
  satisfaction: number | null;
  avis: number;
  seuil: number | null;
  statut: StatutSeuil;
}

/*
 * Couleurs = statut vis-à-vis du SEUIL CONFIGURÉ de chaque agence (plus de seuils fixes 80/60 % qui contredisaient les alertes).
 * La couleur n'est jamais seule : symbole dans le marqueur, libellé du statut dans la popup, title du marqueur, légende textuelle
 * (LegendeCarte) et liste des agences sous la carte.
 */
export default function AgencesMap({ agences, onVoirAgence }: { agences: AgenceCarte[]; onVoirAgence: (id: string) => void }) {
  // Cadrage sur toutes les agences (une seule : centrage au zoom 12).
  const bounds = agences.length > 1 ? (agences.map((a) => [a.latitude, a.longitude]) as [number, number][]) : undefined;
  const center: [number, number] = [agences[0].latitude, agences[0].longitude];

  return (
    <>
      <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        <MapContainer {...(bounds ? { bounds, boundsOptions: { padding: [32, 32] } } : { center, zoom: 12 })} style={{ height: 420, width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {agences.map((a) => (
            <Marker
              key={a.id}
              position={[a.latitude, a.longitude]}
              icon={pinIcon(STATUT_COULEUR[a.statut], STATUT_SYMBOLE[a.statut])}
              title={`${a.nom} — ${STATUT_SEUIL_LABEL[a.statut]}`}
            >
              <Popup>
                <div style={{ minWidth: 170 }}>
                  <strong style={{ color: 'var(--color-text-main)' }}>{a.nom}</strong>
                  {a.ville && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{a.ville}</div>}
                  <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                    Satisfaction : <strong>{satisfactionTexte(a.satisfaction, a.avis)}</strong>
                    {a.seuil != null && a.avis > 0 && <> (seuil {a.seuil} %)</>}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>Statut : {STATUT_SEUIL_LABEL[a.statut]}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{STATUT_EXPLICATION[a.statut]}</div>
                  <div style={{ fontSize: 'var(--text-xs)' }}>Avis : {a.avis}</div>
                  <button type="button" onClick={() => onVoirAgence(a.id)} className="ui-btn ui-btn--primary ui-btn--sm" style={{ marginTop: 'var(--space-2)' }}>
                    Voir l'agence
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <LegendeCarte />
      <ListeAgencesCarte agences={agences} />
    </>
  );
}
