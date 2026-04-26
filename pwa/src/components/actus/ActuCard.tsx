// Carte d'une actu dans la liste — image, titre, extrait, date.
// Clic → navigation vers /actus/:id

import { Link } from 'react-router-dom';
import type { Actu } from '../../types';

interface Props {
  actu: Actu;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function excerpt(markdown: string, maxLength = 120): string {
  // Supprime les marqueurs Markdown simples pour l'extrait
  const plain = markdown.replace(/[#*_`>\-[\]()]/g, '').replace(/\n+/g, ' ').trim();
  return plain.length > maxLength ? plain.slice(0, maxLength) + '…' : plain;
}

export default function ActuCard({ actu }: Props) {
  const cover = actu.image_urls[0];
  return (
    <Link to={`/actus/${actu.id}`} className="block bg-card rounded-xl overflow-hidden shadow-sm border border-border active:opacity-80 transition-opacity">
      {cover && (
        <img
          src={cover}
          alt={actu.titre}
          className="w-full h-40 object-cover"
        />
      )}
      <div className="p-4 flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">{formatDate(actu.published_at)}</p>
        <h2 className="font-semibold text-foreground text-base leading-snug">{actu.titre}</h2>
        <p className="text-sm text-muted-foreground line-clamp-2">{excerpt(actu.contenu)}</p>
      </div>
    </Link>
  );
}
