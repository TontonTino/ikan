import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { organisationsApi } from '../../services/api';
import type { User, UtilisationOrganisation, QuotaUtilisation } from '../../types';
import { ChevronDownIcon, SettingsIcon, LockIcon, CheckIcon, LogOutIcon, ClockIcon } from '../common/Icons';

// À confirmer : adresse de support affichée dans « Obtenir de l'aide » et pour la mise à niveau vers Entreprise (devis).
const SUPPORT_EMAIL = 'support@ikanai.app';

// Catalogue d'affichage des forfaits payants en libre-service (Stripe Checkout).
// Miroir des limites définies dans apps/api/app/services/plan_catalog.py (PLANS) —
// à garder synchronisé si les forfaits changent. Le prix n'existe nulle part côté
// API (seul le Price Stripe le connaît) : il est dupliqué ici uniquement pour
// l'affichage, la valeur réellement facturée reste celle du Price Stripe.
const CATALOGUE_OFFRES: Record<'starter' | 'pro', { nom: string; prix: string; limites: string[] }> = {
  starter: {
    nom: 'Starter',
    prix: '30 000 FCFA / mois',
    limites: ['Jusqu\'à 3 agences', '1 CX Manager', 'Feedbacks illimités'],
  },
  pro: {
    nom: 'Pro',
    prix: '50 000 FCFA / mois',
    limites: ['Jusqu\'à 10 agences', '3 CX Managers', 'Feedbacks illimités', 'Détection de discordance'],
  },
};

