import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { MapPin } from '@phosphor-icons/react';
import { pinIcon } from './pinIcon';
import 'leaflet/dist/leaflet.css';
import { STATUT_SEUIL_LABEL, satisfactionTexte, type StatutSeuil } from '../../pages/cx/siege/siegeData';

export interface AgenceCarte {
  id: string;
  nom: string;
  ville?: string | null;
  latitude: number;
  longitude: number;
  satisfaction: number;
  avis: number;
  seuil: number | null;
  statut: StatutSeuil;
}

/*
 * Couleurs = statut vis-à-vis du SEUIL CONFIGURÉ de chaque agence (plus de
 * seuils fixes 80/60 % qui contredisaient les alertes). La couleur n'est jamais
 * seule : libellé du statut dans la popup, title du marqueur, légende textuelle.
 * Leaflet a besoin de couleurs littérales pour ses icônes : valeurs = tokens
 * --color-success-solid / --color-critical-solid / --color-neutral-solid.
 */
const STATUT_COULEUR: Record<StatutSeuil, string> = {
  au_dessus: '#3C7730',
  sous: '#DC2626',
  pas_assez_avis: '#64748B',
  sans_avis: '#94A3B8',
};

const LEGENDE: StatutSeuil[] = ['au_dessus', 'sous', 'pas_assez_avis', 'sans_avis'];

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
              icon={pinIcon(STATUT_COULEUR[a.statut])}
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
      <ul aria-label="Légende de la carte" style={{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'center', margin: 'var(--space-3) 0 0', padding: 0, listStyle: 'none', flexWrap: 'wrap' }}>
        {LEGENDE.map((s) => (
          <li key={s} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
            <MapPin size={18} weight="fill" color={STATUT_COULEUR[s]} aria-hidden="true" />
            {STATUT_SEUIL_LABEL[s]}
          </li>
        ))}
      </ul>
    </>
  );
}
