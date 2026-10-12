import React, { useEffect, useState } from 'react';
import type { EscaladeMotif, IssueEscalation, IssueStatut } from '../../types';
import { issuesApi } from '../../services/api';
import Button from '../ui/Button';
import SkeletonBlock from '../ui/SkeletonBlock';
import { fullDate } from '../ui/format';
import { ESCALADE_MOTIF_LABELS, ROLE_LABELS, libelleMotifEscalade } from '../../utils/vocabulaire';
import { estEnAttente } from '../../utils/issueSuivi';
import { userFacingError } from '../../utils/userFacingError';

const MOTIFS = Object.keys(ESCALADE_MOTIF_LABELS) as EscaladeMotif[];

/**
 * Journal d'escalade d'un problème. Une escalade est un enregistrement MANUEL : elle ne
 * change pas le statut du problème et n'envoie aucune notification (voir
 * POST /issues/{id}/escalations). Le journal en garde seulement la trace.
 */
export default function IssueEscalationSection({ issueId, statut }: { issueId: string; statut: IssueStatut }) {
  const [entrees, setEntrees] = useState<IssueEscalation[] | null>(null);
  const [erreurChargement, setErreurChargement] = useState('');
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [motif, setMotif] = useState<EscaladeMotif>('decision_manageriale');
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'erreur'; texte: string } | null>(null);

  const charger = React.useCallback(() => {
    let annule = false;
    setErreurChargement('');
    issuesApi
      .listEscalades(issueId)
      .then((r) => { if (!annule) setEntrees(Array.isArray(r.data) ? r.data : []); })
      .catch((err) => {
        if (annule) return;
        console.error('Erreur chargement du journal d’escalade:', err);
        setErreurChargement(userFacingError(err, 'Impossible de charger le journal d’escalade. Veuillez réessayer.'));
      });
    return () => { annule = true; };
  }, [issueId]);

  useEffect(() => {
    setEntrees(null);
    setFormulaireOuvert(false);
    setMessage(null);
    return charger();
  }, [charger]);

  const enregistrer = async () => {
    setEnvoi(true);
    setMessage(null);
    try {
      const r = await issuesApi.escalader(issueId, motif);
      setEntrees((courantes) => [...(courantes ?? []), r.data]);
      setFormulaireOuvert(false);
      setMessage({ tone: 'ok', texte: 'Escalade enregistrée dans le journal.' });
    } catch (err) {
      console.error('Erreur enregistrement de l’escalade:', err);
      setMessage({ tone: 'erreur', texte: userFacingError(err, 'Impossible d’enregistrer l’escalade. Veuillez réessayer.') });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
        Une escalade est enregistrée à la main. Elle garde la trace d’une demande d’intervention supérieure,
        mais ne change pas le statut du problème et ne prévient personne automatiquement.
      </p>

      {erreurChargement ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.84rem', color: 'var(--color-critical-text)' }}>
          {erreurChargement}
          <Button size="sm" variant="secondary" onClick={charger}>Réessayer</Button>
        </div>
      ) : entrees === null ? (
        <SkeletonBlock height={44} />
      ) : entrees.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-muted)' }}>Aucune escalade enregistrée.</p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {entrees.map((e) => (
            <li key={e.id} style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--color-text-main)' }}>{libelleMotifEscalade(e.motif)}</div>
              <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                {fullDate(e.date_evenement)} · par {e.declenchee_par_nom}
                {ROLE_LABELS[e.declenchee_par_role] ? ` (${ROLE_LABELS[e.declenchee_par_role]})` : ''}
              </div>
            </li>
          ))}
        </ol>
      )}

      {message && (
        <p role={message.tone === 'erreur' ? 'alert' : 'status'} style={{ margin: 0, fontSize: '0.84rem', fontWeight: 700, color: message.tone === 'erreur' ? 'var(--color-critical-text)' : 'var(--color-success-text)' }}>
          {message.texte}
        </p>
      )}

      {estEnAttente(statut) && !erreurChargement && entrees !== null && (
        formulaireOuvert ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
              Motif de l’escalade
              <select
                value={motif}
                onChange={(e) => setMotif(e.target.value as EscaladeMotif)}
                disabled={envoi}
                style={{ minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontFamily: 'inherit', fontWeight: 600 }}
              >
                {MOTIFS.map((m) => <option key={m} value={m}>{ESCALADE_MOTIF_LABELS[m]}</option>)}
              </select>
            </label>
            <Button onClick={enregistrer} loading={envoi}>Enregistrer l’escalade</Button>
            <Button variant="ghost" onClick={() => setFormulaireOuvert(false)} disabled={envoi}>Annuler</Button>
          </div>
        ) : (
          <div>
            <Button variant="secondary" onClick={() => { setMessage(null); setFormulaireOuvert(true); }}>Signaler une escalade</Button>
          </div>
        )
      )}
    </div>
  );
}
