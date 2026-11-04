import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import YamEtatVide from '../../components/agent/YamEtatVide';
import { YAM_PRESENCE } from '../../config';
import { useAuthStore } from '../../stores/authStore';
import type { ActionCorrective, Agence, IssueDetail } from '../../types';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { StatsErrorState } from '../../components/stats/StatsStates';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import PanneauProbleme from '../../components/issues/PanneauProbleme';
import TerminerActionDialog from '../../components/issues/TerminerActionDialog';
import { BarreFiltresActions, LigneActionItem, idOuvrirProbleme } from '../../components/issues/ActionsUnifiees';
import { useMediaQuery } from '../../components/ui/useMediaQuery';
import { REQUETE_PANNEAU_ANCRE } from './PilotageIssuesTab';
import {
  NOTE_TERMINEES,
  TEXTE_VIDE_EN_COURS_AGENCE,
  TEXTE_VIDE_EN_COURS_RESEAU,
  TEXTE_VIDE_TERMINEES,
  aDesFiltresActions,
  libelleChargement,
  type FiltresActions,
  type LigneAction,
} from '../../utils/actionsUnifiees';

interface Props {
  isAgencyManager: boolean;
  agencesList: Agence[];
  filtres: FiltresActions;
  setFiltres: (suite: Partial<FiltresActions>) => void;
  lignes: LigneAction[];
  total: number;
  autreTotal: number;
  chargement: boolean;
  premierChargement: boolean;
  erreur: boolean;
  chargementSuite: boolean;
  partiel: boolean;
  recharger: () => void;
  chargerSuite: () => void;
  /** Confirme qu'une action sur un AVIS est réalisée (fiche de l'avis). */
  confirmerAvis: (avisId: string) => Promise<void>;
  /** Une action de problème vient d'être terminée (ou n'existe plus) : annonce le résultat et rafraîchit. */
  apresTerminaison: (issueId: string, message: string) => Promise<void> | void;
  // Panneau du problème d'origine (même panneau que « Problèmes à traiter »)
  openIssueDetail: (id: string) => Promise<void>;
  selectedIssueId: string | null;
  issueDetail: IssueDetail | null;
  issueDetailLoading: boolean;
  closeIssueDetail: () => void;
  apresActionIssue: (issueId: string, message: string) => Promise<void>;
  verifierIssue: (issueId: string) => Promise<void>;
}

/**
 * « Actions à mener » : une liste unique qui agrège les actions décidées sur un AVIS et celles d'un PROBLÈME, avec le type visible sur chaque ligne. Un problème
 * s'ouvre dans le panneau (la liste reste visible) ; un avis, dans « Avis clients ». Terminer une action de problème passe par la confirmation de la fiche du problème.
 */
