import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getFeedbackUrl } from '../../config';
import type { Agence, Categorie } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import { CopyIcon, DownloadIcon, TagIcon, CheckCircleIcon } from '../../components/common/Icons';

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '20px',
  border: '1px solid #E8ECE6',
  boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
  padding: '24px',
};

const boutonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '10px 16px',
  borderRadius: '12px',
  border: '1px solid #E2E8F0',
  background: '#FFFFFF',
  color: '#02302D',
  fontWeight: 700,
  fontSize: '0.84rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const qrImageUrl = (lien: string, taille: number) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${taille}x${taille}&data=${encodeURIComponent(lien)}`;

/**
 * "Mon agence" (Agency Manager) : QR code de collecte + catégories actives de SA
 * agence, en LECTURE SEULE. Création/modification des catégories et QR restent
 * réservées au CX Manager (l'API refuse toute écriture à l'Agency Manager).
 */
export default function MonAgencePage() {
  const user = useAuthStore((s) => s.user);
  if (user && user.role !== 'agency_manager') {
    return <Navigate to="/" replace />;
  }

  const [agence, setAgence] = useState<Agence | null>(null);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await agencesApi.list();
        const mienne: Agence | undefined = Array.isArray(res.data) ? res.data[0] : undefined;
        if (!mienne) {
          if (!annule) setErreur("Aucune agence n'est rattachée à votre compte.");
          return;
        }
        if (!annule) setAgence(mienne);
        try {
          const cats = await agencesApi.listCategories(mienne.id);
          if (!annule) setCategories(Array.isArray(cats.data) ? cats.data : []);
        } catch {
          if (!annule) setCategories([]);
        }
      } catch {
        if (!annule) setErreur("Impossible de charger les informations de votre agence.");
      } finally {
        if (!annule) setLoading(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  const afficherMessage = (texte: string) => {
    setMessage(texte);
    setTimeout(() => setMessage(''), 2500);
  };

  if (loading) {
    return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement de votre agence…</div>;
  }
  if (erreur || !agence) {
    return <div style={{ color: '#B91C1C', padding: '32px', fontWeight: 600 }}>{erreur || 'Agence introuvable.'}</div>;
  }

  const lien = getFeedbackUrl(agence.qr_code_token || agence.id);

  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(lien);
      afficherMessage('Lien copié dans le presse-papiers.');
    } catch {
      window.prompt('Copiez ce lien :', lien);
    }
  };

  const telechargerImage = async () => {
    const source = qrImageUrl(lien, 800);
    try {
      const blob = await (await fetch(source)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-code-${agence.nom.replace(/\s+/g, '-').toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      afficherMessage("Image du QR code téléchargée.");
    } catch {
      window.open(source, '_blank', 'noopener');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '760px' }}>
      <PageHeader
        title="Mon agence"
        subtitle={`${agence.nom}${agence.ville ? ` — ${agence.ville}` : ''} : QR code de collecte et catégories du formulaire.`}
      />

      {message && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px', background: '#EAF5EC', border: '1px solid #CFE3D3', color: '#3C7730', fontSize: '0.84rem', fontWeight: 600 }}>
          <CheckCircleIcon size={16} color="#3C7730" />
          {message}
        </div>
      )}

      {/* ── QR code ── */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>QR code de l'agence</h3>
        <p style={{ margin: '0 0 18px', fontSize: '0.82rem', color: '#64748B' }}>
          Vos clients le scannent pour laisser leur avis. Lecture seule : il est géré par votre CX Manager.
        </p>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
          <img
            src={qrImageUrl(lien, 220)}
            alt={`QR code de ${agence.nom}`}
            width={180}
            height={180}
            style={{ borderRadius: '12px', border: '1px solid #E8ECE6', padding: '8px', background: '#FFFFFF' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '0.78rem', color: '#64748B', wordBreak: 'break-all' }}>{lien}</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" onClick={copierLien} style={boutonStyle}>
                <CopyIcon size={16} /> Copier le lien
              </button>
              <button type="button" onClick={telechargerImage} style={boutonStyle}>
                <DownloadIcon size={16} /> Télécharger l'image
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Catégories actives (lecture seule) ── */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TagIcon size={18} color="#3C7730" />
          Catégories actives ({categories.length})
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: '#64748B' }}>
          Les thèmes proposés à vos clients dans le formulaire. Lecture seule : gérées par votre CX Manager.
        </p>
        {categories.length === 0 ? (
          <div style={{ color: '#64748B', fontSize: '0.86rem', fontWeight: 600 }}>
            Aucune catégorie personnalisée : le formulaire utilise la catégorie « Général » par défaut.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {categories.map((c) => (
              <span
                key={c.id}
                style={{ background: '#EAF5EC', color: '#3C7730', border: '1px solid #CFE3D3', borderRadius: '9999px', padding: '5px 14px', fontSize: '0.82rem', fontWeight: 700 }}
              >
                {c.nom}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
