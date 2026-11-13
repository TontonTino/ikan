import React, { useCallback, useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { groupeIcon, pinIcon } from './pinIcon';
import { positionsIdentiques, regrouper, resumeGroupe, type Groupe, type PointEcran } from './regroupement';
import 'leaflet/dist/leaflet.css';
import { STATUT_SEUIL_LABEL, satisfactionTexte, type StatutSeuil } from '../../pages/cx/siege/siegeData';
import { LegendeCarte, ListeAgencesCarte, STATUT_COULEUR, STATUT_EXPLICATION, STATUT_SYMBOLE } from './LegendeCarte';
import { formaterPourcentage } from '../../utils/formatNombre';

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
/** Contenu de la popup d'une agence (marqueur seul ou ligne d'un groupe indissociable). */
function FicheAgence({ a, onVoirAgence }: { a: AgenceCarte; onVoirAgence: (id: string) => void }) {
  return (
    <div style={{ minWidth: 170 }}>
      <strong className="t-encre">{a.nom}</strong>
      {a.ville && <div className="t-xs t-2">{a.ville}</div>}
      <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
        Satisfaction : <strong>{satisfactionTexte(a.satisfaction, a.avis)}</strong>
        {a.seuil != null && a.avis > 0 && <> (seuil {formaterPourcentage(a.seuil)})</>}
      </div>
      <div className="t-xs t-semi">Statut : {STATUT_SEUIL_LABEL[a.statut]}</div>
      <div className="t-xs t-2">{STATUT_EXPLICATION[a.statut]}</div>
      <div className="t-xs">Avis : {a.avis}</div>
      <button type="button" onClick={() => onVoirAgence(a.id)} className="ui-btn ui-btn--primary ui-btn--sm" style={{ marginTop: 'var(--space-2)' }}>
        Voir l'agence
      </button>
    </div>
  );
}

type PointAgence = PointEcran & { agence: AgenceCarte };

/**
 * Marqueurs regroupés (lot 6) : recalculés à chaque zoom. Un groupe est une pastille avec le nombre d'agences ; un clic
 * (ou Entrée au clavier) zoome sur ses agences. Si elles partagent exactement la même position, aucun zoom ne les
 * séparerait : le clic ouvre alors la liste des agences du groupe.
 */
function MarqueursRegroupes({ agences, onVoirAgence }: { agences: AgenceCarte[]; onVoirAgence: (id: string) => void }) {
  const map = useMap();
  const calculer = useCallback((): Groupe<PointAgence>[] => {
    const zoom = map.getZoom();
    // Au zoom maximal, plus rien ne peut se séparer : chaque agence garde son marqueur.
    if (zoom >= map.getMaxZoom()) return agences.map((a) => ({ membres: [{ id: a.id, x: 0, y: 0, agence: a }], x: 0, y: 0 }));
    const points = agences.map((a) => {
      const { x, y } = map.project([a.latitude, a.longitude], zoom);
      return { id: a.id, x, y, agence: a };
    });
    return regrouper(points);
  }, [map, agences]);

  const [groupes, setGroupes] = useState<Groupe<PointAgence>[]>(calculer);
  useEffect(() => setGroupes(calculer()), [calculer]);
  useMapEvents({ zoomend: () => setGroupes(calculer()) });

  return (
    <>
      {groupes.map((g) => {
        if (g.membres.length === 1) {
          const a = g.membres[0].agence;
          return (
            <Marker key={a.id} position={[a.latitude, a.longitude]} icon={pinIcon(STATUT_COULEUR[a.statut], STATUT_SYMBOLE[a.statut])} title={`${a.nom} — ${STATUT_SEUIL_LABEL[a.statut]}`}>
              <Popup><FicheAgence a={a} onVoirAgence={onVoirAgence} /></Popup>
            </Marker>
          );
        }
        const membres = g.membres.map((m) => m.agence);
        const centre = map.unproject([g.x, g.y], map.getZoom());
        const indissociables = positionsIdentiques(membres);
        const resume = resumeGroupe(membres.map((a) => a.statut), STATUT_SEUIL_LABEL);
        const zoomer = () => map.fitBounds(L.latLngBounds(membres.map((a) => [a.latitude, a.longitude] as [number, number])), { padding: [48, 48] });
        return (
          <Marker
            key={membres.map((a) => a.id).join('|')}
            position={centre}
            icon={groupeIcon(membres.length, membres.some((a) => a.statut === 'sous'))}
            title={indissociables ? `${resume}. Ouvrir la liste.` : `${resume}. Zoomer sur ce groupe.`}
            // Leaflet rend le marqueur focalisable (role « button ») et ouvre une popup à Entrée, mais ne transforme pas Entrée en
            // clic : sans ce relais, un groupe ne se zoomerait qu'à la souris.
            eventHandlers={indissociables ? undefined : {
              click: zoomer,
              keypress: (e) => {
                const touche = (e.originalEvent as KeyboardEvent).key;
                if (touche === 'Enter' || touche === ' ') zoomer();
              },
            }}
          >
            {indissociables && (
              <Popup>
                <ul className="carte-groupe__liste">
                  {membres.map((a) => (
                    <li key={a.id}><FicheAgence a={a} onVoirAgence={onVoirAgence} /></li>
                  ))}
                </ul>
              </Popup>
            )}
          </Marker>
        );
      })}
    </>
  );
}

export default function AgencesMap({ agences, onVoirAgence }: { agences: AgenceCarte[]; onVoirAgence: (id: string) => void }) {
  // Cadrage sur toutes les agences (une seule : centrage au zoom 12).
  const bounds = agences.length > 1 ? (agences.map((a) => [a.latitude, a.longitude]) as [number, number][]) : undefined;
  const center: [number, number] = [agences[0].latitude, agences[0].longitude];

  return (
    <>
      <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-trait)' }}>
        <MapContainer {...(bounds ? { bounds, boundsOptions: { padding: [32, 32] } } : { center, zoom: 12 })} style={{ height: 420, width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <MarqueursRegroupes agences={agences} onVoirAgence={onVoirAgence} />
        </MapContainer>
      </div>
      <p className="carte-aide">Un cercle numéroté regroupe des agences proches : cliquez dessus pour zoomer.</p>
      <LegendeCarte />
      <ListeAgencesCarte agences={agences} />
    </>
  );
}
