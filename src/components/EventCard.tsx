import { Link } from 'react-router-dom';
import type { ClubEvent, EventType } from '../types';

interface Props {
  event: ClubEvent;
  onDelete: () => void;
  onDuplicate: () => void;
}

const TYPE_COLORS: Record<EventType, string> = {
  Animation: 'bg-amber-100 text-amber-800',
  Tournoi: 'bg-blue-100 text-blue-800',
  'Match par équipe': 'bg-emerald-100 text-emerald-800',
  Sortie: 'bg-violet-100 text-violet-800',
  Soirée: 'bg-rose-100 text-rose-800',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatPrice(prix: number | null): string {
  if (prix === null || prix === 0) return 'Gratuit';
  return `${prix.toFixed(2)} €`;
}

export default function EventCard({ event, onDelete, onDuplicate }: Props) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card/90 p-6 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[event.type]}`}>
          {event.type}
        </span>
        <span className="ml-auto text-xs font-medium text-muted-foreground">
          {formatPrice(event.prix)}
        </span>
      </div>

      <h3 className="text-lg font-semibold text-card-foreground">{event.titre}</h3>

      <p className="mt-2 text-sm text-muted-foreground">
        {formatDateTime(event.date_debut)}
        {event.date_fin && (
          <>
            {' → '}
            {formatDateTime(event.date_fin)}
          </>
        )}
      </p>

      <div className="mt-4 flex gap-2 pt-2">
        <Link
          to={`/events/${event.id}/edit`}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
        >
          Modifier
        </Link>
        <button
          onClick={onDuplicate}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
        >
          Dupliquer
        </button>
        <button
          onClick={onDelete}
          className="ml-auto rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