// Offres proposables en libre-service depuis le forfait actuel : Gratuit voit
// Starter ET Pro, Starter ne voit plus que Pro, Pro/Entreprise n'ont rien en
// libre-service (Entreprise reste sur devis, cf. mailtoNiveau).
function offresDisponiblesPour(planCode: string | undefined): ('starter' | 'pro')[] {
  if (!planCode || planCode === 'gratuit') return ['starter', 'pro'];
  if (planCode === 'starter') return ['pro'];
  return [];
}

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
  const [utilisationOuverte, setUtilisationOuverte] = useState(false);
  const [offresOuvertes, setOffresOuvertes] = useState(false);
  const [checkoutEnCoursPour, setCheckoutEnCoursPour] = useState<'starter' | 'pro' | null>(null);
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

  // Les sections repliables repartent toujours fermées à la prochaine ouverture du menu.
  useEffect(() => {
    if (!open) {
      setUtilisationOuverte(false);
      setOffresOuvertes(false);
    }
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
  // Conservé uniquement pour la mise à niveau vers Entreprise (sur devis, pas de Stripe).
  const mailtoNiveau = `mailto:${SUPPORT_EMAIL}?subject=${sujetMiseANiveau}`;

  // Offres en libre-service disponibles depuis le forfait actuel (peut en contenir
  // 0, 1 ou 2 — Starter ET Pro si l'organisation est encore en Gratuit).
  const offres = offresDisponiblesPour(utilisation?.plan?.code);
  // Entreprise reste sur devis : proposé seulement quand il ne reste aucune offre
  // en libre-service ET que l'organisation n'est pas déjà en Entreprise.
  const entrepriseProposable = offres.length === 0 && utilisation?.plan?.code !== 'entreprise';

  const lancerCheckout = async (planCode: 'starter' | 'pro') => {
    setCheckoutEnCoursPour(planCode);
    try {
      const res = await organisationsApi.upgradeCheckout(planCode);
      window.location.href = res.data.checkout_url;
    } catch {
      setCheckoutEnCoursPour(null);
    }
  };

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

          {/* Utilisation (CX Manager : l'admin et l'agency manager n'ont pas de quotas d'organisation)
              Repliée par défaut : seul le titre est visible à l'ouverture du menu, le contenu
              (barres de quota + catalogue de fonctionnalités) ne s'affiche qu'au clic. */}
          {isCX && (
            <>
              <Separator />
              <button
                type="button"
                onClick={() => setUtilisationOuverte((o) => !o)}
                aria-expanded={utilisationOuverte}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  padding: '8px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.84rem', color: '#02302D' }}>Utilisation</span>
                  {utilisation?.plan && (
                    <span style={{ background: '#EAF5EC', color: '#3C7730', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: '9999px' }}>
                      Forfait {utilisation.plan.nom}
                    </span>
                  )}
                </span>
                <ChevronDownIcon
                  size={14}
                  color="#64748B"
                  style={{ transform: utilisationOuverte ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                />
              </button>

              {utilisationOuverte && (
                <div style={{ padding: '0 16px 8px' }}>
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
                            {f.statut === 'disponible' && <CheckIcon size={14} color="#3C7730" />}
                            {f.statut === 'verrouille' && <LockIcon size={14} color="#94A3B8" />}
                            {f.statut === 'a_venir' && <ClockIcon size={14} color="#6B7FA3" />}
                            <span style={{ color: f.statut === 'disponible' ? '#1E293B' : '#94A3B8', fontWeight: 600 }}>{f.libelle}</span>
                            {f.statut === 'disponible' && (
                              <span style={{ marginLeft: 'auto', color: '#3C7730', fontSize: '0.70rem', fontWeight: 700 }}>Disponible</span>
                            )}
                            {f.statut === 'verrouille' && (offres.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setOffresOuvertes(true)}
                                style={{
                                  marginLeft: 'auto', color: '#D97706', fontSize: '0.70rem', fontWeight: 700,
                                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                                }}
                              >
                                Verrouillé · Voir les offres
                              </button>
                            ) : (
                              <a
                                href={mailtoNiveau}
                                style={{ marginLeft: 'auto', color: '#D97706', fontSize: '0.70rem', fontWeight: 700, textDecoration: 'none' }}
                              >
                                Verrouillé · Mettre à niveau
                              </a>
                            ))}
                            {/* À venir : aucun forfait ne la débloque, donc aucun lien d'upgrade. */}
                            {f.statut === 'a_venir' && (
                              <span
                                style={{
                                  marginLeft: 'auto', color: '#4B5F86', background: '#EEF2F9', border: '1px solid #DCE4F2',
                                  fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px',
                                }}
                              >
                                À venir
                              </span>
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
              )}
            </>
          )}

          <Separator />

          <a role="menuitem" href={mailtoAide} style={itemStyle}>
            Obtenir de l'aide
          </a>

          {/* Mise à niveau : dépliable, propose CHAQUE offre disponible (Starter ET Pro
              depuis Gratuit) avec son prix et ses limites, plutôt qu'une seule offre imposée. */}
          {isCX && offres.length > 0 && (
            <>
              <button
                role="menuitem"
                type="button"
                onClick={() => setOffresOuvertes((o) => !o)}
                aria-expanded={offresOuvertes}
                style={{ ...itemStyle, color: '#3C7730', fontWeight: 700, justifyContent: 'space-between' }}
              >
                <span>Mettre le forfait à niveau</span>
                <ChevronDownIcon
                  size={14}
                  color="#3C7730"
                  style={{ transform: offresOuvertes ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                />
              </button>

              {offresOuvertes && (
                <div style={{ padding: '2px 16px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {offres.map((code) => {
                    const offre = CATALOGUE_OFFRES[code];
                    const enCours = checkoutEnCoursPour === code;
                    return (
                      <div
                        key={code}
                        style={{
                          border: '1px solid #E8EEE9', borderRadius: '12px', padding: '10px 12px',
                          background: '#FAFDFB',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 800, fontSize: '0.82rem', color: '#02302D' }}>{offre.nom}</span>
                          <span style={{ fontWeight: 700, fontSize: '0.76rem', color: '#3C7730' }}>{offre.prix}</span>
                        </div>
                        <ul style={{ margin: '0 0 8px', paddingLeft: '16px', fontSize: '0.74rem', color: '#64748B' }}>
                          {offre.limites.map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          disabled={checkoutEnCoursPour !== null}
                          onClick={() => lancerCheckout(code)}
                          style={{
                            width: '100%', padding: '7px 0', borderRadius: '8px', border: 'none',
                            background: '#3C7730', color: '#FFFFFF', fontWeight: 700, fontSize: '0.78rem',
                            fontFamily: 'inherit', cursor: checkoutEnCoursPour !== null ? 'default' : 'pointer',
                            opacity: checkoutEnCoursPour !== null && !enCours ? 0.5 : 1,
                          }}
                        >
                          {enCours ? 'Redirection…' : `Choisir ${offre.nom}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {isCX && entrepriseProposable && (
            <a role="menuitem" href={mailtoNiveau} style={{ ...itemStyle, color: '#3C7730', fontWeight: 700 }}>
              Passer à Entreprise (devis)
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
