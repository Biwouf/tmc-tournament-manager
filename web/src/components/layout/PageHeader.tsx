/**
 * En-tête des pages intérieures (maquette 1734-1737, 1831-1834, 1886-1889, 1958-1961).
 *
 * Deux niveaux : un SUR-TITRE en dur, propre à la page, puis `*.page_title` en H1 sous lui.
 * Le sur-titre nomme la page (« Le club ») ; le H1 porte l'accroche que le club a écrite —
 * c'est pour ça qu'il est le seul des deux à venir de la config.
 *
 * Conséquence sur la règle §10 de PR9 : `page_title` vide fait disparaître le H1, **pas**
 * l'en-tête. Le sur-titre est en dur, il ne peut pas manquer, et un bandeau qui ne porte que le
 * nom de la page n'est pas un bloc creux. Le composant ne rend donc jamais `null`.
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
  return (
    <div className="shell pt-16">
      <span className="eyebrow">{overline}</span>
      {title && <h1 className={`page-h1 ${narrowTitle ? 'max-w-[18ch]' : ''}`}>{title}</h1>}
      {note && <p className="mt-3.5 max-w-[54ch] text-[16px] text-muted">{note}</p>}
    </div>
  );
}
