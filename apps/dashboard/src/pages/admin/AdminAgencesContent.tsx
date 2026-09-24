import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { agencesApi, utilisateursApi } from '../../services/api';
import { getFeedbackUrl } from '../../config';
import { useAuthStore } from '../../stores/authStore';
import type { Agence } from '../../types';
import SectionHeading from '../../components/ui/SectionHeading';
import {
  PlusIcon,
  QrCodeIcon,
  SearchIcon,
  TagIcon,
  UsersIcon,
  XCloseIcon,
} from '../../components/common/Icons';
import { AgencyLocationPicker, LocationData } from '../../components/agency/AgencyLocationPicker';
import CreateAgencyManagerModal, { AgencyManagerLite } from '../../components/admin/CreateAgencyManagerModal';

interface AgenceForm {
  nom: string;
  adresse: string;
  ville: string;
  telephone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  seuil_alerte: number;
}

const emptyForm: AgenceForm = {
  nom: '',
  adresse: '',
  ville: '',
  telephone: '',
  email: '',
  latitude: null,
  longitude: null,
  seuil_alerte: 80,
};

// Répertoire des agences (page Gestion des agences) : liste unique des agences AVEC leur chef d'agence,
// création/modification/suspension des chefs d'agence directement sur chaque carte.
// N'est monté que pour le CX Manager (le rôle Admin ne gère pas les agences directement).
export default function AdminAgencesContent() {
  const currentUser = useAuthStore((s) => s.user);

  const [agences, setAgences] = useState<Agence[]>([]);
  const [managers, setManagers] = useState<AgencyManagerLite[]>([]);
  const [managersIndisponibles, setManagersIndisponibles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // Modale chef d'agence : création (éventuellement agence présélectionnée) ou édition d'un compte existant.
  const [managerModal, setManagerModal] = useState<{ manager?: AgencyManagerLite; defaultAgenceId?: string } | null>(null);
  const [filtreSansManager, setFiltreSansManager] = useState(false);
  const [editTarget, setEditTarget] = useState<Agence | null>(null);
  const [qrModalTarget, setQrModalTarget] = useState<Agence | null>(null);
  const [form, setForm] = useState<AgenceForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [qrHost, setQrHost] = useState<string>(() => {
    const h = window.location.hostname;
    return (h === 'localhost' || h === '127.0.0.1') ? '192.168.1.117' : h;
  });
  const [qrMode, setQrMode] = useState<'render' | 'local'>('render');

  // Comptes Agency Manager du réseau, rapprochés des agences côté client (agence_id, active, email, nom).
  const chargerManagers = () =>
    utilisateursApi
      .list()
      .then((r) => {
        const liste = Array.isArray(r.data) ? r.data : [];
        setManagers(liste.filter((u: { role: string }) => u.role === 'agency_manager'));
        setManagersIndisponibles(false);
      })
      .catch((err) => {
        console.error('Erreur chargement chefs d\'agence:', err);
        setManagersIndisponibles(true);
      });

  useEffect(() => {
    Promise.all([
      agencesApi.list().then((r) => setAgences(r.data || [])),
      chargerManagers(),
    ])
      .catch((err) => console.error('Erreur chargement agences:', err))
      .finally(() => setLoading(false));
  }, []);

  // Fermeture de la modale Nouvelle/Modifier Agence à la touche Échap.
  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal]);

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
      telephone: a.telephone || '',
      email: a.email || '',
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
        telephone: form.telephone ? form.telephone.trim() : null,
        email: form.email ? form.email.trim() : null,
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

  const toggleManagerActive = async (m: AgencyManagerLite) => {
    try {
      await utilisateursApi.update(m.id, { active: !m.active });
      setManagers((prev) => prev.map((x) => (x.id === m.id ? { ...x, active: !x.active } : x)));
      showToast(m.active ? 'Compte suspendu' : 'Compte réactivé');
    } catch {
      showToast('Erreur lors de la modification du compte');
    }
  };

  // Chefs d'agence groupés par agence ; comptes sans agence (invisibles sinon, aucune carte pour les porter).
  const managersParAgence = useMemo(() => {
    const map = new Map<string, AgencyManagerLite[]>();
    managers.forEach((m) => {
      if (!m.agence_id) return;
      map.set(m.agence_id, [...(map.get(m.agence_id) || []), m]);
    });
    return map;
  }, [managers]);
  const managersSansAgence = useMemo(() => managers.filter((m) => !m.agence_id), [managers]);
  const nbSansManager = useMemo(
    () => agences.filter((a) => !(managersParAgence.get(a.id)?.length)).length,
    [agences, managersParAgence]
  );

  // Filtrage Répertoire : recherche sur l'agence (nom, ville, adresse) ET sur ses chefs d'agence (nom, prénom, email).
  const filteredAgences = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agences.filter((a) => {
      const mgrs = managersParAgence.get(a.id) || [];
      if (filtreSansManager && mgrs.length > 0) return false;
      if (!q) return true;
      return (
        a.nom.toLowerCase().includes(q) ||
        (a.ville || '').toLowerCase().includes(q) ||
        (a.adresse || '').toLowerCase().includes(q) ||
        mgrs.some((m) => `${m.prenom} ${m.nom}`.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      );
    });
  }, [agences, managersParAgence, search, filtreSansManager]);

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
            Répertoire des agences ({agences.length})
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: '#64748B' }}>
            Agences, QR codes et chefs d'agence du réseau
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setManagerModal({})}
            style={{
              background: '#FFFFFF',
              color: '#02302D',
              border: '1px solid #D6E8D9',
              borderRadius: '12px',
              padding: '10px 18px',
              fontSize: '0.86rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <UsersIcon size={16} color="#02302D" />
            Ajouter un nouveau chef d'agence
          </button>
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
      </div>

      {managerModal && (
        <CreateAgencyManagerModal
          manager={managerModal.manager}
          defaultAgenceId={managerModal.defaultAgenceId}
          agences={agences}
          onClose={() => setManagerModal(null)}
          onCreated={() => {
            chargerManagers();
            showToast(managerModal.manager ? "Chef d'agence modifié" : "Chef d'agence créé");
          }}
        />
      )}

      {/* ── Répertoire unique : agences + chefs d'agence ── */}
      <section aria-labelledby="repertoire-agences" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div id="repertoire-agences"><SectionHeading>Agences et chefs d'agence</SectionHeading></div>

          {managersIndisponibles && (
            <div role="alert" style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: '12px', padding: '10px 14px', fontSize: '0.82rem', fontWeight: 600 }}>
              Les chefs d'agence n'ont pas pu être chargés : leur section peut être incomplète.
            </div>
          )}

          {/* Chefs d'agence sans agence : sinon invisibles (aucune carte pour les porter) */}
          {managersSansAgence.length > 0 && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '16px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <strong style={{ fontSize: '0.86rem', color: '#92400E' }}>Chefs d'agence sans agence ({managersSansAgence.length})</strong>
              {managersSansAgence.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.84rem', color: '#0F172A', fontWeight: 600 }}>
                    {m.prenom} {m.nom} <span style={{ color: '#64748B', fontWeight: 500 }}>— {m.email}</span>
                    {!m.active && <span style={{ marginLeft: '8px', fontSize: '0.7rem', fontWeight: 800, color: '#64748B' }}>(suspendu)</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setManagerModal({ manager: m })}
                    style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}
                  >
                    Assigner
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Recherche + filtre */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#FFFFFF', borderRadius: '16px', padding: '12px 18px', border: '1px solid #E2E8F0' }}>
            <SearchIcon size={16} color="#94A3B8" />
            <input
              type="text"
              placeholder="Rechercher par agence, ville, adresse ou chef d'agence (nom, email)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher dans le répertoire"
              style={{ border: 'none', outline: 'none', marginLeft: '10px', width: '100%', fontSize: '0.86rem' }}
            />
            <button
              type="button"
              onClick={() => setFiltreSansManager((v) => !v)}
              aria-pressed={filtreSansManager}
              style={{
                flexShrink: 0,
                marginLeft: '10px',
                background: filtreSansManager ? '#02302D' : '#F1F5F9',
                color: filtreSansManager ? '#FFFFFF' : '#334155',
                border: 'none',
                borderRadius: '9999px',
                padding: '6px 14px',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Sans chef d'agence ({nbSansManager})
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {filteredAgences.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center', color: '#64748B', fontWeight: 600, fontSize: '0.88rem' }}>
                Aucune agence ne correspond à votre recherche.
              </div>
            )}
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

                {/* Chef d'agence */}
                <div style={{ paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: '8px' }}>
                    Chef d'agence
                  </div>
                  {(managersParAgence.get(a.id) || []).length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B', fontWeight: 600 }}>Aucun chef d'agence</span>
                      <button
                        type="button"
                        onClick={() => setManagerModal({ defaultAgenceId: a.id })}
                        style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}
                      >
                        Assigner
                      </button>
                    </div>
                  ) : (
                    (managersParAgence.get(a.id) || []).map((m) => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0F172A' }}>{m.prenom} {m.nom}</span>
                            <span
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                padding: '2px 8px',
                                borderRadius: '9999px',
                                background: m.active ? '#EBF6ED' : '#FEE2E2',
                                color: m.active ? '#3C7730' : '#DC2626',
                              }}
                            >
                              {m.active ? 'Actif' : 'Suspendu'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.76rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setManagerModal({ manager: m })}
                            style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700 }}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleManagerActive(m)}
                            style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600 }}
                          >
                            {m.active ? 'Suspendre' : 'Réactiver'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
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
                    <Link
                      to={`/agences/${a.id}/apercu?tab=categories`}
                      style={{ background: '#FEF3E2', color: '#B45309', textDecoration: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <TagIcon size={14} />
                      Catégories
                    </Link>
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
      </section>

      {/* Modal Création / Édition avec Geolocation Leaflet */}
      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{ background: '#FFFFFF', borderRadius: '24px', padding: '28px', maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#02302D' }}>
                {editTarget ? "Modifier l'agence" : 'Créer une nouvelle agence'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Fermer"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
              >
                <XCloseIcon size={18} color="#94A3B8" />
              </button>
            </div>

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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Téléphone</label>
                  <input
                    type="tel"
                    value={form.telephone}
                    onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                    placeholder="Ex: +226 70 00 00 00"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="Ex: agence@orange.bf"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
                  />
                </div>
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
