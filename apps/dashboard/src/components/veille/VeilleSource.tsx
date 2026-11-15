import React from 'react';
import type { VeilleFacebookPage, VeilleFacebookStatus } from '../../types';
import Button from '../ui/Button';
import { AlertTriangleIcon, CheckCircleIcon, ExternalLinkIcon, MegaphoneIcon, RefreshCwIcon, WifiSlashIcon } from '../common/Icons';
import { jourComplet } from '../../utils/dateJour';

export type EtatSource = 'chargement' | 'hors-ligne' | 'pages-inconnues' | 'sans-page' | 'a-renouveler' | 'connectee';

/** L'état de la source, déduit du statut renvoyé par l'API (une seule source de vérité pour la page). */
export function etatSource(status: VeilleFacebookStatus | null | undefined): EtatSource {
  if (status === undefined) return 'chargement';
  if (!status || status.service !== 'online') return 'hors-ligne';
  if (!status.pages_disponibles) return 'pages-inconnues';
  if (status.pages.length === 0) return 'sans-page';
  return status.pages.some((p) => p.status === 'active' && !p.needs_attention) ? 'connectee' : 'a-renouveler';
}

/** « il y a 3 h », « il y a 2 j », « à l'instant » : depuis la dernière collecte. */
export function depuis(iso: string | null, maintenant: Date = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const minutes = Math.max(0, Math.round((maintenant.getTime() - t) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return `il y a ${Math.round(heures / 24)} j`;
}

interface Props {
  status: VeilleFacebookStatus | null | undefined;
  collecte: boolean;
  connexion: boolean;
  onCollecter: () => void;
  onConnecter: () => void;
}

/**
 * Bandeau « Source » : d'où viennent les mentions, dans quel état est la connexion, et l'action utile à cet instant.
 * Remplace les badges flottants et les deux boutons de l'en-tête : un seul endroit, une seule action principale.
 */
export default function VeilleSource({ status, collecte, connexion, onCollecter, onConnecter }: Props) {
  const etat = etatSource(status);
  if (etat === 'chargement') return <div className="veille-source veille-source--chargement" aria-hidden="true" />;

  const pages: VeilleFacebookPage[] = status?.pages ?? [];
  const page = pages.find((p) => p.status === 'active' && !p.needs_attention) ?? pages[0];
  const derniere = page ? depuis(page.last_sync_at) : null;

  const contenu: Record<Exclude<EtatSource, 'chargement'>, { icone: React.ReactNode; ton: string; titre: string; detail: React.ReactNode; actions?: React.ReactNode }> = {
    'hors-ligne': {
      icone: <WifiSlashIcon size={18} />, ton: 'critique',
      titre: 'Collecte indisponible',
      detail: 'Le service de veille ne répond pas. Les mentions déjà collectées restent consultables ; la collecte reprendra dès son retour.',
    },
    'pages-inconnues': {
      icone: <AlertTriangleIcon size={18} />, ton: 'surveiller',
      titre: 'État de la Page Facebook inconnu',
      detail: 'Le service répond, mais la liste des Pages connectées n’a pas pu être lue. Réessayez dans quelques minutes.',
    },
    'sans-page': {
      icone: <MegaphoneIcon size={18} />, ton: 'neutre',
      titre: 'Aucune Page Facebook connectée',
      detail: 'Connectez la Page de votre entreprise : IKAN AI y lira les commentaires publics et en analysera le ton et le thème.',
      actions: <Button size="sm" iconEnd={<ExternalLinkIcon size={14} />} loading={connexion} onClick={onConnecter}>Connecter ma Page Facebook</Button>,
    },
    'a-renouveler': {
      icone: <AlertTriangleIcon size={18} />, ton: 'surveiller',
      titre: `Facebook · ${page?.page_name ?? 'Page'} : session à renouveler`,
      detail: 'L’accès accordé par Facebook a expiré. Reconnectez la Page pour reprendre la collecte.',
      actions: <Button size="sm" iconEnd={<ExternalLinkIcon size={14} />} loading={connexion} onClick={onConnecter}>Reconnecter la Page</Button>,
    },
    connectee: {
      icone: <CheckCircleIcon size={18} />, ton: 'bon',
      titre: `Facebook · Page « ${page?.page_name ?? ''} » connectée`,
      detail: derniere
        ? <>Dernière collecte <time dateTime={page?.last_sync_at ?? undefined} title={page?.last_sync_at ? jourComplet(page.last_sync_at) : undefined}>{derniere}</time>.</>
        : 'Aucune collecte encore effectuée.',
      actions: (
        <>
          <Button size="sm" icon={<RefreshCwIcon size={14} />} loading={collecte} disabled={connexion} onClick={onCollecter}>Collecter maintenant</Button>
          <Button size="sm" variant="ghost" iconEnd={<ExternalLinkIcon size={14} />} loading={connexion} disabled={collecte} onClick={onConnecter}>Reconnecter</Button>
        </>
      ),
    },
  };
  const c = contenu[etat];

  return (
    <section className={`veille-source veille-source--${c.ton}`} aria-label="Source des mentions">
      <span className="veille-source__icone" aria-hidden="true">{c.icone}</span>
      <div className="veille-source__texte">
        <p className="veille-source__titre">{c.titre}</p>
        <p className="veille-source__detail">{c.detail}</p>
      </div>
      {c.actions && <div className="veille-source__actions">{c.actions}</div>}
    </section>
  );
}
