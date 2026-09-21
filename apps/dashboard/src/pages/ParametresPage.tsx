import React, { useState } from 'react';
import { authApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import PageHeader from '../components/ui/PageHeader';
import { CheckCircleIcon, AlertTriangleIcon, KeyIcon, UsersIcon } from '../components/common/Icons';

function cardStyle(): React.CSSProperties {
  return {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid #E8ECE6',
    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
    padding: '24px',
  };
}

function Bandeau({ type, texte }: { type: 'succes' | 'erreur'; texte: string }) {
  const succes = type === 'succes';
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px',
        background: succes ? '#EAF5EC' : '#FEE2E2',
        border: `1px solid ${succes ? '#CFE3D3' : '#FCA5A5'}`,
        color: succes ? '#3C7730' : '#B91C1C',
        fontSize: '0.84rem', fontWeight: 600, marginTop: '14px',
      }}
    >
      {succes ? <CheckCircleIcon size={16} color="#3C7730" /> : <AlertTriangleIcon size={16} color="#B91C1C" />}
      {texte}
    </div>
  );
}

export default function ParametresPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  // ── Section 1 : informations du compte ──
  const [nom, setNom] = useState(user?.nom || '');
  const [prenom, setPrenom] = useState(user?.prenom || '');
  const [email, setEmail] = useState(user?.email || '');
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);
  const [messageInfos, setMessageInfos] = useState<{ type: 'succes' | 'erreur'; texte: string } | null>(null);

  const enregistrerInfos = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessageInfos(null);
    setEnregistrementEnCours(true);
    try {
      const res = await authApi.updateMe({ nom: nom.trim(), prenom: prenom.trim(), email: email.trim() });
      setUser(res.data);
      setMessageInfos({ type: 'succes', texte: 'Informations mises à jour.' });
    } catch (err: any) {
      setMessageInfos({ type: 'erreur', texte: err?.response?.data?.detail || 'Erreur lors de la mise à jour.' });
    } finally {
      setEnregistrementEnCours(false);
    }
  };

  // ── Section 2 : mot de passe ──
  const [ancienMdp, setAncienMdp] = useState('');
  const [nouveauMdp, setNouveauMdp] = useState('');
  const [confirmationMdp, setConfirmationMdp] = useState('');
  const [changementEnCours, setChangementEnCours] = useState(false);
  const [messageMdp, setMessageMdp] = useState<{ type: 'succes' | 'erreur'; texte: string } | null>(null);

  const changerMotDePasse = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessageMdp(null);

    if (nouveauMdp.length < 8) {
      setMessageMdp({ type: 'erreur', texte: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
      return;
    }
    if (nouveauMdp !== confirmationMdp) {
      setMessageMdp({ type: 'erreur', texte: 'La confirmation ne correspond pas au nouveau mot de passe.' });
      return;
    }

    setChangementEnCours(true);
    try {
      await authApi.changerMotDePasse(ancienMdp, nouveauMdp);
      setMessageMdp({ type: 'succes', texte: 'Mot de passe mis à jour.' });
      setAncienMdp('');
      setNouveauMdp('');
      setConfirmationMdp('');
    } catch (err: any) {
      setMessageMdp({ type: 'erreur', texte: err?.response?.data?.detail || 'Ancien mot de passe incorrect.' });
    } finally {
      setChangementEnCours(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '640px' }}>
      <PageHeader title="Paramètres" subtitle="Gérez les informations de votre compte personnel." />

      {/* ── Informations du compte ── */}
      <div style={cardStyle()}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UsersIcon size={18} color="#3C7730" />
          Informations du compte
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: '0.82rem', color: '#64748B' }}>
          Votre nom et votre email de connexion.
        </p>

        <form onSubmit={enregistrerInfos}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>Prénom</label>
              <input value={prenom} onChange={(e) => setPrenom(e.target.value)} required className="saas-input" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>Nom</label>
              <input value={nom} onChange={(e) => setNom(e.target.value)} required className="saas-input" style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ marginBottom: '4px' }}>
            <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="saas-input" style={{ width: '100%' }} />
          </div>

          {messageInfos && <Bandeau type={messageInfos.type} texte={messageInfos.texte} />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
            <button type="submit" disabled={enregistrementEnCours} className="btn-primary">
              {enregistrementEnCours ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Mot de passe ── */}
      <div style={cardStyle()}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800, color: '#02302D', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyIcon size={18} color="#3C7730" />
          Mot de passe
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: '0.82rem', color: '#64748B' }}>
          Votre mot de passe actuel est requis pour en définir un nouveau.
        </p>

        <form onSubmit={changerMotDePasse}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>Ancien mot de passe</label>
            <input type="password" value={ancienMdp} onChange={(e) => setAncienMdp(e.target.value)} required className="saas-input" style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>Nouveau mot de passe</label>
              <input type="password" value={nouveauMdp} onChange={(e) => setNouveauMdp(e.target.value)} required minLength={8} className="saas-input" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>Confirmation</label>
              <input type="password" value={confirmationMdp} onChange={(e) => setConfirmationMdp(e.target.value)} required minLength={8} className="saas-input" style={{ width: '100%' }} />
            </div>
          </div>

          {messageMdp && <Bandeau type={messageMdp.type} texte={messageMdp.texte} />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
            <button type="submit" disabled={changementEnCours} className="btn-primary">
              {changementEnCours ? 'Modification…' : 'Changer le mot de passe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
