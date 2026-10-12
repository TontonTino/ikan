import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { systemApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import { userFacingError } from '../../utils/userFacingError';
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

// Contrôle d'accès séparé du contenu : les hooks du contenu ne sont jamais appelés après un retour anticipé.
export default function AdminSettingsPage() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }
  return <AdminSettingsPageContenu />;
}

function AdminSettingsPageContenu() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Partial<Settings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [erreurChargement, setErreurChargement] = useState('');
  const [rechargement, setRechargement] = useState(0);

  useEffect(() => {
    setLoading(true);
    setErreurChargement('');
    systemApi
      .getSettings()
      .then((r) => {
        setSettings(r.data);
        setForm(r.data);
      })
      .catch((err) => {
        console.error('Erreur chargement des paramètres système:', err);
        setErreurChargement(userFacingError(err, 'Impossible de charger les paramètres. Veuillez réessayer.'));
      })
      .finally(() => setLoading(false));
  }, [rechargement]);

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
    } catch (err) {
      console.error('Erreur enregistrement des paramètres système:', err);
      showToast(userFacingError(err, 'Impossible d’enregistrer les paramètres. Veuillez réessayer.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des paramètres...</div>;

  // Sans paramètres chargés, le formulaire serait vide : l'enregistrer enverrait des valeurs absentes.
  if (erreurChargement || !settings) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <PageHeader title="Paramètres système" subtitle="Configuration générale de la plateforme IKAN AI." />
        <Alert
          tone="critical"
          title={erreurChargement || 'Les paramètres ne sont pas disponibles.'}
          action={<Button size="sm" variant="secondary" onClick={() => setRechargement((n) => n + 1)}>Réessayer</Button>}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
      {/* Toast */}
      {toast && (
        <div
          role="status"
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
        title="Paramètres système"
        subtitle="Configuration générale de la plateforme IKAN AI."
      />

      {/* Transparence : ces valeurs sont enregistrées (PATCH /system/settings) mais aucun
          service ne les lit encore côté API. Ne pas laisser croire qu'elles agissent. */}
      <div
        role="note"
        style={{
          background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
          borderRadius: '16px', padding: '12px 16px', fontSize: '0.84rem', lineHeight: 1.5,
        }}
      >
        <strong>À savoir :</strong> ces paramètres sont enregistrés, mais la plateforme ne les applique pas encore.
        Modifier une valeur ici ne change pas, pour l’instant, le fonctionnement des agences, des analyses ou des notifications.
      </div>

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
            placeholder="IKAN AI — Plateforme d’avis clients"
          />
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
            Nom de référence de la plateforme (pas encore repris dans les exports ni les e-mails).
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
          <span>Alertes et conservation des données</span>
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label htmlFor="param-seuil-alerte" style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
              Seuil d'alerte par défaut pour les nouvelles agences : <strong style={{ color: '#3C7730' }}>{form.seuil_alerte_defaut}%</strong>
            </label>
            <input
              id="param-seuil-alerte"
              type="range"
              min={0}
              max={100}
              value={form.seuil_alerte_defaut || 80}
              onChange={(e) => setForm({ ...form, seuil_alerte_defaut: Number(e.target.value) })}
              style={{ width: '100%', accentColor: '#3C7730' }}
            />
            <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
              Valeur prévue pour les nouvelles agences. Pas encore appliquée : le seuil se règle aujourd’hui agence par agence, dans Gestion des agences.
            </p>
          </div>
          <div>
            <label htmlFor="param-retention" style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
              Durée de conservation des avis clients (mois)
            </label>
            <input
              id="param-retention"
              type="number"
              min={1}
              max={120}
              className="saas-input"
              style={{ width: '120px' }}
              value={form.retention_mois || 24}
              onChange={(e) => setForm({ ...form, retention_mois: Number(e.target.value) })}
            />
            <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
              Durée prévue. Aucun archivage automatique n’est encore effectué.
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
          <span>Analyse automatique des avis</span>
        </h2>
        <div>
          <label htmlFor="param-mode-ia" style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' }}>
            Mode d’analyse
          </label>
          <select
            id="param-mode-ia"
            className="saas-input"
            value={form.mode_ia || 'deterministique'}
            onChange={(e) => setForm({ ...form, mode_ia: e.target.value })}
          >
            <option value="deterministique">Règles (analyse lexicale, sans IA externe)</option>
            <option value="hybride">Hybride (règles + modèle externe Hugging Face)</option>
          </select>
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 }}>
            Préférence enregistrée uniquement : l’analyse actuelle du ton des avis utilise toujours les règles, quel que soit le mode choisi.
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
        <label style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.notifications_email_actives || false}
            onChange={(e) => setForm({ ...form, notifications_email_actives: e.target.checked })}
            style={{ width: '24px', height: '24px', flex: '0 0 24px', accentColor: '#3C7730', cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1E293B' }}>Activer les notifications par e-mail</span>
        </label>
        <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '8px', marginLeft: '30px', margin: 0 }}>
          Préférence enregistrée uniquement : aucun e-mail d’alerte n’est encore envoyé à partir de ce réglage.
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
