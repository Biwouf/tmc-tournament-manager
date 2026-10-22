// Balle de tennis (même dessin que la balle de la page 404 du site vitrine).
// Copie BO/PWA à garder synchronisée.
import { useId } from 'react';

export default function TennisBall({ className, label }: { className?: string; label?: string }) {
  const clip = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      <defs>
        <clipPath id={clip}>
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="11" fill="#c8e02e" />
      <g clipPath={`url(#${clip})`} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
        <path d="M5 2.5c3.2 2.5 5 5.8 5 9.5s-1.8 7-5 9.5" />
        <path d="M19 2.5c-3.2 2.5-5 5.8-5 9.5s1.8 7 5 9.5" />
      </g>
      <circle cx="12" cy="12" r="11" fill="none" stroke="rgb(0 0 0 / 0.18)" strokeWidth="1" />
    </svg>
  );
}
