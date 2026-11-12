import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { AlertTriangleIcon } from '../components/common/Icons';
import { userFacingError } from '../utils/userFacingError';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err: any) {
      const status = err?.response?.status;

      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        setError('Le serveur met du temps à répondre (réveil en cours). Veuillez réessayer.');
      } else if (!err.response) {
        setError('Impossible de joindre le serveur. Veuillez vérifier votre connexion ou réessayer.');
      } else if (status === 500 || status === 503) {
        setError('Le service de connexion est momentanément indisponible. Réessayez dans quelques instants.');
      } else {
        setError(status === 401 || status === 400 ? 'E-mail ou mot de passe incorrect' : userFacingError(err, 'Connexion impossible. Veuillez réessayer.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="login-page-wrapper"
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: 'var(--font-main)',
      }}
    >
      {/* SVG ClipPath Definition pour la forme organique ondulée */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          <clipPath id="login-organic-wave" clipPathUnits="objectBoundingBox">
            <path d="M 0,0 L 0.86,0 C 0.94,0.12 1.0,0.22 1.0,0.34 C 1.0,0.46 0.86,0.52 0.84,0.64 C 0.82,0.76 0.92,0.88 0.88,1.0 L 0,1.0 Z" />
          </clipPath>
        </defs>
      </svg>

      <style>{`
        @media (max-width: 960px) {
          .login-container {
            flex-direction: column !important;
            border-radius: 24px !important;
            min-height: auto !important;
          }
          .login-left-pane {
            width: 100% !important;
            min-height: auto !important;
            padding: 48px 24px !important;
            clip-path: none !important;
            -webkit-clip-path: none !important;
            border-radius: 24px 24px 0 0 !important;
          }
          .login-right-pane {
            width: 100% !important;
            padding: 48px 24px !important;
          }
        }
      `}</style>

      <div
        className="login-container"
        style={{
          width: '100%',
          maxWidth: '1240px',
          minHeight: '700px',
          background: 'var(--color-surface)',
          borderRadius: '32px',
          boxShadow: 'var(--shadow-overlay)',
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* ── PARTIE GAUCHE : Forme organique ondulée vert foncé ── */}
        <div
          className="login-left-pane"
          style={{
            width: '58%',
            backgroundColor: 'var(--color-encre)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 60px 48px 48px',
            overflow: 'hidden',
            color: 'var(--color-text-inverse)',
            textAlign: 'center',
            clipPath: 'url(#login-organic-wave)',
            WebkitClipPath: 'url(#login-organic-wave)',
          }}
        >
          {/* Contenu visuel & branding */}
          <div
            style={{
              position: 'relative',
              zIndex: 2,
              maxWidth: '480px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* Illustration QR Code & Personnages (scan2.png avec fond transparent) */}
            <div
              style={{
                marginBottom: '28px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: '100%',
              }}
            >
              <img
                src="/scan2.png"
                alt="Scanner le QR code pour donner son avis"
                style={{
                  maxHeight: '340px',
                  maxWidth: '100%',
                  width: 'auto',
                  height: 'auto',
                  display: 'block',
                  objectFit: 'contain',
                }}
              />
            </div>

            {/* Titre Principal */}
            <h1
              style={{
                fontSize: 'clamp(0.85rem, 2.4vw, 1.6rem)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-text-inverse)',
                lineHeight: 1.2,
                letterSpacing: '-0.025em',
                margin: '0 0 16px',
                maxWidth: '480px',
                width: '100%',
              }}
            >
              <span style={{ display: 'block', whiteSpace: 'nowrap' }}>Transformez l'expérience client</span>
              <span style={{ display: 'block', whiteSpace: 'nowrap' }}>en avantage compétitif</span>
            </h1>

            {/* Signature produit */}
            <p
              style={{
                fontSize: 'var(--text-base)',
                color: 'var(--sidebar-text)',
                lineHeight: 1.55,
                margin: 0,
                fontWeight: 'var(--weight-semibold)',
                letterSpacing: '0.02em',
              }}
            >
              Collecter - Analyser - Agir
            </p>
          </div>
        </div>

        {/* ── PARTIE DROITE (White Pane) ── */}
        <div
          className="login-right-pane"
          style={{
            flex: 1,
            width: '42%',
            background: 'var(--color-surface)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 36px',
            position: 'relative',
          }}
        >
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* Logo IKAN AI */}
          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
            <img
              src="/ikanai-logo-horizontal-green.png"
              alt="IKAN AI"
              style={{
                height: '90px',
                width: 'auto',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </div>

          {/* En-tête Titre & Sous-titre */}
          <h2
            style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-encre)',
              margin: '0 0 8px 0',
              textAlign: 'center',
              letterSpacing: '-0.02em',
            }}
          >
            Connexion
          </h2>

          <p
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-2)',
              margin: '0 0 32px 0',
              textAlign: 'center',
              fontWeight: 'var(--weight-normal)',
            }}
          >
            Accédez à votre espace de gestion
          </p>

          {/* Formulaire de Connexion */}
          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            {/* Champ Email */}
            <div style={{ marginBottom: '18px' }}>
              <label
                htmlFor="login-email"
                style={{
                  display: 'block',
                  fontWeight: 'var(--weight-semibold)',
                  marginBottom: '8px',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-encre)',
                }}
              >
                Adresse e-mail
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    color: 'var(--color-text-2)',
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </span>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="ex: cx@orange.tn"
                  style={{
                    width: '100%',
                    height: '48px',
                    paddingLeft: '44px',
                    paddingRight: '16px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '12px',
                    fontSize: 'var(--text-base)',
                    color: 'var(--color-encre)',
                    outline: 'none',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.target.style.background = 'var(--color-surface)';
                    e.target.style.borderColor = 'var(--color-accent)';
                    e.target.style.boxShadow = 'var(--focus-ring)';
                  }}
                  onBlur={(e) => {
                    e.target.style.background = 'var(--color-surface)';
                    e.target.style.borderColor = 'var(--color-border)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Champ Mot de passe */}
            <div style={{ marginBottom: '24px' }}>
              <label
                htmlFor="login-password"
                style={{
                  display: 'block',
                  fontWeight: 'var(--weight-semibold)',
                  marginBottom: '8px',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-encre)',
                }}
              >
                Mot de passe
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    color: 'var(--color-text-2)',
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  style={{
                    width: '100%',
                    height: '48px',
                    paddingLeft: '44px',
                    paddingRight: '44px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '12px',
                    fontSize: 'var(--text-base)',
                    color: 'var(--color-encre)',
                    outline: 'none',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.target.style.background = 'var(--color-surface)';
                    e.target.style.borderColor = 'var(--color-accent)';
                    e.target.style.boxShadow = 'var(--focus-ring)';
                  }}
                  onBlur={(e) => {
                    e.target.style.background = 'var(--color-surface)';
                    e.target.style.borderColor = 'var(--color-border)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '16px',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-text-muted)',
                  }}
                  title={showPassword ? 'Masquer' : 'Afficher'}
                >
                  {showPassword ? (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </svg>
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Message d'Erreur éventuel */}
            {error && (
              <div
                role="alert"
                style={{
                  background: 'var(--color-critique-fond)',
                  border: '1px solid var(--color-critique-fond)',
                  color: 'var(--color-critique-texte)',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  marginBottom: '18px',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangleIcon size={16} color="var(--color-critique-texte)" />
                <span>{error}</span>
              </div>
            )}

            {/* Bouton de Connexion Pleine Largeur */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                height: '48px',
                marginTop: '4px',
                background: loading ? 'var(--color-accent-hover)' : 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
                border: 'none',
                borderRadius: '12px',
                fontSize: 'var(--text-base)',
                fontWeight: 'var(--weight-semibold)',
                fontFamily: 'inherit',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'var(--color-accent-hover)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'var(--color-accent)';
                }
              }}
            >
              {loading ? 'Connexion en cours...' : 'Se connecter'}
            </button>
          </form>

          {/* Footer discret */}
          <div
            style={{
              marginTop: '48px',
              textAlign: 'center',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              fontWeight: 'var(--weight-normal)',
              lineHeight: 1.4,
            }}
          >
            IKAN AI © 2026 — Plateforme sécurisée d’analyse des avis clients
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
