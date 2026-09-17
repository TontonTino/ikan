import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { systemApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/ui/PageHeader';
import {
  TagIcon,
  BarChartIcon,
  LightningIcon,
  AlertTriangleIcon,
  CheckIcon,
} from '../../components/common/Icons';

interface Settings {
  id: string;
  nom_application: string;
  seuil_alerte_defaut: number;
  retention_mois: number;
  mode_ia: string;
  notifications_email_actives: boolean;
  date_modification: string;
}

export default function AdminSettingsPage() {
  const user = useAuthStore((s) => s.user);

  if (user?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Partial<Settings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    systemApi
      .getSettings()
      .then((r) => {
        setSettings(r.data);
        setForm(r.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await systemApi.updateSettings({
        nom_application: form.nom_application,
        seuil_alerte_defaut: form.seuil_alerte_defaut,
        retention_mois: form.retention_mois,
        mode_ia: form.mode_ia,
        notifications_email_actives: form.notifications_email_actives,
      });
      setSettings(r.data);
      setForm(r.data);
      showToast('Paramètres enregistrés avec succès');
    } catch {
      showToast('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des paramètres...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 1000,
            background: '#02302D',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
            fontSize: '0.88rem',
            fontWeight: 700,
          }}
        >
          {toast}
        </div>
      )}

      {/* ── Page Header Standardisé ── */}
      <PageHeader
        title="Paramètres Système"
        subtitle="Configuration globale et règles d'analyse de la plateforme IKAN AI."
      />

      {/* Section 1 : Identité de la plateforme */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '24px',
          padding: '24px 28px',
          border: '1px solid #E8ECE6',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
        }}
      >
        <h2
          style={{
            fontWeight: 800,
            fontSize: '1.05rem',
            marginBottom: '16px',
            color: '#02302D',
            borderBottom: '1px solid #F1F4EE',
            paddingBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <TagIcon size={18} color="#3C7730" />
          <span>Identité de la plateforme</span>
        </h2>
        <div>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
            Nom de l'application
          </label>
          <input
            className="saas-input"
            value={form.nom_application || ''}
            onChange={(e) => setForm({ ...form, nom_application: e.target.value })}
            placeholder="IKAN AI — Plateforme Feedback Client"
          />
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
            Ce nom apparaît dans les exports, rapports et communications automatiques.
          </p>
        </div>
      </div>

      {/* Section 2 : Alertes et données */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '24px',
          padding: '24px 28px',
          border: '1px solid #E8ECE6',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
        }}
      >
        <h2
          style={{
            fontWeight: 800,
            fontSize: '1.05rem',
            marginBottom: '16px',
            color: '#02302D',
            borderBottom: '1px solid #F1F4EE',
            paddingBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <BarChartIcon size={18} color="#3C7730" />
          <span>Alertes et Rétention des données</span>
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
              Seuil d'alerte par défaut pour les nouvelles agences : <strong style={{ color: '#3C7730' }}>{form.seuil_alerte_defaut}%</strong>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={form.seuil_alerte_defaut || 80}
              onChange={(e) => setForm({ ...form, seuil_alerte_defaut: Number(e.target.value) })}
              style={{ width: '100%', accentColor: '#3C7730' }}
            />
            <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
              Appliqué automatiquement à chaque nouvelle agence créée. Les agences existantes ne sont pas affectées.
            </p>
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
              Durée de rétention des feedbacks (mois)
            </label>
            <input
              type="number"
              min={1}
              max={120}
              className="saas-input"
              style={{ width: '120px' }}
              value={form.retention_mois || 24}
              onChange={(e) => setForm({ ...form, retention_mois: Number(e.target.value) })}
            />
            <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
              Les feedbacks plus anciens que cette durée seront archivés automatiquement.
            </p>
          </div>
        </div>
      </div>

      {/* Section 3 : Moteur IA */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '24px',
          padding: '24px 28px',
          border: '1px solid #E8ECE6',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
        }}
      >
        <h2
          style={{
            fontWeight: 800,
            fontSize: '1.05rem',
            marginBottom: '16px',
            color: '#02302D',
            borderBottom: '1px solid #F1F4EE',
            paddingBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <LightningIcon size={18} color="#3C7730" />
          <span>Moteur d'Analyse IA</span>
        </h2>
        <div>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
            Mode du moteur IA
          </label>
          <select
            className="saas-input"
            value={form.mode_ia || 'deterministique'}
            onChange={(e) => setForm({ ...form, mode_ia: e.target.value })}
          >
            <option value="deterministique">Déterministe (règles lexicales & classification rapide)</option>
            <option value="hybride">Hybride (règles + API Hugging Face)</option>
          </select>
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
            Le mode hybride utilise l'API Hugging Face à distance avec fallback déterministe immédiat.
          </p>
        </div>
      </div>

      {/* Section 4 : Notifications */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '24px',
          padding: '24px 28px',
          border: '1px solid #E8ECE6',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
        }}
      >
        <h2
          style={{
            fontWeight: 800,
            fontSize: '1.05rem',
            marginBottom: '16px',
            color: '#02302D',
            borderBottom: '1px solid #F1F4EE',
            paddingBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangleIcon size={18} color="#3C7730" />
          <span>Notifications</span>
        </h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.notifications_email_actives || false}
            onChange={(e) => setForm({ ...form, notifications_email_actives: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#3C7730', cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1E293B' }}>Activer les notifications par email</span>
        </label>
        <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '8px', marginLeft: '30px', margin: 0 }}>
          Envoie des alertes par email aux responsables concernés lorsqu'un seuil de criticité est détecté.
        </p>
      </div>

      {/* Bouton Enregistrer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
          style={{ padding: '12px 28px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <CheckIcon size={16} />
          <span>{saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}</span>
        </button>
      </div>
    </div>
  );
}
