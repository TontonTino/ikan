import React, { useEffect, useState, useMemo } from 'react';
import { utilisateursApi, agencesApi, organisationsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import TabsNavigation from '../../components/ui/TabsNavigation';
import CreateAgencyManagerModal from '../../components/admin/CreateAgencyManagerModal';
import ConfirmActionModal from '../../components/admin/ConfirmActionModal';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import {
  UsersIcon,
  PlusIcon,
  EditIcon,
  TrashIcon,
  CheckCircleIcon,
  ClockIcon,
  SearchIcon,
  MessageSquareIcon,
  AlertTriangleIcon,
} from '../../components/common/Icons';
import { userFacingError } from '../../utils/userFacingError';

type UserRow = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  active: boolean;
  organisation_id?: string;
  agence_id?: string;
  created_at?: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  cx_manager: 'CX Manager (Siège)',
  agency_manager: "Responsable d’agence",
};

const ROLE_BADGES: Record<string, { bg: string; text: string; border: string }> = {
  admin: { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  cx_manager: { bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD' },
  agency_manager: { bg: '#EBF5E9', text: '#3C7730', border: '#D5E8D3' },
};

// Contenu de l'onglet "Utilisateurs" de la page Gestion des agences.
// Adapté selon le rôle : CX Manager gère les Agency Managers, Admin gère les CX Managers.
export default function AdminUsersContent() {
  const currentUser = useAuthStore((s) => s.user);
  const isCXManager = currentUser?.role === 'cx_manager';
  const isAdmin = currentUser?.role === 'admin';

  const [activeTab, setActiveTab] = useState<'equipe' | 'activite'>('equipe');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [agences, setAgences] = useState<{ id: string; nom: string }[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; nom: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCreateAgencyManager, setShowCreateAgencyManager] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [erreurChargement, setErreurChargement] = useState('');
  const [rechargement, setRechargement] = useState(0);
  const [aSuspendre, setASuspendre] = useState<UserRow | null>(null);
  const [suspensionEnCours, setSuspensionEnCours] = useState(false);
  const [erreurSuspension, setErreurSuspension] = useState('');

  const [form, setForm] = useState({
    nom: '',
    prenom: '',
    email: '',
    password: '',
    role: isAdmin ? 'cx_manager' : 'agency_manager',
    organisation_id: '',
    agence_id: '',
  });

  useEffect(() => {
    setLoading(true);
    setErreurChargement('');
    const promises: Promise<any>[] = [utilisateursApi.list()];
    if (isCXManager) promises.push(agencesApi.list());
    else promises.push(Promise.resolve({ data: [] }));

    if (isAdmin) promises.push(organisationsApi.list());
    else promises.push(Promise.resolve({ data: [] }));

    Promise.all(promises)
      .then(([u, a, o]) => {
        setUsers(u.data);
        setAgences(a.data);
        setOrgs(o.data);
      })
      .catch((err) => {
        console.error('Erreur chargement des comptes:', err);
        setErreurChargement(userFacingError(err, 'Impossible de charger les comptes. Veuillez réessayer.'));
      })
      .finally(() => setLoading(false));
  }, [currentUser, isCXManager, isAdmin, rechargement]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({
      nom: '',
      prenom: '',
      email: '',
      password: '',
      role: isAdmin ? 'cx_manager' : 'agency_manager',
      organisation_id: '',
      agence_id: '',
    });
    setShowForm(true);
  };

  const openEdit = (u: UserRow) => {
    setEditingUser(u);
    setForm({
      nom: u.nom,
      prenom: u.prenom,
      email: u.email,
      password: '',
      role: u.role,
      organisation_id: u.organisation_id || '',
      agence_id: u.agence_id || '',
    });
    setShowForm(true);
  };

  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nom || !form.prenom || !form.email) return;
    if (!editingUser && !form.password) return;
    if (isAdmin && !editingUser && !form.organisation_id) {
      showToast('Choisissez l’organisation de ce CX Manager.');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        nom: form.nom,
        prenom: form.prenom,
        email: form.email,
        role: form.role,
      };
      if (form.password) payload.password = form.password;
      if (isCXManager) payload.agence_id = form.agence_id || null;
      // L'organisation se choisit à la création uniquement ; elle n'est jamais modifiable ensuite.
      if (isAdmin && !editingUser) payload.organisation_id = form.organisation_id;

      if (editingUser) {
        await utilisateursApi.update(editingUser.id, payload);
        showToast(isAdmin ? 'CX Manager modifié' : 'Utilisateur modifié');
      } else {
        await utilisateursApi.create(payload);
        showToast(isAdmin ? 'CX Manager créé' : "Responsable d’agence créé");
      }

      const r = await utilisateursApi.list();
      setUsers(r.data);
      setShowForm(false);
      setEditingUser(null);
    } catch (err: any) {
      showToast(userFacingError(err, "Impossible d’enregistrer. Vérifiez les informations puis réessayez."));
    } finally {
      setSaving(false);
    }
  };

  // Suspension : confirmée au préalable (le compte perd l'accès). Réactivation : directe.
  const changerStatutCompte = async (u: UserRow, active: boolean) => {
    try {
      await utilisateursApi.update(u.id, { active });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? { ...item, active } : item)));
      showToast(active ? 'Compte réactivé' : 'Compte suspendu');
      return true;
    } catch (err) {
      console.error('Erreur changement de statut du compte:', err);
      return userFacingError(err, active ? 'Impossible de réactiver ce compte. Veuillez réessayer.' : 'Impossible de suspendre ce compte. Veuillez réessayer.');
    }
  };

  const toggleUserActive = async (u: UserRow) => {
    if (u.active !== false) {
      setErreurSuspension('');
      setASuspendre(u);
      return;
    }
    const resultat = await changerStatutCompte(u, true);
    if (resultat !== true) showToast(resultat);
  };

  const confirmerSuspension = async () => {
    if (!aSuspendre) return;
    setSuspensionEnCours(true);
    setErreurSuspension('');
    const resultat = await changerStatutCompte(aSuspendre, false);
    setSuspensionEnCours(false);
    if (resultat === true) setASuspendre(null);
    else setErreurSuspension(resultat);
  };

  const nomOrganisation = (id?: string) => orgs.find((o) => o.id === id)?.nom;
  const nomAgence = (id?: string) => agences.find((a) => a.id === id)?.nom;

  const displayedUsers = useMemo(() => {
    return users
      .filter((u) => {
        if (isAdmin) return u.role === 'cx_manager';
        if (isCXManager) return u.role === 'agency_manager';
        return false;
      })
      .filter((u) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return u.nom.toLowerCase().includes(q) || u.prenom.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      });
  }, [users, isAdmin, isCXManager, search]);

  const tabsConfig = [
    { id: 'equipe', label: 'Équipe et accès', icon: <UsersIcon size={16} />, badge: displayedUsers.length },
    { id: 'activite', label: 'Activité', icon: <ClockIcon size={16} /> },
  ];

  if (loading) return <div style={{ padding: '32px', color: '#64748B', fontWeight: 600 }}>Chargement des utilisateurs…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div role="status" style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 700 }}>
          {toast}
        </div>
      )}

      {/* Barre d'outils de l'onglet (titre + action, sans dupliquer le grand PageHeader de la page parente) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#02302D' }}>
            {isAdmin ? `CX Managers (${displayedUsers.length})` : `Responsables d’agence (${displayedUsers.length})`}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: '#64748B' }}>
            {isAdmin ? 'Gérez les accès et les comptes des responsables CX.' : 'Gérez les comptes des responsables d’agences du réseau.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (isCXManager) {
              // Création d'un Chef d'Agence : modale partagée avec le bouton équivalent
              // de l'onglet "Agences & QR Codes" (voir AdminAgencesContent.tsx).
              setShowCreateAgencyManager(true);
            } else if (showForm) {
              setShowForm(false);
              setEditingUser(null);
            } else {
              openCreate();
            }
          }}
          className="btn-primary"
          style={{
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
          <PlusIcon size={16} />
          {isCXManager ? "Nouveau responsable d’agence" : (showForm ? 'Fermer' : 'Nouveau CX Manager')}
        </button>
      </div>

      {showCreateAgencyManager && (
        <CreateAgencyManagerModal
          onClose={() => setShowCreateAgencyManager(false)}
          onCreated={() => {
            utilisateursApi.list().then((r) => setUsers(r.data));
            showToast("Responsable d’agence créé");
          }}
        />
      )}

      {/* Navigation par Onglets */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* Formulaire Modal / Drawer */}
      {showForm && (
        <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '24px 28px', border: '1px solid #D6E8D9', boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 800, color: '#02302D' }}>
            {editingUser ? "Modifier l'utilisateur" : (isAdmin ? 'Créer un CX Manager' : "Créer un responsable d’agence")}
          </h3>

          <form onSubmit={saveUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Prénom *</label>
              <input
                type="text"
                required
                value={form.prenom}
                onChange={(e) => setForm({ ...form, prenom: e.target.value })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Nom *</label>
              <input
                type="text"
                required
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>E-mail professionnel *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>
                {editingUser ? 'Nouveau mot de passe (laisser vide si inchangé)' : 'Mot de passe initial *'}
              </label>
              <input
                type="password"
                required={!editingUser}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' }}
              />
              <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: '#64748B' }}>
                {editingUser
                  ? 'Remplace tout de suite le mot de passe actuel. Transmettez-le à la personne : il n’est pas envoyé par e-mail.'
                  : 'Transmettez ce mot de passe à la personne : il n’est pas envoyé par e-mail.'}
              </p>
            </div>

            {isAdmin && (
              <div>
                <label htmlFor="user-org" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Organisation *</label>
                <select
                  id="user-org"
                  required
                  disabled={!!editingUser}
                  value={form.organisation_id}
                  onChange={(e) => setForm({ ...form, organisation_id: e.target.value })}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box', background: '#FFFFFF', minHeight: 44 }}
                >
                  <option value="">{editingUser ? (nomOrganisation(editingUser.organisation_id) || 'Organisation non renseignée') : 'Choisir une organisation'}</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.nom}</option>
                  ))}
                </select>
                <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: '#64748B' }}>
                  {editingUser
                    ? 'L’organisation d’un compte ne peut pas être modifiée.'
                    : orgs.length === 0
                      ? 'Aucune organisation disponible : créez-en une avant d’ajouter un CX Manager.'
                      : 'Le CX Manager ne verra que les données de cette organisation.'}
                </p>
              </div>
            )}

            {isCXManager && (
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Agence rattachée</label>
                <select
                  value={form.agence_id}
                  onChange={(e) => setForm({ ...form, agence_id: e.target.value })}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box', background: '#FFFFFF' }}
                >
                  <option value="">Aucune agence</option>
                  {agences.map((ag) => (
                    <option key={ag.id} value={ag.id}>{ag.nom}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingUser(null); }}
                className="btn-secondary"
                style={{ padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary"
                style={{ padding: '10px 22px', fontWeight: 700, cursor: 'pointer' }}
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── 1. ONGLET ÉQUIPE ── */}
      {activeTab === 'equipe' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Recherche */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#FFFFFF', borderRadius: '16px', padding: '12px 18px', border: '1px solid #E2E8F0' }}>
            <SearchIcon size={16} color="#94A3B8" />
            <input
              type="text"
              placeholder="Rechercher par nom, prénom ou e-mail…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: 'none', marginLeft: '10px', width: '100%', fontSize: '0.86rem' }}
            />
          </div>

          {erreurChargement ? (
            <Alert
              tone="critical"
              title={erreurChargement}
              action={<Button size="sm" variant="secondary" onClick={() => setRechargement((n) => n + 1)}>Réessayer</Button>}
            >
              Cela ne signifie pas qu’aucun compte n’existe.
            </Alert>
          ) : displayedUsers.length === 0 ? (
            <div style={{ background: '#FFFFFF', borderRadius: '20px', border: '1px solid #E8ECE6', padding: '32px 24px', textAlign: 'center', color: '#64748B', fontSize: '0.88rem' }}>
              {search.trim() ? (
                <>
                  <p style={{ margin: '0 0 12px' }}>Aucun compte ne correspond à « {search.trim()} ».</p>
                  <Button variant="secondary" onClick={() => setSearch('')}>Effacer la recherche</Button>
                </>
              ) : (
                <p style={{ margin: 0 }}>{isAdmin ? 'Aucun CX Manager pour le moment.' : 'Aucun responsable d’agence pour le moment.'}</p>
              )}
            </div>
          ) : (
          <div style={{ background: '#FFFFFF', borderRadius: '20px', border: '1px solid #E8ECE6', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E8ECE6', background: '#F8FAFB' }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>Utilisateur</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>E-mail</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>Rôle</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>{isAdmin ? 'Organisation' : 'Agence'}</th>
                  <th style={{ textAlign: 'center', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>Statut</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedUsers.map((u) => {
                  const rBadge = ROLE_BADGES[u.role] || { bg: '#F1F5F9', text: '#64748B', border: '#E2E8F0' };
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #F1F4EE' }}>
                      <td style={{ padding: '14px 16px', fontWeight: 700, color: '#02302D' }}>
                        {u.prenom} {u.nom}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#64748B' }}>{u.email}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ background: rBadge.bg, color: rBadge.text, padding: '3px 10px', borderRadius: '9999px', fontSize: '0.74rem', fontWeight: 700 }}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#64748B' }}>
                        {isAdmin ? (nomOrganisation(u.organisation_id) || 'Non renseignée') : (nomAgence(u.agence_id) || 'Aucune agence')}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span style={{ background: u.active !== false ? '#EBF6ED' : '#FEE2E2', color: u.active !== false ? '#3C7730' : '#DC2626', padding: '3px 10px', borderRadius: '9999px', fontSize: '0.74rem', fontWeight: 800 }}>
                          {u.active !== false ? 'Actif' : 'Suspendu'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleUserActive(u)}
                            className="btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            {u.active !== false ? 'Suspendre' : 'Activer'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {aSuspendre && (
        <ConfirmActionModal
          title="Suspendre ce compte ?"
          subject={`${aSuspendre.prenom} ${aSuspendre.nom} · ${aSuspendre.email}`}
          confirmLabel="Suspendre le compte"
          busy={suspensionEnCours}
          error={erreurSuspension}
          onConfirm={confirmerSuspension}
          onCancel={() => setASuspendre(null)}
        >
          <p style={{ margin: 0 }}>
            Cette personne n’aura plus accès à IKAN AI tant que son compte est suspendu. Ses données sont conservées
            et vous pourrez réactiver le compte à tout moment.
          </p>
        </ConfirmActionModal>
      )}

      {/* ── 2. ONGLET ACTIVITÉ ── */}
      {activeTab === 'activite' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '24px', border: '1px solid #E8ECE6' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 800, color: '#02302D' }}>
              Activité des utilisateurs
            </h3>
            {/* Aucune donnée d'activité (dernière connexion, dernière action) n'est exposée par
                GET /utilisateurs/ : on ne l'invente pas. */}
            <p style={{ margin: 0, fontSize: '0.86rem', color: '#64748B', lineHeight: 1.5 }}>
              L’historique d’activité des utilisateurs (connexions, avis pris en charge) n’est pas encore disponible.
              Le suivi des avis se fait aujourd’hui depuis la page Avis clients.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
