import React, { useCallback, useEffect, useState } from 'react';
import { adminJournalApi, type FiltresJournal } from '../../services/api';
import type { JournalAuditEntree } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import { userFacingError } from '../../utils/userFacingError';
import { LIBELLES_ACTION, libelleAction, libelleCible, libelleResultat, libelleRoleJournal, resumeDetails } from '../../utils/journalAudit';

const TAILLE_PAGE = 50;

const dateFr = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
};

const COLONNES: DataTableColumn<JournalAuditEntree>[] = [
  { key: 'date', header: 'Date', render: (l) => dateFr(l.date_action), width: 150 },
  {
    key: 'acteur',
    header: 'Acteur',
    render: (l) => (
      <>
        <div>{l.acteur_email ?? '—'}</div>
        <div style={{ fontSize: 12, color: '#5F6B5F' }}>{libelleRoleJournal(l.acteur_role)}</div>
      </>
    ),
  },
  { key: 'action', header: 'Action', render: (l) => libelleAction(l.action) },
  {
    key: 'cible',
    header: 'Élément concerné',
    render: (l) => {
      const type = libelleCible(l.cible_type);
      return [type, l.cible_libelle].filter(Boolean).join(' · ') || '—';
    },
  },
  { key: 'resultat', header: 'Résultat', render: (l) => libelleResultat(l.resultat), width: 100 },
  { key: 'details', header: 'Détail', render: (l) => resumeDetails(l.details) || '—' },
];

/** Vue pure (testable sans réseau) : erreur serveur, chargement, état vide, tableau. Aucune action d'écriture. */
export function JournalVue({ lignes, chargement, erreur, onReessayer }: { lignes: JournalAuditEntree[]; chargement: boolean; erreur: string; onReessayer?: () => void }) {
  return (
    <>
      {erreur && (
        <Alert tone="critical" title="Journal indisponible" action={onReessayer ? <Button variant="secondary" onClick={onReessayer}>Réessayer</Button> : undefined}>
          {erreur}
        </Alert>
      )}
      {!erreur && (
        <DataTable
          caption="Journal d’audit des actions d’administration"
          columns={COLONNES}
          rows={lignes}
          rowKey={(l) => l.id}
          loading={chargement}
          emptyTitle="Aucune action enregistrée"
          emptyMessage="Aucune entrée ne correspond à ces filtres pour le moment."
        />
      )}
    </>
  );
}

export default function AdminJournalPage() {
  const [lignes, setLignes] = useState<JournalAuditEntree[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [action, setAction] = useState('');
  const [resultat, setResultat] = useState('');
  const [acteur, setActeur] = useState('');
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    const params: FiltresJournal = { limit: TAILLE_PAGE, offset: page * TAILLE_PAGE };
    if (action) params.action = action;
    if (resultat) params.resultat = resultat;
    if (acteur.trim()) params.acteur_email = acteur.trim();
    if (debut) params.date_debut = `${debut}T00:00:00`;
    if (fin) params.date_fin = `${fin}T23:59:59`;
    try {
      const reponse = await adminJournalApi.lire(params);
      setLignes(reponse.data);
      setTotal(Number(reponse.headers?.['x-total-count'] ?? reponse.data.length) || 0);
    } catch (e) {
      setLignes([]);
      setTotal(0);
      setErreur(userFacingError(e, 'Impossible de charger le journal d’audit. Veuillez réessayer.', undefined, { 403: 'Ce journal est réservé aux administrateurs.' }));
    } finally {
      setChargement(false);
    }
  }, [page, action, resultat, acteur, debut, fin]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const changer = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    fn(e.target.value);
    setPage(0);
  };
  const pages = Math.max(1, Math.ceil(total / TAILLE_PAGE));
  const champ: React.CSSProperties = { minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #D5DBD2', width: '100%', boxSizing: 'border-box' };

  return (
    <div>
      <PageHeader title="Journal d’audit" subtitle="Historique en lecture seule des actions d’administration : qui a fait quoi, quand, avec quel résultat." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '16px 0' }}>
        <label>Action
          <select style={champ} value={action} onChange={changer(setAction)}>
            <option value="">Toutes les actions</option>
            {Object.entries(LIBELLES_ACTION).map(([code, libelle]) => <option key={code} value={code}>{libelle}</option>)}
          </select>
        </label>
        <label>Résultat
          <select style={champ} value={resultat} onChange={changer(setResultat)}>
            <option value="">Tous</option>
            <option value="succes">Réussie</option>
            <option value="refus">Refusée</option>
          </select>
        </label>
        <label>E-mail de l’acteur
          <input style={champ} type="email" value={acteur} onChange={changer(setActeur)} />
        </label>
        <label>Du
          <input style={champ} type="date" value={debut} onChange={changer(setDebut)} />
        </label>
        <label>Au
          <input style={champ} type="date" value={fin} onChange={changer(setFin)} />
        </label>
      </div>
      <JournalVue lignes={lignes} chargement={chargement} erreur={erreur} onReessayer={charger} />
      {!erreur && total > TAILLE_PAGE && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
          <Button variant="secondary" disabled={page === 0 || chargement} onClick={() => setPage(page - 1)}>Précédent</Button>
          <span>Page {page + 1} sur {pages}</span>
          <Button variant="secondary" disabled={page + 1 >= pages || chargement} onClick={() => setPage(page + 1)}>Suivant</Button>
        </div>
      )}
    </div>
  );
}
