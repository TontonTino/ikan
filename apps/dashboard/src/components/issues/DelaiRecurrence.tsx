import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { issuesApi } from '../../services/api';
import type { Issue, IssueDetail, UserRole } from '../../types';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import SkeletonBlock from '../ui/SkeletonBlock';
import { fullDate, shortDate } from '../ui/format';
import { jourLocal } from '../../utils/actionsProbleme';
import { etatDelai, libelleJours } from '../../utils/issueSuivi';
import {
  LIMITE_CANDIDATS,
  PHRASE_QUI_DECIDE,
  candidatsOrigine,
  delaiModifiable,
  delaiVersIso,
  envoyerDelaiRecurrence,
  jourDuDelai,
  libelleCandidat,
  libelleTroncature,
  peutFixerDelaiRecurrence,
  validerDelai,
  type ChargeDelaiRecurrence,
  type EchecDR,
} from '../../utils/delaiRecurrence';
import Section from './SectionDetail';

type Candidat = Pick<Issue, 'id' | 'titre' | 'statut' | 'premiere_detection' | 'issue_origine_id' | 'agence_nom'>;
export type EtatCandidats =
  | { statut: 'chargement' }
  | { statut: 'erreur' }
  | { statut: 'ok'; liste: Candidat[]; total: number; charges: number };

/** Problèmes résolus ou vérifiés de l'organisation (le serveur limite au périmètre), chargés SEULEMENT quand le choix de l'origine est ouvert. */
export function useCandidatsOrigine(actif: boolean): { etat: EtatCandidats; recharger: () => void } {
  const [etat, setEtat] = useState<EtatCandidats>({ statut: 'chargement' });
  const [essai, setEssai] = useState(0);
  useEffect(() => {
    if (!actif) return undefined;
    let annule = false;
    setEtat({ statut: 'chargement' });
    Promise.all([
      issuesApi.list({ statut: 'resolue', limit: LIMITE_CANDIDATS }),
      issuesApi.list({ statut: 'verifiee', limit: LIMITE_CANDIDATS }),
    ])
      .then(([a, b]) => {
        if (annule) return;
        const la = (a.data || []) as Candidat[];
        const lb = (b.data || []) as Candidat[];
        const total = Number(a.headers?.['x-total-count'] ?? la.length) + Number(b.headers?.['x-total-count'] ?? lb.length);
        setEtat({ statut: 'ok', liste: [...la, ...lb], total, charges: la.length + lb.length });
      })
      .catch(() => { if (!annule) setEtat({ statut: 'erreur' }); });
    return () => { annule = true; };
  }, [actif, essai]);
  const recharger = useCallback(() => setEssai((n) => n + 1), []);
  return { etat, recharger };
}

// ── Éditeurs (présentation pure, testables sans navigateur) ────────────────────

interface BasEditeur {
  formulaire: string;
  envoi: boolean;
  onAnnuler: () => void;
  libelleValider: string;
}
function PiedEditeur({ formulaire, envoi, onAnnuler, libelleValider }: BasEditeur) {
  return (
    <div className="pb-dr__pied">
      <Button variant="primary" size="sm" type="submit" form={formulaire} loading={envoi}>{envoi ? 'Enregistrement…' : libelleValider}</Button>
      <Button variant="ghost" size="sm" onClick={onAnnuler} disabled={envoi}>Annuler</Button>
    </div>
  );
}

