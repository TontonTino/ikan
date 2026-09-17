import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { organisationsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Organisation } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import { BuildingIcon, PlusIcon, AlertTriangleIcon, DownloadIcon } from '../../components/common/Icons';

export default function AdminOrgsPage() {
  const user = useAuthStore((s) => s.user);

  if (user?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organisation | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [form, setForm] = useState({
    nom: '',
    logo: '',
    secteur_activite: '',
    pays_region: '',
    email_pro: '',
  });

  const loadOrgs = () => {
    organisationsApi
      .list()
      .then((r) => {
        setOrgs(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadOrgs();
  }, []);

  const openCreate = () => {
    setEditingOrg(null);
    setForm({ nom: '', logo: '', secteur_activite: '', pays_region: '', email_pro: '' });
    setErrorMsg('');
    setShowForm(true);
  };

  const openEdit = (org: Organisation) => {
    setEditingOrg(org);
    setForm({
      nom: org.nom || '',
      logo: org.logo || '',
      secteur_activite: org.secteur_activite || org.secteur || '',
      pays_region: org.pays_region || '',
      email_pro: org.email_pro || org.email || '',
    });
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const payload = {
        nom: form.nom,
        logo: form.logo.trim() || null,
        secteur_activite: form.secteur_activite,
        pays_region: form.pays_region,
        email_pro: form.email_pro,
      };

      if (editingOrg) {
        await organisationsApi.update(editingOrg.id, payload);
      } else {
        await organisationsApi.create(payload);
      }

      loadOrgs();
      setShowForm(false);
      setEditingOrg(null);
      setForm({ nom: '', logo: '', secteur_activite: '', pays_region: '', email_pro: '' });
    } catch (err: any) {
      console.error('Erreur API organisation:', err?.response?.data);
      let detail = err?.response?.data?.detail;
      if (Array.isArray(detail)) {
        detail = detail.map((d: any) => `${d.loc ? d.loc.join('.') : ''}: ${d.msg}`).join(', ');
      } else if (typeof detail === 'object') {
        detail = JSON.stringify(detail);
      }
      setErrorMsg(detail || err?.message || "Erreur lors de l'enregistrement de l'organisation.");
    }
  };

  const deleteOrg = async (id: string) => {
    if (!confirm('Supprimer cette organisation ?')) return;
    try {
      await organisationsApi.delete(id);
      setOrgs((prev) => prev.filter((o) => o.id !== id));
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Impossible de supprimer cette organisation.');
    }
  };

  if (loading) {
    return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des organisations...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Page Header Standardisé ── */}
      <PageHeader
        title={`Organisations (${orgs.length})`}
        subtitle="Gestion des entreprises et groupes clients enregistrés sur la plateforme IKAN AI."
        primaryAction={{
          label: showForm ? 'Fermer le formulaire' : 'Nouvelle organisation',
          icon: <PlusIcon size={16} color="#FFFFFF" />,
          onClick: () => {
            if (showForm) {
              setShowForm(false);
              setEditingOrg(null);
            } else {
              openCreate();
            }
          },
        }}
      />

      {/* ── Formulaire Création / Édition ── */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            background: '#FFFFFF',
            borderRadius: '24px',
            padding: '28px',
            border: '1px solid #E8ECE6',
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
            marginBottom: '8px',
          }}
        >
          <h3
            style={{
              marginBottom: '18px',
              fontSize: '1.1rem',
              fontWeight: 800,
              color: '#02302D',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <BuildingIcon size={20} color="#3C7730" />
            {editingOrg ? `Modifier l'organisation : ${editingOrg.nom}` : 'Créer une organisation'}
          </h3>

          {errorMsg && (
            <div
              style={{
                background: '#FEE2E2',
                border: '1px solid #FCA5A5',
                color: '#B91C1C',
                padding: '10px 14px',
                borderRadius: '12px',
                fontSize: '0.86rem',
                marginBottom: '18px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangleIcon size={16} color="#B91C1C" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
                Nom de l'entreprise *
              </label>
              <input
                type="text"
                placeholder="ex: Orange Tunisie"
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                required
                className="saas-input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
                Email professionnel *
              </label>
              <input
                type="email"
                placeholder="ex: contact@orange.tn"
                value={form.email_pro}
                onChange={(e) => setForm({ ...form, email_pro: e.target.value })}
                required
                className="saas-input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
                Secteur d'activité *
              </label>
              <input
                type="text"
                placeholder="ex: Télécommunications, Banque, Hôtellerie..."
                value={form.secteur_activite}
                onChange={(e) => setForm({ ...form, secteur_activite: e.target.value })}
                required
                className="saas-input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
                Pays / Région *
              </label>
              <input
                type="text"
                placeholder="ex: Tunisie / Afrique du Nord"
                value={form.pays_region}
                onChange={(e) => setForm({ ...form, pays_region: e.target.value })}
                required
                className="saas-input"
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
                Logo de l'organisation (URL ou image)
              </label>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="URL du logo ou importez un fichier ->"
                  value={form.logo}
                  onChange={(e) => setForm({ ...form, logo: e.target.value })}
                  className="saas-input"
                  style={{ flex: 1 }}
                />

                <label
                  style={{
                    background: '#F1F5F2',
                    border: '1px solid #E2E8F0',
                    color: '#02302D',
                    padding: '10px 16px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <DownloadIcon size={16} />
                  <span>Importer</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (uploadEvent) => {
                          const img = new Image();
                          img.onload = () => {
                            const canvas = document.createElement('canvas');
                            const MAX_SIZE = 250;
                            let width = img.width;
                            let height = img.height;
                            if (width > height) {
                              if (width > MAX_SIZE) {
                                height = Math.round((height * MAX_SIZE) / width);
                                width = MAX_SIZE;
                              }
                            } else {
                              if (height > MAX_SIZE) {
                                width = Math.round((width * MAX_SIZE) / height);
                                height = MAX_SIZE;
                              }
                            }
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            ctx?.drawImage(img, 0, 0, width, height);
                            const resizedBase64 = canvas.toDataURL('image/png', 0.9);
                            setForm((prev) => ({ ...prev, logo: resizedBase64 }));
                          };
                          img.src = uploadEvent.target?.result as string;
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              {form.logo && (
                <div
                  style={{
                    marginTop: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    background: '#F8FAFB',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    border: '1px solid #E2E8F0',
                  }}
                >
                  <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 600 }}>Aperçu :</span>
                  <img src={form.logo} alt="Aperçu" style={{ height: '32px', maxHeight: '32px', borderRadius: '6px', objectFit: 'contain' }} />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, logo: '' })}
                    style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '0.8rem', marginLeft: 'auto', fontWeight: 700 }}
                  >
                    ✕ Retirer
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingOrg(null);
              }}
              className="btn-secondary"
            >
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              {editingOrg ? 'Mettre à jour' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}

      {/* ── Table des Organisations ── */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '24px',
          border: '1px solid #E8ECE6',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead style={{ background: '#F8FAFB', borderBottom: '1px solid #E8ECE6' }}>
            <tr>
              {['Organisation', "Secteur d'activité", 'Pays / Région', 'Email Pro', 'Statut', 'Actions'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '14px 20px',
                    color: '#64748B',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr
                key={o.id}
                style={{
                  borderBottom: '1px solid #F1F4EE',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFB')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '14px 20px', fontWeight: 700, color: '#02302D' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {o.logo ? (
                      <img
                        src={o.logo}
                        alt={o.nom}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', objectFit: 'contain', background: '#F8FAFC', padding: '2px', border: '1px solid #E2E8F0' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: '#EAF5EC',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          color: '#3C7730',
                        }}
                      >
                        {o.nom.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span>{o.nom}</span>
                  </div>
                </td>
                <td style={{ padding: '14px 20px', color: '#475569' }}>{o.secteur_activite || o.secteur || '—'}</td>
                <td style={{ padding: '14px 20px', color: '#475569' }}>{o.pays_region || '—'}</td>
                <td style={{ padding: '14px 20px', fontWeight: 500, color: '#1E293B' }}>{o.email_pro || o.email}</td>
                <td style={{ padding: '14px 20px' }}>
                  <span className={`badge ${o.active ? 'badge-success' : 'badge-neutral'}`}>
                    {o.active ? 'Actif' : 'Inactif'}
                  </span>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={() => openEdit(o)}
                      style={{
                        background: '#FFFFFF',
                        color: '#02302D',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        fontFamily: 'inherit',
                      }}
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => deleteOrg(o.id)}
                      style={{
                        background: '#FFFFFF',
                        color: '#DC2626',
                        border: '1px solid #FEE2E2',
                        borderRadius: '8px',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#FEE2E2')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
