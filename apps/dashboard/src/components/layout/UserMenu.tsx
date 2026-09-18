import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { organisationsApi } from '../../services/api';
import type { User, UtilisationOrganisation, QuotaUtilisation } from '../../types';
import { ChevronDownIcon, SettingsIcon, LockIcon, CheckIcon, LogOutIcon } from '../common/Icons';

// À confirmer : adresse de support affichée dans « Obtenir de l'aide » et « Mettre le forfait à niveau ».
const SUPPORT_EMAIL = 'support@ikanai.app';

interface UserMenuProps {
  user: User | null;
  onLogout: () => void | Promise<void>;
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  padding: '9px 16px',
  background: 'transparent',
  border: 'none',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: '0.84rem',
  fontWeight: 600,
  color: '#1E293B',
  cursor: 'pointer',
  textDecoration: 'none',
  boxSizing: 'border-box',
};

function Separator() {
  return <div style={{ height: '1px', background: '#E8EEE9', margin: '6px 0' }} />;
}

function QuotaBar({ label, quota }: { label: string; quota: QuotaUtilisation }) {
  const illimite = quota.max === null;
  const ratio = illimite || !quota.max ? 0 : quota.actuel / quota.max;
  const couleur = ratio > 1 ? '#DC2626' : ratio >= 0.8 ? '#D97706' : '#3C7730';

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
        <span>{label}</span>
        <span style={{ color: '#02302D', fontWeight: 700 }}>
          {quota.actuel} {illimite ? '· illimité' : `/ ${quota.max}`}
        </span>
      </div>
      <div style={{ height: '6px', background: '#E8EEE9', borderRadius: '9999px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: illimite ? '100%' : `${Math.min(ratio, 1) * 100}%`,
            background: illimite ? '#CFE3D3' : couleur,
            borderRadius: '9999px',
          }}
        />
      </div>
    </div>
  );
}

