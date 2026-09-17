import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SearchIcon, MapPinIcon, CheckIcon, TargetIcon, AlertTriangleIcon } from '../common/Icons';

export interface LocationData {
  latitude: number | null;
  longitude: number | null;
  adresse: string;
  ville: string;
  placeName?: string;
}

interface AgencyLocationPickerProps {
  agencyName: string;
  value: LocationData;
  onChange: (data: LocationData) => void;
}

interface SearchResultItem {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    building?: string;
    country?: string;
  };
}

// Custom modern SVG Pin Icon
const createCustomPinIcon = () => {
  return L.divIcon({
    className: 'custom-agency-marker',
    html: `
      <div style="position: relative; width: 38px; height: 46px; display: flex; align-items: center; justify-content: center;">
        <div style="
          position: absolute;
          width: 36px;
          height: 36px;
          background: #02302D;
          border: 3px solid #75B72A;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 6px 18px rgba(2, 48, 45, 0.45);
          top: 0;
          left: 1px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            width: 12px;
            height: 12px;
            background: #BCCF00;
            border-radius: 50%;
            transform: rotate(45deg);
          "></div>
        </div>
        <div style="
          position: absolute;
          bottom: 1px;
          width: 14px;
          height: 5px;
          background: rgba(2, 48, 45, 0.4);
          border-radius: 50%;
          filter: blur(1.5px);
        "></div>
      </div>
    `,
    iconSize: [38, 46],
    iconAnchor: [19, 46],
    popupAnchor: [0, -46],
  });
};

// Map click event controller
function MapEventsHandler({
  onSelectCoordinates,
}: {
  onSelectCoordinates: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onSelectCoordinates(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Map center & zoom animation controller
function MapViewController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    map.flyTo(center, zoom, { duration: 0.8 });
  }, [center, zoom, map]);

  return null;
}

