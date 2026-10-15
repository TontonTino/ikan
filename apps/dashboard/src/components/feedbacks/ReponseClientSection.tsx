import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ReponseClient } from '../../types';
import { feedbacksApi } from '../../services/api';
import {
  CANAL_LABELS, CANAUX_REPONSE, LIBELLES_REGISTRE, LONGUEUR_MAX_REPONSE,
  canalApresBrouillon, decisionUtilisation, enregistrerTraiteLaDemande, texteDuBrouillon,
} from '../../utils/brouillonReponse';
import type { CanalReponse, EtatBrouillon } from '../../utils/brouillonReponse';
import { userFacingError } from '../../utils/userFacingError';
import { AvertissementReponse } from './DemandeContactBlocs';
import { InfoIcon, MessageSquareIcon, SendIcon } from '../common/Icons';

const CIBLE_MIN = 44; // hauteur minimale des zones cliquables (mobile)

interface FormulaireProps {
  /** Demande de rappel de l'avis, s'il y en a une : l'avertissement n'apparaît que si elle n'est pas encore traitée. */
  demande?: { traitee: boolean } | null;
  brouillon: EtatBrouillon;
  contenu: string;
  canal: CanalReponse;
  enregistrement: boolean;
  /** Remplacement du texte saisi par le brouillon en attente de confirmation. */
  confirmationRemplacement: boolean;
  onContenu: (valeur: string) => void;
  onCanal: (canal: CanalReponse) => void;
  onUtiliserBrouillon: () => void;
  onConfirmerRemplacement: () => void;
  onAnnulerRemplacement: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

const boutonSecondaire: React.CSSProperties = { minHeight: CIBLE_MIN, padding: '8px 14px', fontSize: '0.82rem', borderRadius: '10px' };

/** Partie visuelle, sans état propre : testable avec renderToStaticMarkup. */
export function ReponseClientFormulaire({
  demande, brouillon, contenu, canal, enregistrement, confirmationRemplacement,
  onContenu, onCanal, onUtiliserBrouillon, onConfirmerRemplacement, onAnnulerRemplacement, onSubmit,
}: FormulaireProps) {
  const texteBrouillon = texteDuBrouillon(brouillon);
  const registre = brouillon.statut === 'ok' ? brouillon.brouillon.registre : null;
  const peutEnregistrer = contenu.trim().length > 0 && !enregistrement;
  return (
    <section
      aria-labelledby="titre-reponse-client"
      style={{ background: '#FFF7ED', border: '1px solid #FFEDD5', borderRadius: '18px', padding: '18px 20px' }}
    >
      <h3 id="titre-reponse-client" style={{ margin: '0 0 8px', fontSize: '0.84rem', fontWeight: 800, color: '#C2410C', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase' }}>
        <MessageSquareIcon size={15} color="#C2410C" aria-hidden="true" />
        <span>Répondre au client</span>
      </h3>
      <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: '#64748B', lineHeight: 1.5 }}>
        IKAN AI n’envoie aucun message au client. Contactez-le par le canal choisi, puis notez ici ce que vous lui avez répondu.
      </p>

      {brouillon.statut === 'chargement' && (
        <p role="status" aria-busy="true" style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#64748B' }}>Préparation d’un brouillon…</p>
      )}
      {brouillon.statut === 'erreur' && (
        <p role="status" style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#64748B' }}>
          Le brouillon n’est pas disponible pour le moment. Vous pouvez rédiger votre réponse ci-dessous.
        </p>
      )}
      {texteBrouillon && (
        <div style={{ background: '#FFFFFF', border: '1px dashed #FDBA74', borderRadius: '12px', padding: '12px 14px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px', fontSize: '0.76rem', fontWeight: 800, color: '#9A3412' }}>
            <InfoIcon size={14} color="#9A3412" aria-hidden="true" />
            <span>Brouillon proposé{registre && LIBELLES_REGISTRE[registre] ? ` · ${LIBELLES_REGISTRE[registre]}` : ''}</span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '0.74rem', color: '#64748B', lineHeight: 1.5 }}>
            Texte généré à partir de règles, sans reprendre le commentaire du client. Relisez-le et adaptez-le avant de l’utiliser.
          </p>
          <div data-testid="texte-brouillon" style={{ whiteSpace: 'pre-wrap', fontSize: '0.84rem', color: '#431407', lineHeight: 1.55, marginBottom: '10px' }}>
            {texteBrouillon}
          </div>
          {confirmationRemplacement ? (
            <div role="alertdialog" aria-label="Remplacer le texte saisi" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: '#9A3412' }}>
                Remplacer le texte que vous avez saisi par ce brouillon ? Votre texte sera perdu.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary" onClick={onConfirmerRemplacement} style={boutonSecondaire}>Remplacer mon texte</button>
                <button type="button" className="btn-secondary" onClick={onAnnulerRemplacement} style={boutonSecondaire}>Garder mon texte</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={onUtiliserBrouillon} style={boutonSecondaire}>
              Utiliser ce brouillon
            </button>
          )}
        </div>
      )}

      {enregistrerTraiteLaDemande(demande) && <AvertissementReponse />}
      <form onSubmit={onSubmit}>
        <fieldset style={{ border: 0, margin: '0 0 8px', padding: 0 }}>
          <legend style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748B', marginBottom: '6px', padding: 0 }}>Canal utilisé</legend>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {CANAUX_REPONSE.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={canal === c}
                onClick={() => onCanal(c)}
                style={{
                  minHeight: CIBLE_MIN,
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: canal === c ? '2px solid #C2410C' : '1px solid #E2E8F0',
                  background: canal === c ? '#FFF7ED' : '#FFFFFF',
                  color: canal === c ? '#C2410C' : '#64748B',
                }}
              >
                {CANAL_LABELS[c]}
              </button>
            ))}
          </div>
        </fieldset>
        <label htmlFor="reponse-client-texte" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#64748B', marginBottom: '6px' }}>
          Votre réponse
        </label>
        <textarea
          id="reponse-client-texte"
          rows={6}
          value={contenu}
          maxLength={LONGUEUR_MAX_REPONSE}
          onChange={(e) => onContenu(e.target.value)}
          placeholder="Ce que vous avez répondu au client (ex. : appelé ce jour, problème de facturation expliqué et corrigé)…"
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.86rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '4px' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', color: '#64748B' }}>{contenu.length} / {LONGUEUR_MAX_REPONSE} caractères</span>
          <button
            type="submit"
            disabled={!peutEnregistrer}
            className="btn-primary"
            style={{ ...boutonSecondaire, opacity: peutEnregistrer ? 1 : 0.5, cursor: peutEnregistrer ? 'pointer' : 'not-allowed' }}
          >
            <SendIcon size={12} aria-hidden="true" />
            <span>{enregistrement ? 'Enregistrement…' : 'Enregistrer la réponse'}</span>
          </button>
        </div>
      </form>
    </section>
  );
}

