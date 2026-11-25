import { useState } from 'react';
import { avatarTone, initials } from '../../../shared/accountCopy.mjs';

// Paires fond / texte (brief compte/profil §5.4) : contraste d'au moins 7:1, indépendantes du thème du club.
const TONES: Record<number, { background: string; color: string }> = {
  1: { background: '#F3E1DC', color: '#7A2E22' },
  2: { background: '#E0ECDF', color: '#2D5A2B' },
  3: { background: '#DCE7F3', color: '#23466E' },
  4: { background: '#EDE3F4', color: '#57307A' },
  5: { background: '#F5EBD3', color: '#6B4A0E' },
  6: { background: '#DDEFEF', color: '#1F5E5E' },
};

export type AvatarPerson = { id: string; prenom?: string | null; nom?: string | null };

export type AvatarSize = 24 | 26 | 32 | 36 | 40 | 88 | 96;

/** Photo posée sur les initiales : invisible tant qu'elle n'est pas chargée, ou en cas d'erreur. */
function Photo({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img src={src} alt="" loading="lazy" decoding="async" draggable={false}
      onLoad={() => setLoaded(true)} onError={() => setLoaded(false)}
      className={`absolute inset-0 h-full w-full object-cover ${loaded ? '' : 'opacity-0'}`} />
  );
}

/**
 * Rond d'une personne ; `null` (nom pas encore connu) : rond neutre, sans initiales provisoires.
 * `src` : URL signée de la photo (`useAvatarUrls`) ; sans elle, les initiales.
 * Décoratif (`aria-hidden`) : le nom est écrit à côté, ou le bouton qui l'entoure a son libellé.
 */
export default function Avatar({ person, size, src }: { person: AvatarPerson | null; size: AvatarSize; src?: string }) {
  if (!person) return <span aria-hidden="true" className="inline-block shrink-0 rounded-full bg-muted" style={{ width: size, height: size }} />;
  const text = initials(person.prenom, person.nom);
  return (
    <span aria-hidden="true"
      className="relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-bold"
      style={{ ...TONES[avatarTone(person.id)], width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {text}
      {/* Même fichier re-signé (seul le jeton change) : la photo déjà affichée reste en place. */}
      {src && <Photo key={src.split('?')[0]} src={src} />}
    </span>
  );
}
