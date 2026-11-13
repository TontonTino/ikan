import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { organisationsApi } from '../../services/api';
import type { User, UtilisationOrganisation, QuotaUtilisation } from '../../types';
import { ChevronDownIcon, SettingsIcon, LockIcon, CheckIcon, LogOutIcon, ClockIcon } from '../common/Icons';
import { RESPONSABLE_CX, ROLE_LABELS_PLURIEL } from '../../utils/vocabulaire';
import { SUPPORT_EMAIL } from '../../utils/contact';

// À confirmer : adresse de support (utils/contact.ts) affichée dans « Obtenir de l'aide » et pour la mise à niveau vers Entreprise (devis).

// Catalogue d'affichage des forfaits payants en libre-service (Stripe Checkout).
// Miroir des limites définies dans apps/api/app/services/plan_catalog.py (PLANS) —
// à garder synchronisé si les forfaits changent. Le prix n'existe nulle part côté
// API (seul le Price Stripe le connaît) : il est dupliqué ici uniquement pour
// l'affichage, la valeur réellement facturée reste celle du Price Stripe.
const CATALOGUE_OFFRES: Record<'starter' | 'pro', { nom: string; prix: string; limites: string[] }> = {
  starter: {
    nom: 'Starter',
    prix: '30 000 FCFA / mois',
    limites: ['Jusqu\'à 3 agences', `1 ${RESPONSABLE_CX}`, 'Avis clients illimités'],
  },
  pro: {
    nom: 'Pro',
    prix: '50 000 FCFA / mois',
    limites: ['Jusqu\'à 10 agences', `3 ${ROLE_LABELS_PLURIEL.cx_manager.toLowerCase()}`, 'Avis clients illimités', 'Détection des avis contradictoires'],
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
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-encre)',
  cursor: 'pointer',
  textDecoration: 'none',
  boxSizing: 'border-box',
};

function Separator() {
  return <div style={{ height: '1px', background: 'var(--color-trait)', margin: '6px 0' }} />;
}

