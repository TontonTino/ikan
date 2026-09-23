import React, { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import jsPDF from 'jspdf';
import { agencesApi, statisticsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getFeedbackUrl } from '../../config';
import type { Agence, Categorie, ActiviteAgenceItem, StatsAgenceResponse } from '../../types';
import TabsNavigation, { TabItem } from '../../components/ui/TabsNavigation';
import SatisfactionEvolutionChart from '../../components/stats/SatisfactionEvolutionChart';
import {
  CopyIcon,
  DownloadIcon,
  TagIcon,
  CheckCircleIcon,
  PlusIcon,
  EditIcon,
  XCloseIcon,
  MapPinIcon,
  PhoneIcon,
  MailIcon,
  UsersIcon,
  BarChartIcon,
  ActivityIcon,
} from '../../components/common/Icons';

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

type AgenceTab = 'informations' | 'categories' | 'statistiques' | 'activite';
const TABS_VALIDES: AgenceTab[] = ['informations', 'categories', 'statistiques', 'activite'];

/**
 * Page agence unifiée : sert à la fois de "Mon agence" (Agency Manager, sur sa
 * propre agence, via /mon-agence) et de vue détaillée d'une agence précise pour
 * le CX Manager (via /agences/:agenceId/apercu, depuis l'onglet Agences de la
 * Vue Siège ou le Répertoire). Le composant est identique pour les deux rôles ;
 * seul l'agenceId effectif change (route param pour le CX Manager, agence
 * rattachée au compte pour l'Agency Manager), et les droits d'écriture sur les
 * catégories restent entièrement arbitrés par l'API (voir agences.py).
 */
export default function MonAgencePage() {
  const user = useAuthStore((s) => s.user);
  const { agenceId: agenceIdParam } = useParams<{ agenceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (user && user.role !== 'agency_manager' && user.role !== 'cx_manager') {
    return <Navigate to="/" replace />;
  }

  const agenceId = agenceIdParam || user?.agence_id;

  const requestedTab = searchParams.get('tab');
  const initialTab: AgenceTab = TABS_VALIDES.includes(requestedTab as AgenceTab) ? (requestedTab as AgenceTab) : 'informations';
  const [activeTab, setActiveTab] = useState<AgenceTab>(initialTab);

  const [agence, setAgence] = useState<Agence | null>(null);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [stats, setStats] = useState<StatsAgenceResponse | null>(null);
  const [activite, setActivite] = useState<ActiviteAgenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  // ── Formulaire d'ajout de catégorie ──
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [nouveauNom, setNouveauNom] = useState('');
  const [nouveauEstSuggestion, setNouveauEstSuggestion] = useState(false);
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [erreurCategorie, setErreurCategorie] = useState('');

  // ── Édition inline (nom) d'une catégorie que je peux gérer ──
  const [categorieEnEdition, setCategorieEnEdition] = useState<string | null>(null);
  const [nomEdite, setNomEdite] = useState('');
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);

  // ── Génération du PDF du QR code ──
  const [pdfEnCours, setPdfEnCours] = useState(false);

  useEffect(() => {
    if (!agenceId) {
      setLoading(false);
      return;
    }
    let annule = false;
    setLoading(true);
    (async () => {
      try {
        const res = await agencesApi.get(agenceId);
        if (!annule) setAgence(res.data);
        try {
          const cats = await agencesApi.listCategories(agenceId);
          if (!annule) setCategories(Array.isArray(cats.data) ? cats.data : []);
        } catch {
          if (!annule) setCategories([]);
        }
      } catch {
        if (!annule) setErreur("Impossible de charger les informations de cette agence.");
      } finally {
        if (!annule) setLoading(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, [agenceId]);

  useEffect(() => {
    if (!agenceId) return;
    let annule = false;
    statisticsApi
      .agency({ agence_id: agenceId, jours: 30 })
      .then((r) => {
        if (!annule) setStats(r.data);
      })
      .catch(() => {
        if (!annule) setStats(null);
      });
    return () => {
      annule = true;
    };
  }, [agenceId]);

  useEffect(() => {
    if (!agenceId) return;
    let annule = false;
    agencesApi
      .activite(agenceId)
      .then((r) => {
        if (!annule) setActivite(Array.isArray(r.data) ? r.data : []);
      })
      .catch(() => {
        if (!annule) setActivite([]);
      });
    return () => {
      annule = true;
    };
  }, [agenceId]);

  const handleTabChange = (id: string) => {
    const tab = id as AgenceTab;
    setActiveTab(tab);
    setSearchParams(tab === 'informations' ? {} : { tab }, { replace: true });
  };

  const afficherMessage = (texte: string) => {
    setMessage(texte);
    setTimeout(() => setMessage(''), 2500);
  };

  if (!agenceId) {
    return <div style={{ color: '#B91C1C', padding: '32px', fontWeight: 600 }}>Aucune agence n'est rattachée à votre compte.</div>;
  }
  if (loading) {
    return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement de l'agence…</div>;
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

  // Le CX Manager gère toutes les catégories de son organisation (l'API l'autorise
  // déjà) ; l'Agency Manager ne gère que celles qu'il a lui-même créées.
  const peutGererCategorie = (c: Categorie) =>
    user?.role === 'cx_manager' || (c.cree_par_id != null && c.cree_par_id === user?.id);

  const ajouterCategorie = async () => {
    if (!nouveauNom.trim()) return;
    setErreurCategorie('');
    setAjoutEnCours(true);
    try {
      const r = await agencesApi.createCategorie(agence.id, {
        nom: nouveauNom.trim(),
        est_categorie_suggestion: nouveauEstSuggestion,
      });
      setCategories((prev) => [...prev, r.data]);
      setNouveauNom('');
      setNouveauEstSuggestion(false);
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

  const toggleEstSuggestion = async (c: Categorie) => {
    setActionEnCours(c.id);
    try {
      const r = await agencesApi.updateCategorie(agence.id, c.id, { est_categorie_suggestion: !c.est_categorie_suggestion });
      setCategories((prev) => prev.map((x) => (x.id === c.id ? r.data : x)));
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
      setCategories((prev) => prev.filter((x) => x.id !== c.id));
      afficherMessage('Catégorie désactivée.');
    } catch (err: any) {
      afficherMessage(err?.response?.data?.detail || 'Impossible de désactiver cette catégorie.');
    } finally {
      setActionEnCours(null);
    }
  };

  const tabsConfig: TabItem[] = [
    { id: 'informations', label: 'Informations', icon: <MapPinIcon size={16} /> },
    { id: 'categories', label: 'Catégories', icon: <TagIcon size={16} />, badge: categories.length },
    { id: 'statistiques', label: 'Statistiques', icon: <BarChartIcon size={16} /> },
    { id: 'activite', label: 'Activité', icon: <ActivityIcon size={16} /> },
  ];

  const positifs = stats?.sentiments.find((s) => s.sentiment === 'positif')?.count ?? 0;
  const negatifs = stats?.sentiments.find((s) => s.sentiment === 'negatif')?.count ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* ── En-tête : nom, statut, ville, manager ── */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#02302D' }}>{agence.nom}</h1>
            <span
              style={{
                fontSize: '0.70rem', fontWeight: 800, padding: '3px 10px', borderRadius: '9999px',
                background: agence.active ? '#EBF6ED' : '#F1F5F9',
                color: agence.active ? '#3C7730' : '#64748B',
              }}
            >
              {agence.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '8px', fontSize: '0.84rem', color: '#64748B' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <MapPinIcon size={15} color="#94A3B8" />
              {agence.ville || 'Ville non renseignée'}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UsersIcon size={15} color="#94A3B8" />
              {agence.manager_nom || 'Aucun manager assigné'}
            </span>
          </div>
        </div>
      </div>

      {message && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px', background: '#EAF5EC', border: '1px solid #CFE3D3', color: '#3C7730', fontSize: '0.84rem', fontWeight: 600 }}>
          <CheckCircleIcon size={16} color="#3C7730" />
          {message}
        </div>
      )}

      {/* ── QR code (inchangé, toujours visible, hors onglets) ── */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>QR code de l'agence</h3>
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: '#64748B' }}>
          Vos clients le scannent pour laisser leur avis. Lecture seule : il est géré par le CX Manager.
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

      <TabsNavigation tabs={tabsConfig} activeTab={activeTab} onChange={handleTabChange} style={{ marginBottom: 0 }} />

      {/* ── Onglet Informations ── */}
      {activeTab === 'informations' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: '18px' }}>
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 14px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>Coordonnées</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.86rem', color: '#334155' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <MapPinIcon size={17} color="#94A3B8" />
                <span>{agence.adresse || 'Adresse non renseignée'}{agence.ville ? ` — ${agence.ville}` : ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <PhoneIcon size={17} color="#94A3B8" />
                <span>{agence.telephone || 'Téléphone non renseigné'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <MailIcon size={17} color="#94A3B8" />
                <span>{agence.email || 'Email non renseigné'}</span>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 14px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>Performances clés (30 derniers jours)</h3>
            {!stats ? (
              <div style={{ color: '#64748B', fontSize: '0.84rem' }}>Chargement…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div style={{ background: '#F8FAF8', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#02302D' }}>{stats.kpis.satisfaction?.valeur ?? '—'}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 600, marginTop: '4px' }}>Satisfaction</div>
                </div>
                <div style={{ background: '#EBF6ED', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#3C7730' }}>{positifs}</div>
                  <div style={{ fontSize: '0.72rem', color: '#3C7730', fontWeight: 600, marginTop: '4px' }}>Avis positifs</div>
                </div>
                <div style={{ background: '#FEF2F2', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#DC2626' }}>{negatifs}</div>
                  <div style={{ fontSize: '0.72rem', color: '#DC2626', fontWeight: 600, marginTop: '4px' }}>Avis négatifs</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Onglet Catégories (contenu inchangé, déplacé depuis l'ancienne page) ── */}
      {activeTab === 'categories' && (
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
            Les thèmes proposés aux clients dans le formulaire. Une catégorie « suggestion » déclenche une alerte dédiée
            (voir Pilotage) lorsqu'un feedback qui lui est associé reste non traité.
          </p>

          {formulaireOuvert && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#334155', fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={nouveauEstSuggestion} onChange={(e) => setNouveauEstSuggestion(e.target.checked)} />
                Catégorie « suggestion » (déclenche une alerte dédiée)
              </label>
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
                const gerable = peutGererCategorie(c);
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
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>{c.nom}</span>
                        <span
                          style={{
                            fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', whiteSpace: 'nowrap',
                            background: c.cree_par_role === 'agency_manager' ? '#EFF6FF' : '#F1F5F9',
                            color: c.cree_par_role === 'agency_manager' ? '#2563EB' : '#64748B',
                          }}
                        >
                          {c.cree_par_role === 'agency_manager' ? 'Ajoutée par l’Agency Manager' : 'Ajoutée par le CX Manager'}
                        </span>
                        {c.est_categorie_suggestion && (
                          <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', whiteSpace: 'nowrap', background: '#FEF3E2', color: '#B45309' }}>
                            Suggestion
                          </span>
                        )}
                      </span>
                    )}

                    {gerable && (
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
                          onClick={() => toggleEstSuggestion(c)}
                          disabled={actionEnCours === c.id}
                          title="Basculer le type suggestion"
                          style={{ background: c.est_categorie_suggestion ? '#FEF3E2' : '#F1F5F9', color: c.est_categorie_suggestion ? '#B45309' : '#64748B', border: 'none', borderRadius: '8px', padding: '5px 10px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          {c.est_categorie_suggestion ? 'Suggestion ✓' : 'Marquer suggestion'}
                        </button>
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
      )}

      {/* ── Onglet Statistiques (réutilise le composant partagé, paramétré par agence_id) ── */}
      {activeTab === 'statistiques' && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>Évolution de la satisfaction</h3>
          <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: '#64748B' }}>30 derniers jours.</p>
          {!stats ? (
            <div style={{ color: '#64748B', fontSize: '0.84rem' }}>Chargement…</div>
          ) : (
            <SatisfactionEvolutionChart data={stats.evolution_satisfaction} height={280} />
          )}
        </div>
      )}

      {/* ── Onglet Activité (HistoriqueFeedback + HistoriqueSuggestion fusionnés) ── */}
      {activeTab === 'activite' && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 14px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D' }}>Fil d'activité</h3>
          {activite.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: '0.86rem', fontWeight: 600 }}>Aucun événement récent.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {activite.map((ev) => (
                <div key={ev.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>{ev.auteur_nom}</span>
                    <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{new Date(ev.date).toLocaleString('fr-FR')}</span>
                  </div>
                  <span style={{ fontSize: '0.78rem', color: '#3C7730', fontWeight: 700, textTransform: 'capitalize' }}>{ev.type_evenement.replace(/_/g, ' ')}</span>
                  {ev.details && <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#64748B' }}>{ev.details}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
