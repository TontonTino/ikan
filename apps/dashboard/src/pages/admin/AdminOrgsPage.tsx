import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { organisationsApi, secteursApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Organisation, SecteurInfo } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import { BuildingIcon, PlusIcon, AlertTriangleIcon, DownloadIcon } from '../../components/common/Icons';
import { userFacingError } from '../../utils/userFacingError';
import ConfirmActionModal from '../../components/admin/ConfirmActionModal';

// Contrôle d'accès séparé du contenu : les hooks du contenu ne sont jamais appelés après un retour anticipé.
export default function AdminOrgsPage() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }
  return <AdminOrgsPageContenu />;
}

function AdminOrgsPageContenu() {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [secteurs, setSecteurs] = useState<SecteurInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organisation | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [erreurChargement, setErreurChargement] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const [succes, setSucces] = useState('');
  const [secteursIndisponibles, setSecteursIndisponibles] = useState(false);
  const [aSupprimer, setASupprimer] = useState<Organisation | null>(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState('');
  const [form, setForm] = useState({
    nom: '',
    logo: '',
    secteur_code: '',
    pays_region: '',
    email_pro: '',
  });

  const loadOrgs = () => {
    setErreurChargement('');
    organisationsApi
      .list()
      .then((r) => {
        setOrgs(r.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Erreur chargement organisations:', err);
        setErreurChargement(userFacingError(err, 'Impossible de charger les organisations. Veuillez réessayer.'));
        setLoading(false);
      });
  };

  useEffect(() => {
    loadOrgs();
    // Liste code/libellé des secteurs — source unique pour ce select (GET /secteurs).
    secteursApi.list().then((r) => setSecteurs(r.data)).catch((err) => {
      console.error('Erreur chargement des secteurs:', err);
      setSecteurs([]);
      setSecteursIndisponibles(true);
    });
  }, []);

  const openCreate = () => {
    setEditingOrg(null);
    setForm({ nom: '', logo: '', secteur_code: '', pays_region: '', email_pro: '' });
    setErrorMsg('');
    setSucces('');
    setShowForm(true);
  };

  const openEdit = (org: Organisation) => {
    setEditingOrg(org);
    setForm({
      nom: org.nom || '',
      logo: org.logo || '',
      secteur_code: org.secteur_code || '',
      pays_region: org.pays_region || '',
      email_pro: org.email_pro || org.email || '',
    });
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSucces('');
    setEnregistrement(true);
    try {
      const payload = {
        nom: form.nom,
        logo: form.logo.trim() || null,
        secteur_code: form.secteur_code,
        pays_region: form.pays_region,
        email_pro: form.email_pro,
      };

      if (editingOrg) {
        await organisationsApi.update(editingOrg.id, payload);
        setSucces(`L’organisation « ${payload.nom} » a été mise à jour.`);
      } else {
        await organisationsApi.create(payload);
        setSucces(`L’organisation « ${payload.nom} » a été créée.`);
      }

      loadOrgs();
      setShowForm(false);
      setEditingOrg(null);
      setForm({ nom: '', logo: '', secteur_code: '', pays_region: '', email_pro: '' });
    } catch (err: any) {
      console.error('Erreur API organisation:', err?.response?.data);
      // 400 = seul cas renvoyé par POST/PATCH /organisations : e-mail professionnel déjà utilisé.
      setErrorMsg(userFacingError(err, "Impossible d’enregistrer l’organisation. Veuillez réessayer.", undefined, {
        400: 'Cette adresse e-mail professionnelle est déjà utilisée par une autre organisation.',
      }));
    } finally {
      setEnregistrement(false);
    }
  };

  const confirmerSuppression = async () => {
    if (!aSupprimer) return;
    setSuppressionEnCours(true);
    setErreurSuppression('');
    try {
      await organisationsApi.delete(aSupprimer.id);
      setOrgs((prev) => prev.filter((o) => o.id !== aSupprimer.id));
      setASupprimer(null);
    } catch (err: any) {
      console.error('Erreur suppression organisation:', err?.response?.data);
      setErreurSuppression(userFacingError(err, 'Impossible de supprimer cette organisation. Veuillez réessayer.', undefined, {
        404: 'Cette organisation est introuvable, ou vous n’avez pas le droit de la supprimer.',
      }));
    } finally {
      setSuppressionEnCours(false);
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

      {erreurChargement && (
        <div role="alert" style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '10px 14px', borderRadius: '12px', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 240px' }}>{erreurChargement} Cela ne signifie pas qu’aucune organisation n’existe.</span>
          <button type="button" className="btn-secondary" onClick={loadOrgs}>Réessayer</button>
        </div>
      )}

      {succes && (
        <div role="status" style={{ background: '#EAF5EC', border: '1px solid #CFE3D3', color: '#2F5D26', padding: '10px 14px', borderRadius: '12px', fontSize: '0.86rem', fontWeight: 700 }}>
          {succes}
        </div>
      )}

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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
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
                E-mail professionnel *
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
              <select
                value={form.secteur_code}
                onChange={(e) => setForm({ ...form, secteur_code: e.target.value })}
                required
                className="saas-input"
              >
                <option value="">
                  {secteursIndisponibles ? 'Liste indisponible — rechargez la page' : secteurs.length === 0 ? 'Chargement…' : 'Choisir un secteur'}
                </option>
                {secteurs.map((s) => (
                  <option key={s.code} value={s.code}>{s.libelle}</option>
                ))}
              </select>
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
                  className="btn-secondary"
                  style={{
                    padding: '10px 16px',
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
            <button type="submit" className="btn-primary" disabled={enregistrement} aria-busy={enregistrement}>
              {enregistrement ? 'Enregistrement…' : editingOrg ? 'Mettre à jour' : 'Enregistrer'}
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
        <div style={{ width: '100%', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead style={{ background: '#F8FAFB', borderBottom: '1px solid #E8ECE6' }}>
            <tr>
              {['Organisation', "Secteur d'activité", 'Pays / Région', 'E-mail professionnel', 'Statut', 'Actions'].map((h) => (
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
            {orgs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '28px 20px', color: '#64748B', textAlign: 'center' }}>
                  {erreurChargement ? 'Liste non chargée.' : 'Aucune organisation pour le moment. Créez la première avec « Nouvelle organisation ».'}
                </td>
              </tr>
            )}
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
                <td style={{ padding: '14px 20px', color: '#475569' }}>{o.secteur_libelle || o.secteur_activite || o.secteur || '—'}</td>
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
                      className="btn-secondary"
                      style={{
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
                      onClick={() => { setErreurSuppression(''); setASupprimer(o); }}
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

      {aSupprimer && (
        <ConfirmActionModal
          title="Supprimer cette organisation ?"
          subject={aSupprimer.nom}
          confirmLabel="Supprimer définitivement"
          requireText={aSupprimer.nom}
          busy={suppressionEnCours}
          error={erreurSuppression}
          onConfirm={confirmerSuppression}
          onCancel={() => setASupprimer(null)}
        >
          <p style={{ margin: 0 }}>
            Cette suppression est <strong>définitive</strong> et supprime aussi tout ce qui dépend de cette organisation :
            ses agences et QR codes, ses comptes utilisateurs et les avis clients collectés.
          </p>
        </ConfirmActionModal>
      )}
    </div>
  );
}
