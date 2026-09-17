import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { AlertTriangleIcon } from '../components/common/Icons';

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
        setError('Le serveur d’authentification est indisponible. Vérifiez que l’API est bien démarrée.');
      } else {
        setError(err?.response?.data?.detail || 'Email ou mot de passe incorrect');
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
        background: '#EDF3EF',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
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
          background: '#FFFFFF',
          borderRadius: '32px',
          boxShadow: '0 24px 64px rgba(2, 45, 42, 0.12), 0 4px 16px rgba(0, 0, 0, 0.04)',
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
            backgroundColor: '#022D2A',
            backgroundImage: `
              radial-gradient(circle at center, rgba(34, 197, 94, 0.08) 0%, rgba(2, 45, 42, 0) 60%),
              radial-gradient(rgba(255, 255, 255, 0.06) 1.2px, transparent 1.2px)
            `,
            backgroundSize: '100% 100%, 28px 28px',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 60px 48px 48px',
            overflow: 'hidden',
            color: '#FFFFFF',
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
                alt="Scan QR Code Feedback"
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
                fontSize: '1.95rem',
                fontWeight: 800,
                color: '#FFFFFF',
                lineHeight: 1.28,
                letterSpacing: '-0.025em',
                margin: '0 0 16px 0',
                maxWidth: '480px',
              }}
            >
              Transformez l'expérience client en<br />
              avantage compétitif
            </h1>

            {/* Texte Secondaire */}
            <p
              style={{
                fontSize: '0.94rem',
                color: 'rgba(255, 255, 255, 0.78)',
                lineHeight: 1.55,
                margin: '0 0 28px 0',
                fontWeight: 500,
                maxWidth: '440px',
              }}
            >
              Collectez, analysez et agissez sur les retours clients en temps réel across tout votre réseau d'agences.
            </p>

            {/* Badges Features */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  borderRadius: '9999px',
                  padding: '6px 14px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span style={{ color: '#4ADE80', fontSize: '0.68rem' }}>●</span> Analyse IA en temps réel
              </div>

              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  borderRadius: '9999px',
                  padding: '6px 14px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span style={{ color: '#4ADE80', fontSize: '0.68rem' }}>●</span> Traitement automatique des retours
              </div>
            </div>
          </div>
        </div>

        {/* ── PARTIE DROITE (White Pane) ── */}
        <div
          className="login-right-pane"
          style={{
            flex: 1,
            width: '42%',
            background: '#FFFFFF',
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
              src="/logo.png"
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
              fontSize: '1.85rem',
              fontWeight: 800,
              color: '#022D2A',
              margin: '0 0 8px 0',
              textAlign: 'center',
              letterSpacing: '-0.02em',
            }}
          >
            Connexion
          </h2>

          <p
            style={{
              fontSize: '0.92rem',
              color: '#64748B',
              margin: '0 0 32px 0',
              textAlign: 'center',
              fontWeight: 500,
            }}
          >
            Accédez à votre espace de gestion
          </p>

          {/* Formulaire de Connexion */}
          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            {/* Champ Email */}
            <div style={{ marginBottom: '18px' }}>
              <label
                style={{
                  display: 'block',
                  fontWeight: 700,
                  marginBottom: '8px',
                  fontSize: '0.86rem',
                  color: '#0F172A',
                }}
              >
                Adresse Email
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
                    color: '#94A3B8',
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
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="ex: cx@orange.tn"
                  style={{
                    width: '100%',
                    height: '48px',
                    paddingLeft: '44px',
                    paddingRight: '16px',
                    background: '#F0F4F8',
                    border: '1px solid transparent',
                    borderRadius: '12px',
                    fontSize: '0.92rem',
                    color: '#0F172A',
                    outline: 'none',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.target.style.background = '#FFFFFF';
                    e.target.style.borderColor = '#022D2A';
                    e.target.style.boxShadow = '0 0 0 3px rgba(2, 45, 42, 0.08)';
                  }}
                  onBlur={(e) => {
                    e.target.style.background = '#F0F4F8';
                    e.target.style.borderColor = 'transparent';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Champ Mot de passe */}
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  fontWeight: 700,
                  marginBottom: '8px',
                  fontSize: '0.86rem',
                  color: '#0F172A',
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
                    color: '#94A3B8',
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
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  style={{
                    width: '100%',
                    height: '48px',
                    paddingLeft: '44px',
                    paddingRight: '44px',
                    background: '#F0F4F8',
                    border: '1px solid transparent',
                    borderRadius: '12px',
                    fontSize: '0.92rem',
                    color: '#0F172A',
                    outline: 'none',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.target.style.background = '#FFFFFF';
                    e.target.style.borderColor = '#022D2A';
                    e.target.style.boxShadow = '0 0 0 3px rgba(2, 45, 42, 0.08)';
                  }}
                  onBlur={(e) => {
                    e.target.style.background = '#F0F4F8';
                    e.target.style.borderColor = 'transparent';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
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
                    color: '#94A3B8',
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
                      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Message d'Erreur éventuel */}
            {error && (
              <div
                style={{
                  background: '#FEE2E2',
                  border: '1px solid #FCA5A5',
                  color: '#991B1B',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  marginBottom: '18px',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangleIcon size={16} color="#991B1B" />
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
                background: loading ? '#3A5A55' : '#022D2A',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '12px',
                fontSize: '0.94rem',
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(2, 45, 42, 0.18)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = '#033B37';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 18px rgba(2, 45, 42, 0.25)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = '#022D2A';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(2, 45, 42, 0.18)';
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
              fontSize: '0.78rem',
              color: '#94A3B8',
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            IKAN AI © 2026 — Plateforme sécurisée d'analyse de retours clients
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
