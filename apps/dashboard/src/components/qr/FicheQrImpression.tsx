import React from 'react';
import { createPortal } from 'react-dom';
import QrCodeSvg from './QrCodeSvg';
import './ficheQr.css';

export const PHRASE_INVITATION_QR = 'Scannez pour donner votre avis';
export const CLASSE_IMPRESSION_QR = 'impression-qr';

/** Contenu de la feuille : nom de l'agence, invitation, QR en grand, adresse en clair pour ceux qui ne peuvent pas scanner. */
export function FicheQrContenu({ nom, url }: { nom: string; url: string }) {
  return (
    <section className="fiche-qr" aria-label={`Fiche QR code de ${nom}`}>
      <p className="fiche-qr__marque">IKAN AI</p>
      <h1 className="fiche-qr__nom">{nom}</h1>
      <p className="fiche-qr__invitation">{PHRASE_INVITATION_QR}</p>
      <div className="fiche-qr__code">
        <QrCodeSvg url={url} taille="100%" titre={`QR code de ${nom}`} />
      </div>
      <p className="fiche-qr__url">{url}</p>
      <p className="fiche-qr__aide">Vous ne pouvez pas scanner ? Saisissez l’adresse ci-dessus dans le navigateur de votre téléphone.</p>
    </section>
  );
}

/**
 * Feuille d'impression, rattachée à <body> et invisible à l'écran. Elle n'apparaît qu'à l'impression déclenchée par
 * `imprimerFicheQr()` (classe `impression-qr` sur <html>) : tout le reste du dashboard (menu, boutons…) est alors masqué.
 */
export default function FicheQrImpression({ nom, url }: { nom: string; url: string }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fiche-qr-impression" aria-hidden="true">
      <FicheQrContenu nom={nom} url={url} />
    </div>,
    document.body,
  );
}

/** Ouvre la boîte d'impression sur la seule feuille QR ; l'état d'impression est retiré à la fermeture de la boîte. */
export function imprimerFicheQr(): void {
  const racine = document.documentElement;
  const fin = () => {
    racine.classList.remove(CLASSE_IMPRESSION_QR);
    window.removeEventListener('afterprint', fin);
  };
  racine.classList.add(CLASSE_IMPRESSION_QR);
  window.addEventListener('afterprint', fin);
  window.print();
}
