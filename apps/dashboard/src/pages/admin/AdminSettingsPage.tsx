import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { systemApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import { userFacingError } from '../../utils/userFacingError';
import {
  erreurNom,
  erreurRetention,
  refusParametres,
  type BornesParametres,
  type ChampParametre,
} from '../../utils/parametresSysteme';
import { TagIcon, BarChartIcon, CheckIcon } from '../../components/common/Icons';

interface Settings {
  id: string;
  nom_application: string;
  seuil_alerte_defaut: number;
  retention_mois: number;
  mode_ia: string;
  notifications_email_actives: boolean;
  date_modification: string;
  valeurs_hors_bornes?: string[];
  bornes?: BornesParametres;
}

// Les paramètres seuil_alerte_defaut, mode_ia et notifications_email_actives restent acceptés et stockés par l'API (aucune donnée
// supprimée) mais aucun code ne les lit : ils ne sont ni affichés ni envoyés d'ici (voir le README de l'API, « Paramètres système »).

const carte: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '24px',
  padding: '24px 28px',
  border: '1px solid #E8ECE6',
  boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
};
const titreCarte: React.CSSProperties = {
  fontWeight: 800,
  fontSize: '1.05rem',
  marginBottom: '16px',
  color: '#02302D',
  borderBottom: '1px solid #F1F4EE',
  paddingBottom: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};
const etiquette: React.CSSProperties = { display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '0.84rem', color: '#1E293B' };
const aide: React.CSSProperties = { fontSize: '0.78rem', color: '#64748B', marginTop: '6px', margin: 0 };
const erreurStyle: React.CSSProperties = { fontSize: '0.8rem', color: '#B91C1C', fontWeight: 700, marginTop: '6px' };

export type ErreursParametres = Partial<Record<ChampParametre, string>>;

export interface ParametresVueProps {
  settings: Settings;
  nom: string;
  retentionTexte: string;
  erreurs: ErreursParametres;
  saving: boolean;
  onNom: (v: string) => void;
  onRetention: (v: string) => void;
  onSave: () => void;
}

