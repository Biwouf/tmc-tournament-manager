import { useEffect, useState } from 'react';
import { pwaUrl } from '../../lib/pwaUrl';
import { useSite } from '../../contexts/SiteContext';

const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000;

/** Le prompt natif appartient à l'origine PWA ; la vitrine propose seulement le passage. */
export default function PwaInstallBridge() {
  const { club, clubName } = useSite();
  const [visible, setVisible] = useState(false);
  const storageKey = `feelike:${club.id}:pwaBridgeDismissedAt`;
  const href = pwaUrl(club.slug);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone) return;
    try {
      const timestamp = Number(window.localStorage.getItem(storageKey));
      const elapsed = Date.now() - timestamp;
      if (timestamp > 0 && elapsed >= 0 && elapsed < DISMISS_TTL) return;
    } catch {
      // Le stockage peut être indisponible ; la fermeture reste possible en mémoire.
    }
    // La préférence locale ne peut être lue qu'après l'hydratation du HTML serveur.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
  }, [storageKey]);

  if (!visible || !href || club.status !== 'active') return null;

  function dismiss() {
    try { window.localStorage.setItem(storageKey, String(Date.now())); } catch { /* stockage bloqué */ }
    setVisible(false);
  }

  return (
    <aside aria-label="Application du club" className="border-b border-line bg-brand-soft md:hidden">
      <div className="shell relative py-4 pr-16">
        <p className="font-extrabold">{clubName} sur votre mobile</p>
        <p className="mt-1 text-sm leading-relaxed">
          Retrouvez la vie du club dans l’application adhérents et ajoutez-la à votre écran d’accueil.
        </p>
        <a href={href} onClick={dismiss} className="btn btn-primary mt-3">Ouvrir l’application</a>
        <button type="button" onClick={dismiss} aria-label="Masquer la proposition d’installation pendant 7 jours"
          className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-brand/10">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </aside>
  );
}