interface EditeurDelaiProps {
  id: string;
  jour: string;
  min: string;
  erreur: string | null;
  envoi: boolean;
  onChange: (jour: string) => void;
  onSoumettre: () => void;
  onAnnuler: () => void;
}
/** Saisie du délai : une date, jamais vide, postérieure à l'enregistrement du problème. L'erreur est liée au champ et annoncée. */
export function EditeurDelai({ id, jour, min, erreur, envoi, onChange, onSoumettre, onAnnuler }: EditeurDelaiProps) {
  return (
    <form className="pb-dr__editeur" noValidate onSubmit={(e) => { e.preventDefault(); onSoumettre(); }} id={`${id}-form`}>
      <div className="alerte-dialogue__champ">
        <label htmlFor={id} className="alerte-dialogue__label">Date limite de traitement</label>
        <input
          id={id}
          className="alerte-dialogue__controle"
          data-autofocus
          type="date"
          min={min}
          value={jour}
          readOnly={envoi}
          required
          aria-required="true"
          aria-invalid={erreur ? true : undefined}
          aria-describedby={`${id}-aide${erreur ? ` ${id}-erreur` : ''}`}
          onChange={(e) => onChange(e.target.value)}
        />
        <p id={`${id}-aide`} className="alerte-dialogue__aide">Le problème sera signalé « en retard » une fois cette date passée, s’il n’est pas résolu.</p>
        {erreur && <p id={`${id}-erreur`} className="alerte-dialogue__erreur" role="alert">{erreur}</p>}
      </div>
      <PiedEditeur formulaire={`${id}-form`} envoi={envoi} onAnnuler={onAnnuler} libelleValider="Enregistrer le délai" />
    </form>
  );
}

interface EditeurOrigineProps {
  id: string;
  candidats: EtatCandidats;
  /** Problèmes déjà filtrés par `candidatsOrigine`. */
  propositions: Candidat[];
  choix: string;
  erreur: string | null;
  envoi: boolean;
  onChange: (id: string) => void;
  onSoumettre: () => void;
  onAnnuler: () => void;
  onRecharger: () => void;
}
/** Choix du problème d'origine parmi les problèmes résolus ou vérifiés, plus anciens. Chargement, erreur (« Réessayer »), vide : trois états distincts. */
export function EditeurOrigine({ id, candidats, propositions, choix, erreur, envoi, onChange, onSoumettre, onAnnuler, onRecharger }: EditeurOrigineProps) {
  const troncature = candidats.statut === 'ok' ? libelleTroncature(candidats.charges, candidats.total) : null;
  return (
    <form className="pb-dr__editeur" noValidate onSubmit={(e) => { e.preventDefault(); onSoumettre(); }} id={`${id}-form`}>
      <div className="alerte-dialogue__champ">
        <label htmlFor={id} className="alerte-dialogue__label">Problème d’origine</label>
        {candidats.statut === 'chargement' && <div aria-busy="true" aria-label="Chargement des problèmes"><SkeletonBlock height={44} /></div>}
        {candidats.statut === 'erreur' && (
          <Alert tone="critical" title="La liste des problèmes n’a pas pu être chargée." action={<Button size="sm" variant="secondary" onClick={onRecharger}>Réessayer</Button>} />
        )}
        {candidats.statut === 'ok' && propositions.length === 0 && (
          <p className="alerte-dialogue__aide">Aucun problème résolu ou vérifié, plus ancien et lui-même non récurrent, ne peut servir d’origine.</p>
        )}
        {candidats.statut === 'ok' && propositions.length > 0 && (
          <select
            id={id}
            className="alerte-dialogue__controle"
            data-autofocus
            value={choix}
            disabled={envoi}
            required
            aria-required="true"
            aria-invalid={erreur ? true : undefined}
            aria-describedby={`${id}-aide${erreur ? ` ${id}-erreur` : ''}`}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Choisir un problème</option>
            {propositions.map((c) => <option key={c.id} value={c.id}>{libelleCandidat(c)}</option>)}
          </select>
        )}
        <p id={`${id}-aide`} className="alerte-dialogue__aide">{troncature ?? 'Un problème est une récidive quand il réapparaît après qu’un problème précédent a été résolu.'}</p>
        {erreur && <p id={`${id}-erreur`} className="alerte-dialogue__erreur" role="alert">{erreur}</p>}
      </div>
      <PiedEditeur formulaire={`${id}-form`} envoi={envoi} onAnnuler={onAnnuler} libelleValider="Enregistrer le lien" />
    </form>
  );
}

// ── Section du panneau ─────────────────────────────────────────────────────────

interface Props {
  issue: IssueDetail;
  role: UserRole | undefined;
  /** Modification enregistrée (ou problème changé entre-temps) : annonce le résultat, rafraîchit la liste et le détail. */
  onChange: (issueId: string, message: string) => void | Promise<void>;
  onOuvrirOrigine?: (issueId: string) => void;
  maintenant?: number;
}