/** Formulaire (vue pure, testable sans réseau). Seuls les paramètres appliqués par la plateforme sont modifiables. */
export function ParametresVue({ settings, nom, retentionTexte, erreurs, saving, onNom, onRetention, onSave }: ParametresVueProps) {
  const borneRetention = settings.bornes?.retention_mois;
  const horsBornes = (settings.valeurs_hors_bornes ?? []).includes('retention_mois');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
      <PageHeader title="Paramètres système" subtitle="Configuration générale de la plateforme IKAN AI." />

      {horsBornes && (
        <Alert tone="warning" title="La durée de conservation enregistrée est hors des limites autorisées">
          La valeur enregistrée ({settings.retention_mois} mois) n’est pas montrée aux clients : la durée par défaut s’affiche à la place.
          Enregistrez une durée valide pour la corriger.
        </Alert>
      )}

      <div
        role="note"
        style={{
          background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
          borderRadius: '16px', padding: '12px 16px', fontSize: '0.84rem', lineHeight: 1.5,
        }}
      >
        <strong>À savoir :</strong> la durée de conservation est affichée aux clients dans la case de consentement, mais aucune suppression
        automatique n’est encore effectuée. Autres paramètres : bientôt disponibles.
      </div>

      <div style={carte}>
        <h2 style={titreCarte}>
          <TagIcon size={18} color="#3C7730" />
          <span>Identité de la plateforme</span>
        </h2>
        <div>
          <label htmlFor="param-nom" style={etiquette}>Nom de l'application</label>
          <input
            id="param-nom"
            className="saas-input"
            value={nom}
            onChange={(e) => onNom(e.target.value)}
            placeholder="IKAN AI — Plateforme d’avis clients"
            aria-invalid={erreurs.nom_application ? true : undefined}
            aria-describedby={erreurs.nom_application ? 'param-nom-erreur' : undefined}
          />
          {erreurs.nom_application && <p id="param-nom-erreur" role="alert" style={erreurStyle}>{erreurs.nom_application}</p>}
          <p style={aide}>Nom de référence de la plateforme (pas encore repris dans les exports ni les e-mails).</p>
        </div>
      </div>

      <div style={carte}>
        <h2 style={titreCarte}>
          <BarChartIcon size={18} color="#3C7730" />
          <span>Conservation des données</span>
        </h2>
        <div>
          <label htmlFor="param-retention" style={etiquette}>Durée de conservation des avis clients (mois)</label>
          <input
            id="param-retention"
            type="text"
            inputMode="numeric"
            className="saas-input"
            style={{ width: '120px' }}
            value={retentionTexte}
            onChange={(e) => onRetention(e.target.value)}
            aria-invalid={erreurs.retention_mois ? true : undefined}
            aria-describedby={erreurs.retention_mois ? 'param-retention-erreur' : 'param-retention-aide'}
          />
          {erreurs.retention_mois && <p id="param-retention-erreur" role="alert" style={erreurStyle}>{erreurs.retention_mois}</p>}
          <p id="param-retention-aide" style={aide}>
            {borneRetention ? `De ${borneRetention.min} à ${borneRetention.max} mois. ` : ''}
            Durée annoncée aux clients dans la case de consentement.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
        <button onClick={onSave} disabled={saving} className="btn-primary" style={{ padding: '12px 28px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <CheckIcon size={16} />
          <span>{saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}</span>
        </button>
      </div>
    </div>
  );
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
  const [nom, setNom] = useState('');
  const [retentionTexte, setRetentionTexte] = useState('');
  const [erreurs, setErreurs] = useState<ErreursParametres>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [erreurChargement, setErreurChargement] = useState('');
  const [rechargement, setRechargement] = useState(0);

  const appliquer = (s: Settings) => {
    setSettings(s);
    setNom(s.nom_application ?? '');
    setRetentionTexte(String(s.retention_mois ?? ''));
    setErreurs({});
  };

  useEffect(() => {
    setLoading(true);
    setErreurChargement('');
    systemApi
      .getSettings()
      .then((r) => appliquer(r.data))
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
    if (!settings) return;
    // Mêmes bornes que le serveur (lues dans sa réponse) : la soumission est bloquée avant l'envoi si la saisie est invalide.
    const locales: ErreursParametres = {};
    const e1 = erreurNom(nom, settings.bornes);
    const e2 = erreurRetention(retentionTexte, settings.bornes);
    if (e1) locales.nom_application = e1;
    if (e2) locales.retention_mois = e2;
    setErreurs(locales);
    if (e1 || e2) return;

    setSaving(true);
    try {
      // Mise à jour partielle : seuls les paramètres affichés sont envoyés ; les autres ne sont jamais touchés.
      const r = await systemApi.updateSettings({ nom_application: nom.trim(), retention_mois: Number(retentionTexte.trim()) });
      appliquer(r.data);
      showToast('Paramètres enregistrés avec succès');
    } catch (err) {
      console.error('Erreur enregistrement des paramètres système:', err);
      const refus = refusParametres(err);
      if (refus?.champ) setErreurs({ [refus.champ]: refus.message });
      else showToast(refus?.message ?? userFacingError(err, 'Impossible d’enregistrer les paramètres. Veuillez réessayer.'));
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
    <>
      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white',
            padding: '12px 20px', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', fontSize: '0.88rem', fontWeight: 700,
          }}
        >
          {toast}
        </div>
      )}
      <ParametresVue
        settings={settings}
        nom={nom}
        retentionTexte={retentionTexte}
        erreurs={erreurs}
        saving={saving}
        onNom={setNom}
        onRetention={setRetentionTexte}
        onSave={handleSave}
      />
    </>
  );
}
