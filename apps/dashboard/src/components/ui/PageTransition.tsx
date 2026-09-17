import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';

/**
 * PageTransition — wrapper de transition de page
 *
 * Usage : envelopper le contenu d'une page ou l'<Outlet> du layout.
 *
 * Spec :
 *  - Fade-in + translateY 8px → 0 au montage (~250ms ease-out)
 *  - Pas de transition de sortie bloquante (exit instant)
 *  - Clé = pathname → déclenche l'animation à chaque changement de route
 */

interface PageTransitionProps {
  children: React.ReactNode;
}

const VARIANTS = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

const TRANSITION = {
  duration: 0.25,
  ease: [0.25, 0.1, 0.25, 1.0] as [number, number, number, number],
};

export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial="hidden"
        animate="visible"
        exit={{ opacity: 0, y: 0, transition: { duration: 0 } }}
        variants={VARIANTS}
        transition={TRANSITION}
        style={{ width: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