export default function UserMenu({ user, onLogout }: UserMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [utilisation, setUtilisation] = useState<UtilisationOrganisation | null>(null);
  const [utilisationErreur, setUtilisationErreur] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isCX = user?.role === 'cx_manager';
  const isAdmin = user?.role === 'admin';

  // Fermeture au clic extérieur / Échap.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Utilisation en temps réel : rechargée à chaque ouverture du menu (CX Manager uniquement).
  useEffect(() => {
    if (!open || !isCX) return;
    let annule = false;
    organisationsApi
      .utilisation()
      .then((res) => {
        if (!annule) {
          setUtilisation(res.data);
          setUtilisationErreur(false);
        }
      })
      .catch(() => {
        if (!annule) setUtilisationErreur(true);
      });
    return () => {
      annule = true;
    };
  }, [open, isCX]);

  if (!user) return null;

  const initials = `${user.prenom?.[0] || 'A'}${user.nom?.[0] || 'D'}`.toUpperCase();
  const fullName = `${user.prenom || ''} ${user.nom || ''}`.trim() || 'Utilisateur';

  const sujetMiseANiveau = encodeURIComponent(
    `Mise à niveau du forfait${utilisation?.plan ? ` (actuel : ${utilisation.plan.nom})` : ''}${user.organisation_nom ? ` - ${user.organisation_nom}` : ''}`
  );
  const mailtoAide = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Demande d\'aide - IKAN AI')}`;
  const mailtoNiveau = `mailto:${SUPPORT_EMAIL}?subject=${sujetMiseANiveau}`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '4px 10px 4px 8px',
          borderRadius: '9999px',
          background: '#FFFFFF',
          border: `1px solid ${open ? '#3C7730' : '#E2E8F0'}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <div
          style={{
            width: '30px', height: '30px', borderRadius: '50%', background: '#EAF5EC', color: '#3C7730',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.78rem',
          }}
        >
          {initials}
        </div>
        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#1E293B' }}>{fullName}</span>
        <ChevronDownIcon size={14} color="#64748B" />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: '330px',
            maxHeight: 'calc(100vh - 100px)',
            overflowY: 'auto',
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '16px',
            boxShadow: '0 12px 32px rgba(2, 48, 45, 0.14)',
            padding: '8px 0',
            zIndex: 60,
          }}
        >
          {/* En-tête : nom + email */}
          <div style={{ padding: '10px 16px 12px' }}>
            <div style={{ fontWeight: 800, color: '#02302D', fontSize: '0.92rem' }}>{fullName}</div>
            <div style={{ color: '#64748B', fontSize: '0.78rem', wordBreak: 'break-all' }}>{user.email}</div>
          </div>
          <Separator />

          {/* Paramètres */}
          {isAdmin ? (
            <button
              role="menuitem"
              style={itemStyle}
              onClick={() => {
                setOpen(false);
                navigate('/admin/settings');
              }}
            >
              <SettingsIcon size={16} color="#64748B" />
              Paramètres
            </button>
          ) : (
            <div style={{ ...itemStyle, color: '#94A3B8', cursor: 'default' }} aria-disabled="true">
              <SettingsIcon size={16} color="#CBD5E1" />
              Paramètres
              <span style={{ marginLeft: 'auto', fontSize: '0.70rem', fontWeight: 600 }}>Bientôt disponible</span>
            </div>
          )}

          {/* Utilisation (CX Manager : l'admin et l'agency manager n'ont pas de quotas d'organisation) */}
          {isCX && (
            <>
              <Separator />
              <div style={{ padding: '6px 16px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.84rem', color: '#02302D' }}>Utilisation</span>
                  {utilisation?.plan && (
                    <span style={{ background: '#EAF5EC', color: '#3C7730', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: '9999px' }}>
                      Forfait {utilisation.plan.nom}
                    </span>
                  )}
                </div>

                {utilisation ? (
                  <>
                    <QuotaBar label="Agences" quota={utilisation.agences} />
                    <QuotaBar label="Feedbacks ce mois-ci" quota={utilisation.feedbacks_ce_mois} />
                    <QuotaBar label="CX Managers" quota={utilisation.cx_managers} />

                    <div style={{ marginTop: '12px', fontWeight: 700, fontSize: '0.76rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Fonctionnalités
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                      {utilisation.fonctionnalites.map((f) => (
                        <div key={f.code} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.80rem' }}>
                          {f.actif ? <CheckIcon size={14} color="#3C7730" /> : <LockIcon size={14} color="#94A3B8" />}
                          <span style={{ color: f.actif ? '#1E293B' : '#94A3B8', fontWeight: 600 }}>{f.libelle}</span>
                          {f.actif ? (
                            <span style={{ marginLeft: 'auto', color: '#3C7730', fontSize: '0.70rem', fontWeight: 700 }}>Disponible</span>
                          ) : (
                            <a
                              href={mailtoNiveau}
                              style={{ marginLeft: 'auto', color: '#D97706', fontSize: '0.70rem', fontWeight: 700, textDecoration: 'none' }}
                            >
                              Verrouillé · Mettre à niveau
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ color: '#94A3B8', fontSize: '0.78rem', padding: '4px 0 8px' }}>
                    {utilisationErreur ? 'Utilisation momentanément indisponible.' : 'Chargement…'}
                  </div>
                )}
              </div>
            </>
          )}

          <Separator />

          <a role="menuitem" href={mailtoAide} style={itemStyle}>
            Obtenir de l'aide
          </a>
          {isCX && (
            <a role="menuitem" href={mailtoNiveau} style={{ ...itemStyle, color: '#3C7730', fontWeight: 700 }}>
              Mettre le forfait à niveau
            </a>
          )}

          <Separator />

          <button
            role="menuitem"
            style={{ ...itemStyle, color: '#DC2626', fontWeight: 700 }}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOutIcon size={15} color="#DC2626" />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