type Editeur = 'delai' | 'recurrence' | null;
interface Envoi { charge: ChargeDelaiRecurrence; message: string }

/**
 * « Délai et récurrence » : le CX Manager fixe le délai de traitement et lie un problème d'origine ; l'Agency Manager lit les valeurs, sans commande, avec une phrase qui
 * dit qui décide. Le serveur applique la même règle. Rien n'est inventé : sans délai, aucun « à l'heure » ; sans origine, aucune récidive.
 */
export default function DelaiRecurrence({ issue, role, onChange, onOuvrirOrigine, maintenant = Date.now() }: Props) {
  const base = useId();
  const peutModifier = peutFixerDelaiRecurrence(role);
  const [editeur, setEditeur] = useState<Editeur>(null);
  const [jour, setJour] = useState('');
  const [choix, setChoix] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [echec, setEchec] = useState<EchecDR | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const enCours = useRef(false);
  const derniere = useRef<Envoi | null>(null);
  const dernierEditeur = useRef<'delai' | 'recurrence'>('delai');
  const racine = useRef<HTMLDivElement | null>(null);
  const { etat: candidats, recharger } = useCandidatsOrigine(peutModifier && editeur === 'recurrence');

  const issueId = issue.id;
  useEffect(() => { setEditeur(null); setEchec(null); setErreur(null); setEnvoi(false); enCours.current = false; }, [issueId]);

  // L'éditeur ouvert reçoit le focus ; une fois refermé, le focus revient au bouton qui l'a ouvert.
  useEffect(() => {
    if (editeur) racine.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, [editeur, candidats.statut]);
  const rendreFocus = useCallback(() => {
    window.setTimeout(() => racine.current?.querySelector<HTMLElement>(`[data-retour="${dernierEditeur.current}"]`)?.focus({ preventScroll: true }), 0);
  }, []);
  const fermer = useCallback(() => {
    setEditeur(null); setErreur(null); setEchec(null);
    rendreFocus();
  }, [rendreFocus]);

  const delai = etatDelai(issue, maintenant);
  const modifiable = delaiModifiable(issue.statut);
  const propositions = candidats.statut === 'ok' ? candidatsOrigine(candidats.liste, issue) : [];

  const ouvrir = (e: 'delai' | 'recurrence') => {
    dernierEditeur.current = e;
    setErreur(null); setEchec(null);
    if (e === 'delai') setJour(jourDuDelai(issue.date_limite_sla));
    if (e === 'recurrence') setChoix(issue.issue_origine_id ?? '');
    setEditeur(e);
  };

  const envoyer = async (e: Envoi) => {
    if (enCours.current) return;
    enCours.current = true;
    derniere.current = e;
    setEnvoi(true); setEchec(null);
    const r = await envoyerDelaiRecurrence(issuesApi.modifierDelaiRecurrence, issue.id, e.charge);
    enCours.current = false;
    setEnvoi(false);
    if (r.type === 'succes') {
      setEditeur(null); setErreur(null);
      rendreFocus();
      void onChange(issue.id, e.message);
    } else if (r.nature === 'disparu') {
      setEditeur(null);
      void onChange(issue.id, r.message);
    } else {
      setEchec({ nature: r.nature, message: r.message });   // saisie conservée : l'éditeur reste ouvert
    }
  };

  const soumettreDelai = () => {
    const e = validerDelai(jour, issue.premiere_detection);
    setErreur(e);
    if (e) return;
    void envoyer({ charge: { date_limite_sla: delaiVersIso(jour) }, message: `Délai de traitement fixé au ${shortDate(delaiVersIso(jour))}` });
  };
  const soumettreOrigine = () => {
    const e = choix ? null : 'Choisissez un problème d’origine, ou annulez.';
    setErreur(e);
    if (e) return;
    void envoyer({ charge: { issue_origine_id: choix }, message: 'Problème lié comme récidive' });
  };

  return (
    <Section titre="Délai et récurrence">
      <div ref={racine} className="pb-dr">
        <div className="pb-dr__liste">
          <div className="pb-dr__ligne">
            <dl className="pb-dr__terme">
              <dt>Délai de traitement</dt>
              <dd>
                {!issue.date_limite_sla && 'Aucun délai fixé'}
                {issue.date_limite_sla && delai?.etat === 'depasse' && (
                  <span className="pb-dr__retard">{`Dépassé${delai.jours > 0 ? ` depuis ${libelleJours(delai.jours)}` : ' aujourd’hui'} (échéance le ${shortDate(delai.date)})`}</span>
                )}
                {issue.date_limite_sla && delai?.etat === 'a_venir' && (
                  <>À traiter avant le <time dateTime={delai.date} title={fullDate(delai.date)}>{shortDate(delai.date)}</time></>
                )}
                {issue.date_limite_sla && !delai && (
                  <>Fixé au <time dateTime={issue.date_limite_sla} title={fullDate(issue.date_limite_sla)}>{shortDate(issue.date_limite_sla)}</time></>
                )}
              </dd>
            </dl>
            {peutModifier && modifiable && editeur !== 'delai' && (
              <div className="pb-dr__actions">
                <Button variant="secondary" size="sm" data-retour="delai" onClick={() => ouvrir('delai')}>{issue.date_limite_sla ? 'Modifier le délai' : 'Fixer un délai'}</Button>
                {issue.date_limite_sla && <Button variant="ghost" size="sm" disabled={envoi} onClick={() => void envoyer({ charge: { date_limite_sla: null }, message: 'Délai de traitement effacé' })}>Effacer le délai</Button>}
              </div>
            )}
          </div>
          {peutModifier && !modifiable && <p className="alerte-dialogue__aide">Le problème est résolu : son délai ne peut plus être modifié.</p>}
          {peutModifier && editeur === 'delai' && (
            <EditeurDelai id={`${base}-delai`} jour={jour} min={jourLocal(new Date(issue.premiere_detection))} erreur={erreur} envoi={envoi} onChange={setJour} onSoumettre={soumettreDelai} onAnnuler={fermer} />
          )}

          <div className="pb-dr__ligne">
            <dl className="pb-dr__terme">
              <dt>Récurrence</dt>
              <dd>
                {!issue.issue_origine_id && 'Aucun problème d’origine lié'}
                {issue.issue_origine_id && (
                  <>
                    Récidive d’un problème précédent
                    {onOuvrirOrigine && (
                      <>
                        {' · '}
                        <button type="button" className="ui-item__link pb-lien" onClick={() => onOuvrirOrigine(issue.issue_origine_id as string)}>Voir ce problème</button>
                      </>
                    )}
                  </>
                )}
              </dd>
            </dl>
            {peutModifier && editeur !== 'recurrence' && (
              <div className="pb-dr__actions">
                <Button variant="secondary" size="sm" data-retour="recurrence" onClick={() => ouvrir('recurrence')}>{issue.issue_origine_id ? 'Changer l’origine' : 'Lier un problème d’origine'}</Button>
                {issue.issue_origine_id && <Button variant="ghost" size="sm" disabled={envoi} onClick={() => void envoyer({ charge: { issue_origine_id: null }, message: 'Lien de récidive retiré' })}>Retirer le lien</Button>}
              </div>
            )}
          </div>
          {peutModifier && editeur === 'recurrence' && (
            <EditeurOrigine
              id={`${base}-origine`} candidats={candidats} propositions={propositions} choix={choix} erreur={erreur} envoi={envoi}
              onChange={setChoix} onSoumettre={soumettreOrigine} onAnnuler={fermer} onRecharger={recharger}
            />
          )}
        </div>

        {!peutModifier && <p className="pb-dr__qui">{PHRASE_QUI_DECIDE}</p>}
        {echec && (
          <Alert
            tone="critical"
            title={echec.message}
            action={echec.nature === 'serveur' ? <Button size="sm" variant="secondary" disabled={envoi} onClick={() => derniere.current && void envoyer(derniere.current)}>Réessayer</Button> : undefined}
          />
        )}
      </div>
    </Section>
  );
}
