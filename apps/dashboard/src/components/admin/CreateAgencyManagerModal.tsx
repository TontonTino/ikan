import React, { useEffect, useState } from 'react';
import { agencesApi, utilisateursApi } from '../../services/api';
import { XCloseIcon } from '../common/Icons';

/** Compte Agency Manager tel que renvoyé par GET /utilisateurs/ (champs utiles à l'UI). */
export interface AgencyManagerLite {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  active: boolean;
  agence_id?: string | null;
}

interface CreateAgencyManagerModalProps {
  onClose: () => void;
  /** Appelé juste après une création OU une modification réussie (avant onClose), pour que l'appelant rafraîchisse sa liste. */
  onCreated: () => void;
  /** Si fourni : mode édition de ce compte (champs préremplis, mot de passe facultatif). Sinon : création. */
  manager?: AgencyManagerLite | null;
  /** Création : agence présélectionnée (ex. bouton « Assigner » d'une carte d'agence). */
  defaultAgenceId?: string;
  /** Liste d'agences déjà chargée par l'appelant : évite un nouveau fetch et le flash « Aucune agence » à l'ouverture. */
  agences?: { id: string; nom: string }[];
}

/**
 * Modale de création / modification d'un Chef d'Agence (agency_manager), utilisée par le Répertoire
 * des agences (AdminAgencesContent.tsx) et, pour la création, par AdminUsersContent.tsx.
 * Une seule implémentation du formulaire : mêmes champs, mêmes validations, mêmes appels API.
 */
export default function CreateAgencyManagerModal({ onClose, onCreated, manager, defaultAgenceId, agences: agencesFournies }: CreateAgencyManagerModalProps) {
  const enEdition = !!manager;
  const [agences, setAgences] = useState<{ id: string; nom: string }[]>(agencesFournies ?? []);
  const [form, setForm] = useState({
    nom: manager?.nom ?? '',
    prenom: manager?.prenom ?? '',
    email: manager?.email ?? '',
    password: '',
    agence_id: manager ? manager.agence_id ?? '' : defaultAgenceId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (agencesFournies) return;
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
    if (!form.nom.trim() || !form.prenom.trim() || !form.email.trim()) return;
    if (!enEdition && !form.password) return;
    setErreur('');
    setSaving(true);
    try {
      if (manager) {
        // Édition : seuls les champs modifiés sont envoyés (le mot de passe n'est envoyé que s'il est saisi).
        const updates: Record<string, unknown> = {};
        if (form.nom.trim() !== manager.nom) updates.nom = form.nom.trim();
        if (form.prenom.trim() !== manager.prenom) updates.prenom = form.prenom.trim();
        if (form.email.trim() !== manager.email) updates.email = form.email.trim();
        if ((form.agence_id || null) !== (manager.agence_id ?? null)) updates.agence_id = form.agence_id || null;
        if (form.password) updates.password = form.password;
        if (Object.keys(updates).length > 0) {
          await utilisateursApi.update(manager.id, updates);
        }
      } else {
        await utilisateursApi.create({
          nom: form.nom.trim(),
          prenom: form.prenom.trim(),
          email: form.email.trim(),
          password: form.password,
          role: 'agency_manager',
          agence_id: form.agence_id || null,
        });
      }
      onCreated();
      onClose();
    } catch (err: any) {
      setErreur(err?.response?.data?.detail || (enEdition ? 'Erreur lors de la modification du chef d’agence.' : 'Erreur lors de la création du chef d’agence.'));
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
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#02302D' }}>
            {enEdition ? "Modifier le Chef d'Agence" : "Créer un Chef d'Agence"}
          </h3>
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
            <label style={labelStyle}>{enEdition ? 'Nouveau mot de passe (laisser vide si inchangé)' : 'Mot de passe initial *'}</label>
            <input type="password" required={!enEdition} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inputStyle} />
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