export const AgencyLocationPicker: React.FC<AgencyLocationPickerProps> = ({
  agencyName,
  value,
  onChange,
}) => {
  // Coordonnées par défaut : Centre de Tunis
  const defaultCenter: [number, number] = [36.8065, 10.1815];

  const initialHasCoords = value.latitude !== null && value.longitude !== null;
  const currentCoords: [number, number] | null = initialHasCoords
    ? [value.latitude!, value.longitude!]
    : null;

  const [mapCenter, setMapCenter] = useState<[number, number]>(
    currentCoords || defaultCenter
  );
  const [mapZoom, setMapZoom] = useState<number>(currentCoords ? 15 : 9);

  // Recherche d'adresse
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Géolocalisation
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Reverse Geocoding
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);

  const markerRef = useRef<L.Marker | null>(null);
  const customPin = useMemo(() => createCustomPinIcon(), []);

  // Synchronisation si la valeur change extérieurement
  useEffect(() => {
    if (value.latitude !== null && value.longitude !== null) {
      setMapCenter([value.latitude, value.longitude]);
      setMapZoom(15);
    }
  }, [value.latitude, value.longitude]);

  // Reverse geocoding via Nominatim
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      setIsReverseGeocoding(true);
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          {
            headers: {
              'Accept-Language': 'fr, ar, en',
            },
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          const addr = data.address || {};
          const city =
            addr.city ||
            addr.town ||
            addr.village ||
            addr.municipality ||
            addr.county ||
            addr.state ||
            value.ville ||
            '';
          const road =
            addr.road ||
            addr.suburb ||
            addr.neighbourhood ||
            addr.building ||
            value.adresse ||
            '';

          const placeName = data.name || (road && city ? `${road}, ${city}` : city || '');

          onChange({
            latitude: Number(lat.toFixed(6)),
            longitude: Number(lng.toFixed(6)),
            adresse: road || value.adresse,
            ville: city || value.ville,
            placeName: placeName,
          });
        } else {
          onChange({
            latitude: Number(lat.toFixed(6)),
            longitude: Number(lng.toFixed(6)),
            adresse: value.adresse,
            ville: value.ville,
          });
        }
      } catch {
        onChange({
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lng.toFixed(6)),
          adresse: value.adresse,
          ville: value.ville,
        });
      } finally {
        setIsReverseGeocoding(false);
      }
    },
    [onChange, value.adresse, value.ville]
  );

  // Exécution de la recherche d'adresse / lieu
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setIsSearching(true);
    setSearchError(null);
    setShowDropdown(false);

    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&addressdetails=1&limit=6&countrycodes=tn,fr,dz,ma,sn,ci`,
        {
          headers: {
            'Accept-Language': 'fr, ar, en',
          },
        }
      );

      if (resp.ok) {
        const data: SearchResultItem[] = await resp.json();
        if (data.length === 0) {
          // Si rien trouvé avec filtre pays, chercher globalement
          const fallbackResp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
              query
            )}&addressdetails=1&limit=6`,
            {
              headers: { 'Accept-Language': 'fr, ar, en' },
            }
          );
          if (fallbackResp.ok) {
            const fallbackData = await fallbackResp.json();
            if (fallbackData.length > 0) {
              setSearchResults(fallbackData);
              setShowDropdown(true);
              return;
            }
          }
          setSearchError('Aucun lieu ou adresse trouvé pour cette recherche.');
          setSearchResults([]);
        } else {
          setSearchResults(data);
          setShowDropdown(true);
        }
      } else {
        setSearchError('Erreur de connexion lors de la recherche.');
      }
    } catch {
      setSearchError('Impossible de joindre le service de localisation.');
    } finally {
      setIsSearching(false);
    }
  };

  // Sélection d'un résultat dans la liste déroulante
  const handleSelectSearchResult = (item: SearchResultItem) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    const newCoords: [number, number] = [lat, lng];

    setMapCenter(newCoords);
    setMapZoom(16);
    setShowDropdown(false);
    setSearchError(null);

    const addr = item.address || {};
    const city =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.county ||
      addr.state ||
      '';
    const road = addr.road || addr.suburb || addr.neighbourhood || addr.building || '';
    const placeName = item.name || item.display_name.split(',')[0].trim();

    onChange({
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      adresse: road || item.display_name.split(',').slice(0, 2).join(',').trim(),
      ville: city || (item.display_name.split(',')[1] ? item.display_name.split(',')[1].trim() : ''),
      placeName: placeName,
    });
  };

  // Géolocalisation : Utiliser ma position actuelle
  const handleUseCurrentPosition = () => {
    if (!navigator.geolocation) {
      setGeoError("La géolocalisation n'est pas supportée par votre navigateur.");
      return;
    }

    setIsLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const newCoords: [number, number] = [lat, lng];

        setMapCenter(newCoords);
        setMapZoom(16);
        setIsLocating(false);

        reverseGeocode(lat, lng);
      },
      (error) => {
        setIsLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGeoError('Autorisation de géolocalisation refusée. Veuillez autoriser votre navigateur ou rechercher manuellement.');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setGeoError('Position actuelle indisponible. Veuillez utiliser la recherche par adresse.');
        } else if (error.code === error.TIMEOUT) {
          setGeoError('Délai de géolocalisation dépassé.');
        } else {
          setGeoError('Impossible de récupérer votre position actuelle.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

  // Déplacement direct par clic sur la carte
  const handleMapClick = (lat: number, lng: number) => {
    const newCoords: [number, number] = [lat, lng];
    setMapCenter(newCoords);
    setSearchError(null);
    setGeoError(null);
    reverseGeocode(lat, lng);
  };

  // Déplacement via glisser-déposer (Drag & Drop) du marqueur
  const handleMarkerDragEnd = () => {
    const marker = markerRef.current;
    if (marker) {
      const latlng = marker.getLatLng();
      reverseGeocode(latlng.lat, latlng.lng);
    }
  };

  // Libellé d'affichage pour la confirmation
  const displayAgencyName = agencyName?.trim() || value.placeName || 'Agence IKAN AI';
  const displayAddress =
    value.adresse && value.ville
      ? `${value.adresse}, ${value.ville}`
      : value.adresse || value.ville || 'Adresse sélectionnée sur la carte';

  const isPositionValid = value.latitude !== null && value.longitude !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* ── Label Section ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label
          style={{
            fontWeight: 700,
            fontSize: '0.86rem',
            color: '#1E293B',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <MapPinIcon size={16} color="#3C7730" />
          <span>Localisation</span>
        </label>
        {isPositionValid && (
          <span
            style={{
              fontSize: '0.74rem',
              color: '#3C7730',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <CheckIcon size={13} />
            Position active
          </span>
        )}
      </div>

      {/* ── 1. Champ de Recherche d'Adresse ── */}
      <div style={{ position: 'relative' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94A3B8',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <SearchIcon size={16} />
            </div>
            <input
              type="text"
              className="saas-input"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value.trim()) {
                  setShowDropdown(false);
                  setSearchError(null);
                }
              }}
              placeholder="Rechercher une adresse, un lieu ou une agence..."
              style={{
                paddingLeft: '36px',
                paddingRight: '12px',
                height: '40px',
                fontSize: '0.86rem',
                borderRadius: '12px',
                backgroundColor: '#FFFFFF',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="btn-primary"
            style={{
              height: '40px',
              padding: '0 16px',
              fontSize: '0.84rem',
              whiteSpace: 'nowrap',
              borderRadius: '12px',
              backgroundColor: '#02302D',
              color: '#FFFFFF',
              border: 'none',
              cursor: isSearching || !searchQuery.trim() ? 'not-allowed' : 'pointer',
              opacity: isSearching || !searchQuery.trim() ? 0.65 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isSearching ? 'Recherche...' : 'Rechercher'}
          </button>
        </form>

        {/* Dropdown des Résultats de Recherche */}
        {showDropdown && searchResults.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              backgroundColor: '#FFFFFF',
              borderRadius: '14px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 12px 28px rgba(2, 48, 45, 0.16)',
              zIndex: 1000,
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            {searchResults.map((item) => (
              <div
                key={item.place_id}
                onClick={() => handleSelectSearchResult(item)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid #F1F5F2',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  fontSize: '0.84rem',
                  color: '#1E293B',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFB')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <div style={{ color: '#3C7730', marginTop: '2px', flexShrink: 0 }}>
                  <MapPinIcon size={16} />
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontWeight: 700, color: '#02302D' }}>
                    {item.name || item.display_name.split(',')[0]}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: '#64748B',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.display_name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {searchError && (
          <div
            style={{
              marginTop: '6px',
              fontSize: '0.78rem',
              color: '#DC2626',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangleIcon size={14} color="#DC2626" />
            <span>{searchError}</span>
          </div>
        )}
      </div>

      {/* ── 2. Bouton Position Actuelle ── */}
      <div>
        <button
          type="button"
          onClick={handleUseCurrentPosition}
          disabled={isLocating}
          style={{
            width: '100%',
            height: '38px',
            padding: '0 14px',
            backgroundColor: '#F8FAFB',
            color: '#02302D',
            border: '1.5px solid #E2E8F0',
            borderRadius: '12px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: isLocating ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.15s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#EAF5EC';
            e.currentTarget.style.borderColor = '#3C7730';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#F8FAFB';
            e.currentTarget.style.borderColor = '#E2E8F0';
          }}
        >
          <TargetIcon size={16} color="#3C7730" />
          <span>{isLocating ? 'Localisation en cours...' : 'Utiliser ma position actuelle'}</span>
        </button>

        {geoError && (
          <div
            style={{
              marginTop: '6px',
              fontSize: '0.78rem',
              color: '#EA580C',
              backgroundColor: '#FFF7ED',
              padding: '8px 12px',
              borderRadius: '10px',
              border: '1px solid #FFEDD5',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangleIcon size={15} color="#EA580C" />
            <span>{geoError}</span>
          </div>
        )}
      </div>

      {/* ── 3. Carte Interactive ── */}
      <div
        style={{
          position: 'relative',
          height: '240px',
          width: '100%',
          borderRadius: '16px',
          overflow: 'hidden',
          border: '1.5px solid #E8ECE6',
          boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapViewController center={mapCenter} zoom={mapZoom} />
          <MapEventsHandler onSelectCoordinates={handleMapClick} />
          {currentCoords && (
            <Marker
              position={currentCoords}
              icon={customPin}
              draggable={true}
              eventHandlers={{
                dragend: handleMarkerDragEnd,
              }}
              ref={markerRef}
            />
          )}
        </MapContainer>

        {/* Floating Instruction Banner */}
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 400,
            backgroundColor: 'rgba(2, 48, 45, 0.88)',
            color: '#FFFFFF',
            backdropFilter: 'blur(4px)',
            padding: '4px 14px',
            borderRadius: '9999px',
            fontSize: '0.74rem',
            fontWeight: 600,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <MapPinIcon size={13} color="#BCCF00" />
          <span>
            {isReverseGeocoding
              ? 'Récupération de l’adresse...'
              : 'Cliquez sur la carte ou déplacez le repère pour ajuster'}
          </span>
        </div>
      </div>

      {/* ── 4. Bloc de Confirmation de Position ── */}
      {isPositionValid && (
        <div
          style={{
            background: 'linear-gradient(135deg, #F4FAF3 0%, #EBF5E9 100%)',
            border: '1.5px solid #D5E7D3',
            borderRadius: '16px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(60, 119, 48, 0.06)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid #D5E7D3',
              paddingBottom: '8px',
            }}
          >
            <div
              style={{
                fontSize: '0.78rem',
                fontWeight: 800,
                color: '#3C7730',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <MapPinIcon size={14} color="#3C7730" />
              <span>Position de l'agence</span>
            </div>
            <span
              style={{
                backgroundColor: '#3C7730',
                color: '#FFFFFF',
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '2px 10px',
                borderRadius: '9999px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <CheckIcon size={12} strokeWidth={3} />
              Position confirmée sur la carte
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '2px' }}>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 800,
                color: '#02302D',
              }}
            >
              {displayAgencyName}
            </div>
            <div
              style={{
                fontSize: '0.84rem',
                color: '#4B5563',
                fontWeight: 500,
                lineHeight: 1.35,
              }}
            >
              {displayAddress}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgencyLocationPicker;
