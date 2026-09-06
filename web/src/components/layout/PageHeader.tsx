/**
 * En-tête des pages intérieures : sur-titre, H1, mention. Rien à afficher → rien n'est rendu :
 * un `page_title` non saisi ne doit pas laisser un bandeau vide (brief §10).
 */
export default function PageHeader({
  eyebrow,
  title,
  note,
}: {
  eyebrow?: string;
  title?: string;
  note?: string;
}) {
  if (!eyebrow && !title && !note) return null;

  return (
    <div className="shell pt-14 pb-4 sm:pt-20">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      {title && <h1 className="title mt-3 max-w-3xl">{title}</h1>}
      {note && <p className="lede mt-4 max-w-2xl">{note}</p>}
    </div>
  );
}
