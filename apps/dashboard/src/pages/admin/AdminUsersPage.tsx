import React, { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { utilisateursApi, agencesApi, organisationsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/ui/PageHeader';
import TabsNavigation from '../../components/ui/TabsNavigation';
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
  agency_manager: "Chef d'Agence",
};

const ROLE_BADGES: Record<string, { bg: string; text: string; border: string }> = {
  admin: { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  cx_manager: { bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD' },
  agency_manager: { bg: '#EBF5E9', text: '#3C7730', border: '#D5E8D3' },
};

export default function AdminUsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isCXManager = currentUser?.role === 'cx_manager';
  const isAdmin = currentUser?.role === 'admin';

  if (currentUser?.role === 'agency_manager') {
    return <Navigate to="/agence" replace />;
  }

  const [activeTab, setActiveTab] = useState<'equipe' | 'activite'>('equipe');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [agences, setAgences] = useState<{ id: string; nom: string }[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; nom: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');

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
        if (o.data.length > 0) {
          setForm((prev) => ({
            ...prev,
            organisation_id: o.data[0].id,
            role: isAdmin ? 'cx_manager' : 'agency_manager',
          }));
        }
      })
      .finally(() => setLoading(false));
  }, [currentUser, isCXManager, isAdmin]);

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
      organisation_id: orgs[0]?.id || '',
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
      organisation_id: u.organisation_id || (orgs[0]?.id || ''),
      agence_id: u.agence_id || '',
    });
    setShowForm(true);
  };

  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nom || !form.prenom || !form.email) return;
    if (!editingUser && !form.password) return;

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
      if (isAdmin && form.organisation_id) payload.organisation_id = form.organisation_id;

      if (editingUser) {
        await utilisateursApi.update(editingUser.id, payload);
        showToast(isAdmin ? 'CX Manager modifié' : 'Utilisateur modifié');
      } else {
        await utilisateursApi.create(payload);
        showToast(isAdmin ? 'CX Manager créé' : "Chef d'agence créé");
      }

      const r = await utilisateursApi.list();
      setUsers(r.data);
      setShowForm(false);
      setEditingUser(null);
    } catch (err: any) {
      showToast(err.response?.data?.detail || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const toggleUserActive = async (u: UserRow) => {
    try {
      await utilisateursApi.update(u.id, { active: !u.active });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? { ...item, active: !item.active } : item)));
      showToast(u.active ? 'Compte suspendu' : 'Compte réactivé');
    } catch {
      showToast('Erreur lors de la modification');
    }
  };

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
    { id: 'equipe', label: 'Équipe & Accès', icon: <UsersIcon size={16} />, badge: displayedUsers.length },
    { id: 'activite', label: 'Activité & Prises en charge', icon: <ClockIcon size={16} /> },
  ];

  if (loading) return <div style={{ padding: '32px', color: '#64748B', fontWeight: 600 }}>Chargement des utilisateurs...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 700 }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <PageHeader
        title={isAdmin ? `CX Managers (${displayedUsers.length})` : `Chefs d'Agence (${displayedUsers.length})`}
        subtitle={isAdmin ? 'Gérez les accès et les comptes des responsables CX.' : 'Gérez les comptes des responsables d’agences du réseau.'}
        primaryAction={{
          label: showForm ? 'Fermer' : (isAdmin ? 'Nouveau CX Manager' : "Nouveau Chef d'Agence"),
          icon: <PlusIcon size={16} color="#FFFFFF" />,
          onClick: () => {
            if (showForm) {
              setShowForm(false);
              setEditingUser(null);
            } else {
              openCreate();
            }
          },
        }}
      />

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
            {editingUser ? "Modifier l'utilisateur" : (isAdmin ? 'Créer un CX Manager' : "Créer un Chef d'Agence")}
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
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>Email professionnel *</label>
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
            </div>

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
                style={{ background: '#F1F5F9', border: 'none', borderRadius: '12px', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '12px', padding: '10px 22px', fontWeight: 700, cursor: 'pointer' }}
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
              placeholder="Rechercher par nom, prénom ou email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: 'none', outline: 'none', marginLeft: '10px', width: '100%', fontSize: '0.86rem' }}
            />
          </div>

          <div style={{ background: '#FFFFFF', borderRadius: '20px', border: '1px solid #E8ECE6', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E8ECE6', background: '#F8FAFB' }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>Utilisateur</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase' }}>Rôle</th>
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
                            style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '6px 10px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleUserActive(u)}
                            style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '6px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
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
        </div>
      )}

      {/* ── 2. ONGLET ACTIVITÉ ── */}
      {activeTab === 'activite' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '24px', border: '1px solid #E8ECE6' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '1rem', fontWeight: 800, color: '#02302D' }}>
              Activité des Gestionnaires et Prises en Charge
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {displayedUsers.map((u) => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#F8FAFC', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CheckCircleIcon size={16} color="#3C7730" />
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#02302D' }}>{u.prenom} {u.nom}</strong>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Dernière action : Traitement des retours clients</div>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#3C7730', fontWeight: 700 }}>Connecté récemment</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
