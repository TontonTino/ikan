import React, { useEffect, useState, useMemo } from 'react';
import { agencesApi, dashboardApi } from '../../services/api';
import { getFeedbackUrl } from '../../config';
import { useAuthStore } from '../../stores/authStore';
import type { Agence, AgenceStats, Categorie } from '../../types';
import TabsNavigation from '../../components/ui/TabsNavigation';
import {
  PlusIcon,
  MapPinIcon,
  TargetIcon,
  QrCodeIcon,
  EditIcon,
  TrashIcon,
  ExternalLinkIcon,
  SearchIcon,
  CheckCircleIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  ClockIcon,
  TagIcon,
} from '../../components/common/Icons';
import { AgencyLocationPicker, LocationData } from '../../components/agency/AgencyLocationPicker';

interface AgenceForm {
  nom: string;
  adresse: string;
  ville: string;
  latitude: number | null;
  longitude: number | null;
  seuil_alerte: number;
}

const emptyForm: AgenceForm = {
  nom: '',
  adresse: '',
  ville: '',
  latitude: null,
  longitude: null,
  seuil_alerte: 80,
};

// Contenu de l'onglet "Agences & QR Codes" de la page Gestion des agences.
// N'est monté que pour le CX Manager (le rôle Admin ne gère pas les agences directement).
export default function AdminAgencesContent() {
  const currentUser = useAuthStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<'repertoire' | 'activite'>('repertoire');
  const [agences, setAgences] = useState<Agence[]>([]);
  const [agencesStats, setAgencesStats] = useState<AgenceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Agence | null>(null);
  const [qrModalTarget, setQrModalTarget] = useState<Agence | null>(null);
  const [catModalTarget, setCatModalTarget] = useState<Agence | null>(null);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [newCategorieNom, setNewCategorieNom] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [form, setForm] = useState<AgenceForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [qrHost, setQrHost] = useState<string>(() => {
    const h = window.location.hostname;
    return (h === 'localhost' || h === '127.0.0.1') ? '192.168.1.117' : h;
  });
  const [qrMode, setQrMode] = useState<'render' | 'local'>('render');

  useEffect(() => {
    Promise.all([agencesApi.list(), dashboardApi.siege(30)])
      .then(([agR, siegeR]) => {
        setAgences(agR.data || []);
        if (siegeR.data?.agences) {
          setAgencesStats(siegeR.data.agences);
        }
      })
      .catch((err) => console.error('Erreur chargement agences:', err))
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const openCreate = () => {
    setEditTarget(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (a: Agence) => {
    setEditTarget(a);
    setForm({
      nom: a.nom,
      adresse: a.adresse || '',
      ville: a.ville || '',
      latitude: a.latitude ?? null,
      longitude: a.longitude ?? null,
      seuil_alerte: a.seuil_alerte || 80,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) {
      showToast("Veuillez saisir un nom pour l'agence");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nom: form.nom.trim(),
        adresse: form.adresse ? form.adresse.trim() : null,
        ville: form.ville ? form.ville.trim() : null,
        latitude: form.latitude !== null ? form.latitude : null,
        longitude: form.longitude !== null ? form.longitude : null,
        seuil_alerte: form.seuil_alerte,
      };
      if (editTarget) {
        const r = await agencesApi.update(editTarget.id, payload);
        setAgences((prev) => prev.map((a) => (a.id === editTarget.id ? r.data : a)));
        showToast('Agence modifiée avec succès');
      } else {
        const r = await agencesApi.create(currentUser?.organisation_id || '', payload);
        setAgences((prev) => [...prev, r.data]);
        showToast('Agence créée avec succès (QR Code généré !)');
      }
      setShowModal(false);
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (a: Agence) => {
    try {
      const r = await agencesApi.update(a.id, { active: !a.active });
      setAgences((prev) => prev.map((ag) => (ag.id === a.id ? r.data : ag)));
      showToast(r.data.active ? 'Agence réactivée' : 'Agence désactivée');
    } catch {
      showToast('Erreur lors de la mise à jour');
    }
  };

  const handleDelete = async (a: Agence) => {
    if (!window.confirm(`Supprimer définitivement l'agence "${a.nom}" ? Cette action est irréversible.`)) return;
    try {
      await agencesApi.delete(a.id);
      setAgences((prev) => prev.filter((ag) => ag.id !== a.id));
      showToast('Agence supprimée');
    } catch {
      showToast('Impossible de supprimer cette agence (feedbacks rattachés)');
    }
  };

  const copyQrUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    showToast('Lien du QR Code copié !');
  };

  const openCategories = async (a: Agence) => {
    setCatModalTarget(a);
    setNewCategorieNom('');
    setCatLoading(true);
    try {
      const r = await agencesApi.listCategories(a.id);
      setCategories(r.data || []);
    } catch {
      showToast('Erreur lors du chargement des catégories');
    } finally {
      setCatLoading(false);
    }
  };

  const handleAddCategorie = async () => {
    if (!catModalTarget || !newCategorieNom.trim()) return;
    setCatSaving(true);
    try {
      const r = await agencesApi.createCategorie(catModalTarget.id, { nom: newCategorieNom.trim() });
      setCategories((prev) => [...prev, r.data]);
      setNewCategorieNom('');
      showToast('Catégorie ajoutée');
    } catch (err: any) {
      showToast(err.response?.data?.detail || "Erreur lors de l'ajout de la catégorie");
    } finally {
      setCatSaving(false);
    }
  };

  const handleToggleCategorieActive = async (cat: Categorie) => {
    if (!catModalTarget) return;
    try {
      const r = await agencesApi.updateCategorie(catModalTarget.id, cat.id, { active: !cat.active });
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? r.data : c)));
      showToast(r.data.active ? 'Catégorie réactivée' : 'Catégorie désactivée');
    } catch {
      showToast('Erreur lors de la mise à jour');
    }
  };

  // Fusion des données d'agence avec les statistiques de satisfaction réelles
  const agencesEnrichies = useMemo(() => {
    return agences.map((a) => {
      const stat = agencesStats.find((s) => s.agence_id === a.id);
      return {
        ...a,
        taux_satisfaction: stat ? stat.taux_satisfaction : (a.taux_satisfaction ?? 75),
        nombre_feedbacks: stat ? stat.nombre_feedbacks : 0,
        nombre_negatifs: stat ? stat.nombre_negatifs : 0,
        nombre_suggestions: stat ? stat.nombre_suggestions : 0,
      };
    });
  }, [agences, agencesStats]);

  // Filtrage Répertoire
  const filteredAgences = useMemo(() => {
    return agencesEnrichies.filter((a) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return a.nom.toLowerCase().includes(q) || (a.ville || '').toLowerCase().includes(q) || (a.adresse || '').toLowerCase().includes(q);
    });
  }, [agencesEnrichies, search]);

  const tabsConfig = [
    { id: 'repertoire', label: 'Répertoire', icon: <TargetIcon size={16} />, badge: agences.length },
    { id: 'activite', label: 'Activité', icon: <ClockIcon size={16} /> },
  ];

  if (loading) return <div style={{ padding: '32px', color: '#64748B', fontWeight: 600 }}>Chargement des agences...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 700 }}>
          {toast}
        </div>
      )}

      {/* Barre d'outils de l'onglet (titre + action, sans dupliquer le grand PageHeader de la page parente) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#02302D' }}>
            Agences & Points de Collecte ({agences.length})
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: '#64748B' }}>
            Gestion du parc d'agences physiques, des QR codes et du monitoring réseau
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          style={{
            background: '#3C7730',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '12px',
            padding: '10px 18px',
            fontSize: '0.86rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(60, 119, 48, 0.25)',
          }}
        >
          <PlusIcon size={16} color="#FFFFFF" />
          Nouvelle Agence
        </button>
      </div>

      {/* Navigation par 2 Onglets */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* ── 1. RÉPERTOIRE (Gestion, Création, Modification) ── */}
      {activeTab === 'repertoire' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Recherche */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#FFFFFF', borderRadius: '16px', padding: '12px 18px', border: '1px solid #E2E8F0' }}>
            <SearchIcon size={16} color="#94A3B8" />
            <input
              type="text"
              placeholder="Rechercher une agence par nom, ville ou adresse..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: 'none', outline: 'none', marginLeft: '10px', width: '100%', fontSize: '0.86rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {filteredAgences.map((a) => (
              <div
                key={a.id}
                style={{
                  background: '#FFFFFF',
                  borderRadius: '20px',
                  padding: '20px 22px',
                  border: '1px solid #E8ECE6',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '14px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#02302D' }}>{a.nom}</h4>
                      <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '2px' }}>
                        📍 {a.ville || 'Ville non renseignée'}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: '0.70rem',
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: '9999px',
                        background: a.active !== false ? '#EBF6ED' : '#F1F5F9',
                        color: a.active !== false ? '#3C7730' : '#64748B',
                      }}
                    >
                      {a.active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.80rem', color: '#475569', margin: '10px 0 0' }}>
                    {a.adresse || 'Aucune adresse spécifiée'}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => openEdit(a)}
                      style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(a)}
                      style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600 }}
                    >
                      {a.active !== false ? 'Désactiver' : 'Activer'}
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => openCategories(a)}
                      style={{ background: '#FEF3E2', color: '#B45309', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <TagIcon size={14} />
                      Catégories
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrModalTarget(a)}
                      style={{ background: '#EBF6ED', color: '#3C7730', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <QrCodeIcon size={14} />
                      QR Code
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 2. ACTIVITÉ ── */}
      {activeTab === 'activite' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '24px', border: '1px solid #E8ECE6' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 800, color: '#02302D' }}>
              Journal des Événements et Bornes Réseau
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {agencesEnrichies.map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CheckCircleIcon size={16} color="#3C7730" />
                    <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A' }}>Borne active et connectée : {a.nom}</span>
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#3C7730', fontWeight: 700 }}>En ligne</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal Création / Édition avec Geolocation Leaflet */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '28px', maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.2rem', fontWeight: 800, color: '#02302D' }}>
              {editTarget ? "Modifier l'agence" : 'Créer une nouvelle agence'}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Nom de l'agence *</label>
                <input
                  type="text"
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                  placeholder="Ex: Agence Tunis Bourguiba"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Ville</label>
                <input
                  type="text"
                  value={form.ville}
                  onChange={(e) => setForm({ ...form, ville: e.target.value })}
                  placeholder="Ex: Tunis"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Adresse complète</label>
                <input
                  type="text"
                  value={form.adresse}
                  onChange={(e) => setForm({ ...form, adresse: e.target.value })}
                  placeholder="Ex: Avenue Habib Bourguiba"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Seuil d'alerte satisfaction (%)</label>
                <input
                  type="number"
                  value={form.seuil_alerte}
                  onChange={(e) => setForm({ ...form, seuil_alerte: Number(e.target.value) })}
                  min={1}
                  max={100}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>Géolocalisation</label>
                <AgencyLocationPicker
                  agencyName={form.nom}
                  value={{
                    latitude: form.latitude,
                    longitude: form.longitude,
                    adresse: form.adresse,
                    ville: form.ville,
                  }}
                  onChange={(loc: LocationData) => setForm({ ...form, latitude: loc.latitude, longitude: loc.longitude, adresse: loc.adresse || form.adresse, ville: loc.ville || form.ville })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{ background: '#F1F5F9', border: 'none', borderRadius: '12px', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '12px', padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Catégories de feedback (par agence) */}
      {catModalTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '28px', maxWidth: '440px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800, color: '#02302D' }}>Catégories — {catModalTarget.nom}</h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: '#64748B' }}>
              Ces catégories sont proposées au client sur le formulaire de feedback pour cette agence, à la place du thème deviné par l'IA.
            </p>

            {catLoading ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: '#64748B', fontSize: '0.84rem' }}>Chargement...</div>
            ) : (
              <>
                {categories.length === 0 && (
                  <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '12px', padding: '10px 14px', fontSize: '0.78rem', color: '#92400E', marginBottom: '14px' }}>
                    Aucune catégorie définie. Le formulaire client utilise "Général" par défaut en attendant — ajoutez vos propres catégories ci-dessous.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '9px 14px',
                        background: cat.active ? '#F8FAF8' : '#F8FAFC',
                        border: `1px solid ${cat.active ? '#E2EFE1' : '#E2E8F0'}`,
                        borderRadius: '12px',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span style={{ fontSize: '0.86rem', fontWeight: 700, color: cat.active ? '#0F172A' : '#94A3B8', textDecoration: cat.active ? 'none' : 'line-through' }}>
                          {cat.nom}
                        </span>
                        <span
                          style={{
                            fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', whiteSpace: 'nowrap',
                            background: cat.cree_par_role === 'agency_manager' ? '#EFF6FF' : '#F1F5F9',
                            color: cat.cree_par_role === 'agency_manager' ? '#2563EB' : '#64748B',
                          }}
                        >
                          {cat.cree_par_role === 'agency_manager' ? 'Ajoutée par l’Agency Manager' : 'Ajoutée par le CX Manager'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleCategorieActive(cat)}
                        style={{
                          background: cat.active ? '#FEE2E2' : '#EBF6ED',
                          color: cat.active ? '#DC2626' : '#3C7730',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '5px 10px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {cat.active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={newCategorieNom}
                    onChange={(e) => setNewCategorieNom(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategorie()}
                    placeholder="Ex: Carte SIM, Forfait Internet..."
                    maxLength={100}
                    style={{ flex: 1, padding: '9px 12px', borderRadius: '10px', border: '1px solid #E2E8F0', boxSizing: 'border-box', fontSize: '0.84rem' }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCategorie}
                    disabled={catSaving || !newCategorieNom.trim()}
                    style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '10px', padding: '9px 16px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: catSaving || !newCategorieNom.trim() ? 0.6 : 1 }}
                  >
                    Ajouter
                  </button>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setCatModalTarget(null)}
                style={{ background: '#F1F5F9', border: 'none', borderRadius: '12px', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal QR Code Detail */}
      {qrModalTarget && (() => {
        const effectiveHost = qrHost || window.location.hostname;
        const modalQrUrl = qrMode === 'render'
          ? getFeedbackUrl(qrModalTarget.qr_code_token || qrModalTarget.id)
          : `http://${effectiveHost}:4321/feedback/${qrModalTarget.qr_code_token || qrModalTarget.id}`;

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '28px', maxWidth: '360px', width: '100%', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800, color: '#02302D' }}>{qrModalTarget.nom}</h3>
              <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: '#64748B' }}>Borne de collecte feedback</p>

              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(modalQrUrl)}`}
                alt={`QR Code ${qrModalTarget.nom}`}
                style={{ width: '180px', height: '180px', display: 'block', margin: '0 auto 16px' }}
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => copyQrUrl(modalQrUrl)}
                  style={{ background: '#EBF6ED', color: '#3C7730', border: 'none', borderRadius: '12px', padding: '10px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Copier l'URL
                </button>
                <button
                  type="button"
                  onClick={() => setQrModalTarget(null)}
                  style={{ background: '#F1F5F9', border: 'none', borderRadius: '12px', padding: '10px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