export default function PilotageActionsTab(props: Props) {
  const { isAgencyManager, agencesList, filtres, setFiltres, lignes, total, autreTotal, chargement, premierChargement, erreur, chargementSuite, partiel, recharger, chargerSuite,
    confirmerAvis, apresTerminaison, openIssueDetail, selectedIssueId, issueDetail, issueDetailLoading, closeIssueDetail, apresActionIssue, verifierIssue } = props;
  const moi = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const panneauAncre = useMediaQuery(REQUETE_PANNEAU_ANCRE);
  const maintenant = useMemo(() => Date.now(), [lignes]);
  const enCours = filtres.segment === 'en_cours';
  const [aTerminer, setATerminer] = useState<LigneAction | null>(null);
  const [avisAConfirmer, setAvisAConfirmer] = useState<string | null>(null);
  const [avisOccupe, setAvisOccupe] = useState<string | null>(null);
  const ouvert = selectedIssueId !== null;
  const ligneDuProbleme = lignes.find((l) => l.issueId === selectedIssueId) ?? null;

  // Fermer le panneau rend le focus au bouton « Voir le problème » d'où l'on venait.
  const declencheur = useRef<string | null>(null);
  const ouvrirProbleme = (issueId: string, cle: string) => { declencheur.current = idOuvrirProbleme(cle); void openIssueDetail(issueId); };
  const fermer = () => closeIssueDetail();
  useEffect(() => {
    if (selectedIssueId === null && declencheur.current) {
      document.getElementById(declencheur.current)?.focus();
      declencheur.current = null;
    }
  }, [selectedIssueId]);

  const confirmer = async (id: string) => {
    setAvisOccupe(id);
    try {
      await confirmerAvis(id);
    } finally {
      setAvisOccupe(null);
      setAvisAConfirmer(null);
    }
  };

  const actionPourDialogue = (l: LigneAction | null): ActionCorrective | null =>
    l ? ({ id: l.id, issue_id: l.issueId ?? '', titre: l.titre, statut: 'creee', created_at: '', updated_at: '' } as ActionCorrective) : null;

  const filtresActifs = aDesFiltresActions(filtres);
  const sansFiltre = !filtresActifs && !filtres.agenceId;
  const chargees = libelleChargement(lignes.length, total);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {!isAgencyManager && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <AgenceFilterSelect agences={agencesList} selectedId={filtres.agenceId} onChange={(id) => setFiltres({ agenceId: id })} />
        </div>
      )}

      <div className={`pb-mise-en-page${ouvert && panneauAncre ? ' pb-mise-en-page--panneau' : ''}`}>
        <section aria-label="Actions à mener" className="pb-liste">
          <BarreFiltresActions
            filtres={filtres}
            onChange={setFiltres}
            totalEnCours={premierChargement && !erreur ? (enCours ? total : autreTotal) : null}
            totalTerminees={premierChargement && !erreur ? (enCours ? autreTotal : total) : null}
          />
          <p role="status" className="ui-sr-only">{premierChargement && !erreur && !chargement ? (total === 0 ? 'Aucune action.' : `${total} action${total > 1 ? 's' : ''}.`) : ''}</p>
          {!enCours && !erreur && <p className="pb-note">{NOTE_TERMINEES}</p>}
          {!erreur && premierChargement && chargees && <p className="pb-note">{chargees} Les filtres portent sur l’ensemble des actions.</p>}

          {erreur ? (
            <StatsErrorState message="Impossible de charger les actions. Cela ne signifie pas qu’il n’y en a pas." onRetry={recharger} />
          ) : chargement ? (
            <div aria-busy="true" aria-label="Chargement des actions à mener" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[0, 1, 2].map((i) => <SkeletonBlock key={i} height={110} radius="var(--radius-xl)" />)}
            </div>
          ) : lignes.length === 0 && enCours && sansFiltre && YAM_PRESENCE ? (
            <Card tone="success" padding="none">
              <YamEtatVide
                titre="Aucune action en cours."
                texte={isAgencyManager ? TEXTE_VIDE_EN_COURS_AGENCE : TEXTE_VIDE_EN_COURS_RESEAU}
                action={{ label: 'Voir les problèmes à traiter', onClick: () => navigate('/issues') }}
              />
            </Card>
          ) : lignes.length === 0 ? (
            <Card padding="none">
              {sansFiltre ? (
                <EmptyState
                  illustration="no-alert"
                  title={enCours ? 'Aucune action en cours' : 'Aucune action terminée pour l’instant'}
                  message={enCours ? (isAgencyManager ? TEXTE_VIDE_EN_COURS_AGENCE : TEXTE_VIDE_EN_COURS_RESEAU) : TEXTE_VIDE_TERMINEES}
                />
              ) : (
                <EmptyState
                  illustration="no-alert"
                  title="Aucune action pour ces filtres"
                  message="Élargissez le type, retirez « En retard » ou « Mes actions », ou choisissez toutes les agences."
                  action={{ label: 'Effacer les filtres', onClick: () => setFiltres({ type: 'tous', enRetard: false, mesActions: false, agenceId: null }) }}
                />
              )}
            </Card>
          ) : (
            <>
              <ul className="pb-liste-actions">
                {lignes.map((l) => (
                  <LigneActionItem
                    key={l.cle}
                    ligne={l}
                    afficherAgence={!isAgencyManager}
                    role={moi?.role}
                    moiId={moi?.id}
                    maintenant={maintenant}
                    problemeOuvertId={selectedIssueId}
                    onOuvrirProbleme={(issueId) => ouvrirProbleme(issueId, l.cle)}
                    onTerminer={setATerminer}
                    confirmationAvis={l.origine === 'avis' ? {
                      ouverte: avisAConfirmer === l.id, occupe: avisOccupe === l.id,
                      onDemander: () => setAvisAConfirmer(l.id), onConfirmer: () => void confirmer(l.id), onAnnuler: () => setAvisAConfirmer(null),
                    } : undefined}
                  />
                ))}
              </ul>
              {partiel && (
                <Button variant="secondary" onClick={chargerSuite} loading={chargementSuite} style={{ alignSelf: 'center' }}>
                  {chargementSuite ? 'Chargement…' : `Charger plus (${lignes.length}/${total})`}
                </Button>
              )}
            </>
          )}
        </section>

        {ouvert && (
          <PanneauProbleme
            issue={issueDetail}
            loading={issueDetailLoading}
            titreProvisoire={ligneDuProbleme?.issueTitre}
            agenceProvisoire={ligneDuProbleme?.agenceNom ?? undefined}
            mode={panneauAncre ? 'ancre' : 'plein'}
            onClose={fermer}
            onActionsChange={apresActionIssue}
            onVerifier={verifierIssue}
            onOuvrirOrigine={(id) => { void openIssueDetail(id); }}
          />
        )}
      </div>

      <TerminerActionDialog
        action={actionPourDialogue(aTerminer)}
        issueId={aTerminer?.issueId ?? ''}
        derniere={!!aTerminer?.derniereAFaire}
        onFermer={() => setATerminer(null)}
        onTerminee={() => { const l = aTerminer; setATerminer(null); if (l?.issueId) void apresTerminaison(l.issueId, 'Action marquée comme terminée'); }}
        onDisparue={(message) => { const l = aTerminer; setATerminer(null); if (l?.issueId) void apresTerminaison(l.issueId, message); }}
      />
    </div>
  );
}
