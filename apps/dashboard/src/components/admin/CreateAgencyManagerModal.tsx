import React, { useEffect, useState } from 'react';
import { agencesApi, utilisateursApi } from '../../services/api';
import { XCloseIcon } from '../common/Icons';

interface CreateAgencyManagerModalProps {
  onClose: () => void;
  /** Appelé juste après une création réussie (avant onClose), pour que l'appelant rafraîchisse sa propre liste si besoin. */
  onCreated: () => void;
}

/**
 * Modale de création d'un Chef d'Agence (agency_manager), réutilisée par
 * AdminUsersContent.tsx (onglet "Agency Managers") ET AdminAgencesContent.tsx
 * (onglet "Agences & QR Codes", bouton "Ajouter un nouveau chef d'agence") —
 * même formulaire, même appel API, pour ne pas dupliquer la logique de
 * création entre les deux emplacements.
 */
export default function CreateAgencyManagerModal({ onClose, onCreated }: CreateAgencyManagerModalProps) {
  const [agences, setAgences] = useState<{ id: string; nom: string }[]>([]);
  const [form, setForm] = useState({ nom: '', prenom: '', email: '', password: '', agence_id: '' });
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let annule = false;
    agencesApi
      .list()
      .then((r) => {
        if (!annule) setAgences(r.data || []);
      })
      .catch(() => {
        if (!annule) setAgences([]);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Fermeture à la touche Échap (le composant n'est monté que pendant que la modale est ouverte).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nom.trim() || !form.prenom.trim() || !form.email.trim() || !form.password) return;
    setErreur('');
    setSaving(true);
    try {
      await utilisateursApi.create({
        nom: form.nom.trim(),
        prenom: form.prenom.trim(),
        email: form.email.trim(),
        password: form.password,
        role: 'agency_manager',
        agence_id: form.agence_id || null,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setErreur(err?.response?.data?.detail || 'Erreur lors de la création du chef d’agence.');
    } finally {
      setSaving(false);
    }
  };

  const labelStyle: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', boxSizing: 'border-box' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#FFFFFF', borderRadius: '24px', padding: '28px', maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#02302D' }}>Créer un Chef d'Agence</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
          >
            <XCloseIcon size={18} color="#94A3B8" />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Prénom *</label>
            <input type="text" required value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Nom *</label>
            <input type="text" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Email professionnel *</label>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Mot de passe initial *</label>
            <input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Agence rattachée</label>
            <select
              value={form.agence_id}
              onChange={(e) => setForm({ ...form, agence_id: e.target.value })}
              style={{ ...inputStyle, background: '#FFFFFF' }}
            >
              <option value="">Aucune agence</option>
              {agences.map((ag) => (
                <option key={ag.id} value={ag.id}>{ag.nom}</option>
              ))}
            </select>
          </div>

          {erreur && (
            <div style={{ gridColumn: '1 / -1', color: '#B91C1C', fontSize: '0.82rem', fontWeight: 600 }}>{erreur}</div>
          )}

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ background: '#F1F5F9', border: 'none', borderRadius: '12px', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '12px', padding: '10px 22px', fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
