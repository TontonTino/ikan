import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Alerte } from '../../types';
import { AlertTriangleIcon, ChevronRightIcon } from '../common/Icons';

interface EphemeralAlertsBannerProps {
  alerts: Alerte[];
  userId?: string;
  durationMs?: number; // Par défaut 15000 ms (15 secondes)
}

function getAlertKey(a: Alerte): string {
  return `${a.agence_id}_${a.taux_actuel}_${a.seuil}`;
}

export default function EphemeralAlertsBanner({
  alerts,
  userId,
  durationMs = 15000,
}: EphemeralAlertsBannerProps) {
  const navigate = useNavigate();
  const [unseenAlerts, setUnseenAlerts] = useState<Alerte[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(Math.ceil(durationMs / 1000));
  const hasMarkedSeen = useRef(false);

  useEffect(() => {
    if (!alerts || alerts.length === 0) {
      setUnseenAlerts([]);
      setIsVisible(false);
      return;
    }

    const storageKey = `ikanai_seen_alerts_${userId || 'default'}`;
    let seenMap: Record<string, number> = {};
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        seenMap = JSON.parse(stored);
      }
    } catch {
      seenMap = {};
    }

    // Filtrer les alertes qui n'ont pas encore été vues
    const fresh = alerts.filter((a) => !seenMap[getAlertKey(a)]);

    if (fresh.length > 0) {
      setUnseenAlerts(fresh);
      setIsVisible(true);
      setIsFadingOut(false);
      setTimeLeft(Math.ceil(durationMs / 1000));
      hasMarkedSeen.current = false;
    } else {
      setUnseenAlerts([]);
      setIsVisible(false);
    }
  }, [alerts, userId, durationMs]);

  // Gestion du timer de 15 secondes
  useEffect(() => {
    if (!isVisible || unseenAlerts.length === 0) return;

    // Décompte visuel chaque seconde
    const intervalTimer = setInterval(() => {
      setTimeLeft((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);

    // Début du fade-out après durationMs
    const fadeTimer = setTimeout(() => {
      setIsFadingOut(true);

      // Marquer comme vues dans le localStorage
      if (!hasMarkedSeen.current) {
        hasMarkedSeen.current = true;
        const storageKey = `ikanai_seen_alerts_${userId || 'default'}`;
        try {
          const stored = localStorage.getItem(storageKey);
          const currentMap = stored ? JSON.parse(stored) : {};
          unseenAlerts.forEach((a) => {
            currentMap[getAlertKey(a)] = Date.now();
          });
          localStorage.setItem(storageKey, JSON.stringify(currentMap));
        } catch (e) {
          console.error('[EphemeralAlerts] Erreur mise à jour localStorage:', e);
        }
      }

      // Disparition complète du DOM après l'animation de fade-out (600ms)
      const removeTimer = setTimeout(() => {
        setIsVisible(false);
      }, 650);

      return () => clearTimeout(removeTimer);
    }, durationMs);

    return () => {
      clearInterval(intervalTimer);
      clearTimeout(fadeTimer);
    };
  }, [isVisible, unseenAlerts, durationMs, userId]);

  if (!isVisible || unseenAlerts.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        opacity: isFadingOut ? 0 : 1,
        transform: isFadingOut ? 'translateY(-10px)' : 'translateY(0)',
        maxHeight: isFadingOut ? '0px' : '500px',
        overflow: 'hidden',
        transition: 'opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1), transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        animation: 'ephemeralFadeIn 0.4s ease-out',
      }}
    >
      <style>{`
        @keyframes ephemeralFadeIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes progressCountdown {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>

      {unseenAlerts.map((a, i) => (
        <div
          key={i}
          style={{
            background: '#FEF3C7',
            border: '1px solid #FDE68A',
            borderLeft: '5px solid #D97706',
            borderRadius: '16px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            boxShadow: '0 2px 8px rgba(217, 119, 6, 0.08)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Barre de progression éphémère discrète */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: '3px',
              background: '#D97706',
              opacity: 0.35,
              animation: `progressCountdown ${durationMs}ms linear forwards`,
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <div style={{ color: '#D97706', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <AlertTriangleIcon size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: '#FDE68A',
                    color: '#92400E',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Nouvelle Alerte • {timeLeft}s
                </span>
                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#92400E' }}>
                  {a.message}
                </div>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#B45309', marginTop: '2px' }}>
                Agence <strong>{a.agence_nom}</strong> | Taux actuel : <strong>{a.taux_actuel}%</strong> (Seuil : {a.seuil}%)
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/alertes')}
            style={{
              background: '#FFFFFF',
              border: '1px solid #FDE68A',
              color: '#92400E',
              padding: '6px 12px',
              borderRadius: '10px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0,
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#FFFBEB')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
          >
            <span>Voir dans Alertes</span>
            <ChevronRightIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