function QuotaBar({ label, quota }: { label: string; quota: QuotaUtilisation }) {
  const illimite = quota.max === null;
  const ratio = illimite || !quota.max ? 0 : quota.actuel / quota.max;
  const couleur = ratio > 1 ? 'var(--color-critique-texte)' : ratio >= 0.8 ? 'var(--color-surveiller-texte)' : 'var(--color-marque)';

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-2)', marginBottom: '4px' }}>
        <span>{label}</span>
        <span style={{ color: 'var(--color-encre)', fontWeight: 'var(--weight-semibold)' }}>
          {quota.actuel} {illimite ? '· illimité' : `/ ${quota.max}`}
        </span>
      </div>
      <div style={{ height: '6px', background: 'var(--color-neutre-fond)', borderRadius: '9999px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: illimite ? '100%' : `${Math.min(ratio, 1) * 100}%`,
            background: illimite ? 'var(--color-trait)' : couleur,
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
          background: 'var(--color-surface)',
          border: `1px solid ${open ? 'var(--color-encre)' : 'var(--color-border)'}`,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <div
          style={{
            width: '30px', height: '30px', borderRadius: '50%', background: 'var(--color-bon-fond)', color: 'var(--color-bon-texte)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)',
          }}
        >
          {initials}
        </div>
        <span className="user-menu__nom" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>{fullName}</span>
        <ChevronDownIcon size={14} color="var(--color-text-2)" />
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
            background: 'var(--color-surface)',
            border: '1px solid var(--color-trait)',
            borderRadius: '16px',
            boxShadow: 'var(--shadow-dropdown)',
            padding: '8px 0',
            zIndex: 60,
          }}
        >
          {/* En-tête : nom + email */}
          <div style={{ padding: '10px 16px 12px' }}>
            <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', fontSize: 'var(--text-base)' }}>{fullName}</div>
            <div style={{ color: 'var(--color-text-2)', fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>{user.email}</div>
          </div>
          <Separator />

          {/* Paramètres — Admin : configuration système globale ; CX Manager/Agency
              Manager : paramètres de leur propre compte (nom, email, mot de passe). */}
          <button
            role="menuitem"
            style={itemStyle}
            onClick={() => {
              setOpen(false);
              navigate(isAdmin ? '/admin/settings' : '/parametres');
            }}
          >
            <SettingsIcon size={16} color="var(--color-text-2)" />
            Paramètres
          </button>

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
                  <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-encre)' }}>Utilisation</span>
                  {utilisation?.plan && (
                    <span style={{ background: 'var(--color-bon-fond)', color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', padding: '3px 10px', borderRadius: '9999px' }}>
                      Forfait {utilisation.plan.nom}
                    </span>
                  )}
                </span>
                <ChevronDownIcon
                  size={14}
                  color="var(--color-text-2)"
                  style={{ transform: utilisationOuverte ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                />
              </button>

              {utilisationOuverte && (
                <div style={{ padding: '0 16px 8px' }}>
                  {utilisation ? (
                    <>
                      <QuotaBar label="Agences" quota={utilisation.agences} />
                      <QuotaBar label="Avis reçus ce mois-ci" quota={utilisation.feedbacks_ce_mois} />
                      <QuotaBar label={ROLE_LABELS_PLURIEL.cx_manager} quota={utilisation.cx_managers} />

                      <div style={{ marginTop: '12px', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Fonctionnalités
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                        {utilisation.fonctionnalites.map((f) => (
                          <div key={f.code} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-xs)' }}>
                            {f.statut === 'disponible' && <CheckIcon size={14} color="var(--color-bon-texte)" />}
                            {f.statut === 'verrouille' && <LockIcon size={14} color="var(--color-text-2)" />}
                            {f.statut === 'a_venir' && <ClockIcon size={14} color="var(--color-text-2)" />}
                            <span style={{ color: f.statut === 'disponible' ? 'var(--color-encre)' : 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>{f.libelle}</span>
                            {f.statut === 'disponible' && (
                              <span style={{ marginLeft: 'auto', color: 'var(--color-bon-texte)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>Disponible</span>
                            )}
                            {f.statut === 'verrouille' && (offres.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setOffresOuvertes(true)}
                                style={{
                                  marginLeft: 'auto', color: 'var(--color-surveiller-texte)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
                                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                                }}
                              >
                                Verrouillé · Voir les offres
                              </button>
                            ) : (
                              <a
                                href={mailtoNiveau}
                                style={{ marginLeft: 'auto', color: 'var(--color-surveiller-texte)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', textDecoration: 'none' }}
                              >
                                Verrouillé · Mettre à niveau
                              </a>
                            ))}
                            {/* À venir : aucun forfait ne la débloque, donc aucun lien d'upgrade. */}
                            {f.statut === 'a_venir' && (
                              <span
                                style={{
                                  marginLeft: 'auto', color: 'var(--color-neutre-texte)', background: 'var(--color-neutre-fond)',
                                  fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', padding: '2px 8px', borderRadius: '9999px',
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
                    <div style={{ color: 'var(--color-text-2)', fontSize: 'var(--text-xs)', padding: '4px 0 8px' }}>
                      {utilisationErreur ? 'Utilisation momentanément indisponible.' : 'Chargement…'}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <Separator />

          <a role="menuitem" href={mailtoAide} style={itemStyle} onClick={() => setOpen(false)}>
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
                style={{ ...itemStyle, color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)', justifyContent: 'space-between' }}
              >
                <span>Mettre le forfait à niveau</span>
                <ChevronDownIcon
                  size={14}
                  color="var(--color-bon-texte)"
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
                          border: '1px solid var(--color-trait)', borderRadius: '12px', padding: '10px 12px',
                          background: 'var(--color-bg)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-encre)' }}>{offre.nom}</span>
                          <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--color-bon-texte)' }}>{offre.prix}</span>
                        </div>
                        <ul style={{ margin: '0 0 8px', paddingLeft: '16px', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>
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
                            background: 'var(--color-accent)', color: 'var(--color-text-inverse)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)',
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
            <a role="menuitem" href={mailtoNiveau} style={{ ...itemStyle, color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)' }}>
              Passer à Entreprise (devis)
            </a>
          )}

          <Separator />

          <button
            role="menuitem"
            style={{ ...itemStyle, color: 'var(--color-critique-texte)', fontWeight: 'var(--weight-semibold)' }}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOutIcon size={15} color="var(--color-critique-texte)" />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
