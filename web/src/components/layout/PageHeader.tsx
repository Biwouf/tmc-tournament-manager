import { useLocation } from 'react-router-dom';
import { useSite } from '../../contexts/SiteContext';
import { pageAt, pageHeading } from '../../lib/site';

/**
 * En-tête des pages intérieures : H1 dérivé de la page et du club si non saisi.
 */
export default function PageHeader({
  overline,
  title,
  note,
  narrowTitle = false,
}: {
  /** En dur, jamais de la config — cf. le tableau du brief PR9-bis §1. */
  overline: string;
  title?: string;
  note?: string;
  /** `max-width:18ch` sur le H1 — seule la page club le porte (maquette 1736). */
  narrowTitle?: boolean;
}) {
  const site = useSite();
  const { pathname } = useLocation();
  const page = pageAt(pathname);
  title = title?.trim() || (page ? pageHeading(site, page) : site.clubName);

  return (
    <div className="shell pt-16">
      <span className="eyebrow">{overline}</span>
      {title && <h1 className={`page-h1 ${narrowTitle ? 'max-w-[18ch]' : ''}`}>{title}</h1>}
      {note && <p className="mt-3.5 max-w-[54ch] text-[16px] text-muted">{note}</p>}
    </div>
  );
}