interface SectionProps {
  feedbackId: string;
  demande?: { traitee: boolean } | null;
  /** Reçoit la liste à jour des réponses après un enregistrement réussi. */
  onEnregistree: (reponses: ReponseClient[]) => void | Promise<void>;
  onNotifier: (message: string) => void;
}

/** Section « Répondre au client » d'une fiche d'avis : toujours visible, avec brouillon quand l'API en propose un. */
export default function ReponseClientSection({ feedbackId, demande, onEnregistree, onNotifier }: SectionProps) {
  const [brouillon, setBrouillon] = useState<EtatBrouillon>({ statut: 'chargement' });
  const [contenu, setContenu] = useState('');
  const [canal, setCanal] = useState<CanalReponse>('telephone');
  const [enregistrement, setEnregistrement] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const courant = useRef(feedbackId);

  const charger = useCallback(async (id: string) => {
    try {
      const res = await feedbacksApi.getBrouillonReponse(id);
      if (courant.current === id) setBrouillon({ statut: 'ok', brouillon: res.data });
    } catch {
      if (courant.current === id) setBrouillon({ statut: 'erreur' });
    }
  }, []);

  // Changement d'avis : tout repart de zéro (aucun texte saisi sur un avis ne passe sur un autre) et une réponse tardive d'un
  // avis précédent est ignorée.
  useEffect(() => {
    courant.current = feedbackId;
    setBrouillon({ statut: 'chargement' });
    setContenu('');
    setCanal('telephone');
    setConfirmation(false);
    charger(feedbackId);
  }, [feedbackId, charger]);

  const appliquer = (texte: string) => {
    setContenu(texte);
    setCanal((actuel) => canalApresBrouillon(actuel, brouillon.statut === 'ok' ? brouillon.brouillon.canal_suggere : null));
    setConfirmation(false);
  };

  const texteBrouillon = texteDuBrouillon(brouillon);
  const utiliser = () => {
    if (!texteBrouillon) return;
    const decision = decisionUtilisation(contenu, texteBrouillon);
    if (decision === 'appliquer') appliquer(texteBrouillon);
    else if (decision === 'confirmer') setConfirmation(true);
  };

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contenu.trim() || enregistrement) return;
    setEnregistrement(true);
    try {
      const res = await feedbacksApi.envoyerReponseClient(feedbackId, contenu.trim(), canal);
      setContenu('');
      setConfirmation(false);
      await onEnregistree(res.data || []);
      onNotifier('Réponse au client enregistrée');
      charger(feedbackId); // une réponse existe maintenant : le brouillon disparaît
    } catch (err) {
      // Le texte saisi est conservé.
      onNotifier(userFacingError(err, 'Impossible d’enregistrer la réponse. Réessayez.'));
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <ReponseClientFormulaire
      demande={demande}
      brouillon={brouillon}
      contenu={contenu}
      canal={canal}
      enregistrement={enregistrement}
      confirmationRemplacement={confirmation}
      onContenu={setContenu}
      onCanal={setCanal}
      onUtiliserBrouillon={utiliser}
      onConfirmerRemplacement={() => texteBrouillon && appliquer(texteBrouillon)}
      onAnnulerRemplacement={() => setConfirmation(false)}
      onSubmit={soumettre}
    />
  );
}
