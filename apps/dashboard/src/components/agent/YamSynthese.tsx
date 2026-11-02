import React, { useMemo } from 'react';
import { YAM_PRESENCE } from '../../config';
import { useAuthStore } from '../../stores/authStore';
import { useYamStore } from '../../stores/yamStore';
import Button from '../ui/Button';
import { construireSynthese, type EntreesSynthese } from './construireSynthese';
import YamMascot from './YamMascot';
import './yamPresence.css';

/**
 * Bande de synthèse de YAM (Vue réseau, CX Manager UNIQUEMENT : ni Agency Manager, ni Administrateur, qui ne reçoit jamais de
 * recommandation opérationnelle de YAM). Calculée depuis des données déjà chargées ; « Voir pourquoi » ouvre le panneau avec une question
 * PRÉREMPLIE, jamais envoyée automatiquement.
 */
export default function YamSynthese({ entrees }: { entrees: EntreesSynthese }) {
  const role = useAuthStore((s) => s.user?.role);
  const ouvrirAvec = useYamStore((s) => s.ouvrirAvec);
  const synthese = useMemo(() => construireSynthese(entrees), [entrees]);
  if (!YAM_PRESENCE || role !== 'cx_manager' || !synthese.message) return null;
  return (
    <section className="yam-synthese" aria-label="Synthèse de YAM">
      <YamMascot variant="tete" state="accueil" size={56} />
      <div className="yam-synthese__texte">
        <h2 className="yam-synthese__titre">YAM · {synthese.periode}</h2>
        <p className="yam-synthese__message">{synthese.message}</p>
      </div>
      <Button variant="secondary" onClick={() => ouvrirAvec(synthese.question)}>Voir pourquoi</Button>
    </section>
  );
}
