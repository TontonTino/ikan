import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import { agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getFeedbackUrl } from '../../config';
import type { Agence, Categorie } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import { CopyIcon, DownloadIcon, TagIcon, CheckCircleIcon, PlusIcon, EditIcon, XCloseIcon } from '../../components/common/Icons';

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

const slug = (nom: string) => nom.trim().replace(/\s+/g, '-').toLowerCase();

/** Récupère une image distante et la convertit en data URL (nécessaire pour jsPDF.addImage). */
async function imageUrlEnDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Génère la fiche QR code de l'agence en PDF : carte compacte au format A6
 * (105 x 148 mm), pensée pour être imprimée et affichée en agence (chevalet,
 * comptoir) — une page A4 laisserait un QR minuscule perdu au milieu d'une
 * grande marge blanche. En-tête en texte (pas d'image) pour un rendu net à
 * toute taille sans dépendre du chargement d'un fichier logo.
 */
async function genererPdfQrCode(agence: Agence, lien: string) {
  const qrDataUrl = await imageUrlEnDataUrl(qrImageUrl(lien, 600));

  const doc = new jsPDF({ unit: 'mm', format: 'a6', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // En-tête : wordmark IKAN AI
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(2, 48, 45);
  doc.text('IKAN AI', pageW / 2, 14, { align: 'center' });
  doc.setDrawColor(117, 183, 42);
  doc.setLineWidth(0.6);
  doc.line(pageW / 2 - 10, 17, pageW / 2 + 10, 17);

  // Titre : nom de l'agence (peut passer sur 2 lignes si le nom est long)
  doc.setFontSize(13);
  doc.setTextColor(2, 48, 45);
  const nomLines = doc.splitTextToSize(agence.nom, pageW - 16);
  doc.text(nomLines, pageW / 2, 27, { align: 'center' });

  let y = 27 + nomLines.length * 5.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Scannez pour partager votre avis', pageW / 2, y + 5, { align: 'center' });
  y += 12;

  // QR code centré, sur un cadre blanc légèrement arrondi
  const qrSize = 60;
  const qrX = (pageW - qrSize) / 2;
  doc.setDrawColor(232, 236, 230);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(qrX - 5, y - 5, qrSize + 10, qrSize + 10, 3, 3, 'FD');
  doc.addImage(qrDataUrl, 'PNG', qrX, y, qrSize, qrSize);
  y += qrSize + 12;

  // Lien lisible en dessous
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const lienLines = doc.splitTextToSize(lien, pageW - 16);
  doc.text(lienLines, pageW / 2, y, { align: 'center' });

  // Pied de page
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text("IKAN AI — Plateforme d'écoute client", pageW / 2, pageH - 8, { align: 'center' });

  doc.save(`qr-code-${slug(agence.nom)}.pdf`);
}

/**
 * "Mon agence" (Agency Manager) : QR code de collecte de SA agence (lecture seule, géré
 * par le CX Manager) + catégories du formulaire. L'Agency Manager peut désormais ajouter
 * ses propres catégories et gérer (modifier/désactiver) UNIQUEMENT celles qu'il a créées ;
 * les catégories créées par le CX Manager restent en lecture seule pour lui (l'API refuse
 * toute écriture dessus, 403).
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

  // ── Formulaire d'ajout de catégorie ──
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [nouveauNom, setNouveauNom] = useState('');
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [erreurCategorie, setErreurCategorie] = useState('');

  // ── Édition inline (nom) d'une catégorie que j'ai créée ──
  const [categorieEnEdition, setCategorieEnEdition] = useState<string | null>(null);
  const [nomEdite, setNomEdite] = useState('');
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);

  // ── Génération du PDF du QR code ──
  const [pdfEnCours, setPdfEnCours] = useState(false);

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

  const telechargerPdf = async () => {
    setPdfEnCours(true);
    try {
      await genererPdfQrCode(agence, lien);
      afficherMessage('PDF du QR code téléchargé.');
    } catch {
      afficherMessage('Impossible de générer le PDF pour le moment.');
    } finally {
      setPdfEnCours(false);
    }
  };

  // Conservée en option secondaire : utile pour insérer le QR brut dans un
  // autre support (flyer, site web) sans le cadre/texte de la fiche PDF.
  const telechargerImagePng = async () => {
    const source = qrImageUrl(lien, 800);
    try {
      const blob = await (await fetch(source)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-code-${slug(agence.nom)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      afficherMessage('Image PNG du QR code téléchargée.');
    } catch {
      window.open(source, '_blank', 'noopener');
    }
  };

  const estAMoi = (c: Categorie) => c.cree_par_id != null && c.cree_par_id === user?.id;

  const ajouterCategorie = async () => {
    if (!nouveauNom.trim()) return;
    setErreurCategorie('');
    setAjoutEnCours(true);
    try {
      const r = await agencesApi.createCategorie(agence.id, { nom: nouveauNom.trim() });
      setCategories((prev) => [...prev, r.data]);
      setNouveauNom('');
      setFormulaireOuvert(false);
      afficherMessage('Catégorie ajoutée.');
    } catch (err: any) {
      setErreurCategorie(err?.response?.data?.detail || "Impossible d'ajouter cette catégorie.");
    } finally {
      setAjoutEnCours(false);
    }
  };

  const demarrerEdition = (c: Categorie) => {
    setCategorieEnEdition(c.id);
    setNomEdite(c.nom);
  };

  const enregistrerEdition = async (c: Categorie) => {
    if (!nomEdite.trim() || nomEdite.trim() === c.nom) {
      setCategorieEnEdition(null);
      return;
    }
    setActionEnCours(c.id);
    try {
      const r = await agencesApi.updateCategorie(agence.id, c.id, { nom: nomEdite.trim() });
      setCategories((prev) => prev.map((x) => (x.id === c.id ? r.data : x)));
      setCategorieEnEdition(null);
      afficherMessage('Catégorie modifiée.');
    } catch (err: any) {
      afficherMessage(err?.response?.data?.detail || 'Impossible de modifier cette catégorie.');
    } finally {
      setActionEnCours(null);
    }
  };

  const desactiverCategorie = async (c: Categorie) => {
    setActionEnCours(c.id);
    try {
      await agencesApi.deleteCategorie(agence.id, c.id);
      // L'Agency Manager ne voit que les catégories actives : une fois désactivée, elle disparaît de sa liste.
      setCategories((prev) => prev.filter((x) => x.id !== c.id));
      afficherMessage('Catégorie désactivée.');
    } catch (err: any) {
      afficherMessage(err?.response?.data?.detail || 'Impossible de désactiver cette catégorie.');
    } finally {
      setActionEnCours(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
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

      {/* ── QR code + Catégories actives, côte à côte pour tenir sur une page ── */}
      <div className="mon-agence-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(320px, 1fr)', gap: '18px', alignItems: 'start' }}>
        {/* QR code */}
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>QR code de l'agence</h3>
          <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: '#64748B' }}>
            Vos clients le scannent pour laisser leur avis. Lecture seule : il est géré par votre CX Manager.
          </p>
          <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
            <img
              src={qrImageUrl(lien, 220)}
              alt={`QR code de ${agence.nom}`}
              width={150}
              height={150}
              style={{ borderRadius: '12px', border: '1px solid #E8ECE6', padding: '8px', background: '#FFFFFF', flexShrink: 0 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '0.78rem', color: '#64748B', wordBreak: 'break-all' }}>{lien}</div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={copierLien} style={boutonStyle}>
                  <CopyIcon size={16} /> Copier le lien
                </button>
                <button type="button" onClick={telechargerPdf} disabled={pdfEnCours} style={{ ...boutonStyle, opacity: pdfEnCours ? 0.6 : 1 }}>
                  <DownloadIcon size={16} /> {pdfEnCours ? 'Génération…' : 'Télécharger le PDF'}
                </button>
                <button
                  type="button"
                  onClick={telechargerImagePng}
                  style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', padding: '4px' }}
                >
                  ou l'image PNG seule
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Catégories actives : les miennes sont gérables, celles du CX Manager en lecture seule */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '4px' }}>
            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#02302D', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TagIcon size={18} color="#3C7730" />
              Catégories actives ({categories.length})
            </h3>
            <button
              type="button"
              onClick={() => {
                setFormulaireOuvert((v) => !v);
                setErreurCategorie('');
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', background: formulaireOuvert ? '#F1F5F9' : '#EAF5EC',
                color: formulaireOuvert ? '#64748B' : '#3C7730', border: 'none', borderRadius: '9999px', padding: '6px 12px',
                fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
              }}
            >
              {formulaireOuvert ? <XCloseIcon size={14} /> : <PlusIcon size={14} />}
              {formulaireOuvert ? 'Annuler' : 'Ajouter une catégorie'}
            </button>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#64748B' }}>
            Les thèmes proposés à vos clients dans le formulaire. Vous gérez celles que vous avez ajoutées ;
            celles de votre CX Manager restent en lecture seule.
          </p>

          {formulaireOuvert && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <input
                type="text"
                value={nouveauNom}
                onChange={(e) => setNouveauNom(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ajouterCategorie()}
                placeholder="Ex: Accueil, Propreté..."
                maxLength={100}
                autoFocus
                style={{ flex: 1, padding: '9px 12px', borderRadius: '10px', border: '1px solid #E2E8F0', boxSizing: 'border-box', fontSize: '0.84rem' }}
              />
              <button
                type="button"
                onClick={ajouterCategorie}
                disabled={ajoutEnCours || !nouveauNom.trim()}
                style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '10px', padding: '9px 16px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: ajoutEnCours || !nouveauNom.trim() ? 0.6 : 1, fontFamily: 'inherit' }}
              >
                {ajoutEnCours ? 'Ajout…' : 'Ajouter'}
              </button>
            </div>
          )}
          {erreurCategorie && (
            <div style={{ color: '#B91C1C', fontSize: '0.78rem', fontWeight: 600, marginBottom: '12px' }}>{erreurCategorie}</div>
          )}

          {categories.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: '0.86rem', fontWeight: 600 }}>
              Aucune catégorie personnalisée : le formulaire utilise la catégorie « Général » par défaut.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {categories.map((c) => {
                const moi = estAMoi(c);
                const enEdition = categorieEnEdition === c.id;
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                      padding: '9px 12px', background: '#F8FAF8', border: '1px solid #E2EFE1', borderRadius: '12px',
                    }}
                  >
                    {enEdition ? (
                      <input
                        type="text"
                        value={nomEdite}
                        onChange={(e) => setNomEdite(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && enregistrerEdition(c)}
                        maxLength={100}
                        autoFocus
                        style={{ flex: 1, padding: '5px 8px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                      />
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>{c.nom}</span>
                        <span
                          style={{
                            fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', whiteSpace: 'nowrap',
                            background: moi ? '#EAF5EC' : '#F1F5F9',
                            color: moi ? '#3C7730' : '#64748B',
                          }}
                        >
                          {moi ? 'Ajoutée par vous' : 'Ajoutée par le CX Manager'}
                        </span>
                      </span>
                    )}

                    {moi && (
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        {enEdition ? (
                          <button
                            type="button"
                            onClick={() => enregistrerEdition(c)}
                            disabled={actionEnCours === c.id}
                            style={{ background: '#EAF5EC', color: '#3C7730', border: 'none', borderRadius: '8px', padding: '5px 10px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Enregistrer
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => demarrerEdition(c)}
                            title="Modifier"
                            style={{ background: '#F1F5F9', color: '#334155', border: 'none', borderRadius: '8px', padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <EditIcon size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => desactiverCategorie(c)}
                          disabled={actionEnCours === c.id}
                          style={{ background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '8px', padding: '5px 10px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Désactiver
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* En dessous de 900px, les deux blocs reprennent l'empilement vertical */}
      <style>{`
        @media (max-width: 900px) {
          .mon-agence-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
