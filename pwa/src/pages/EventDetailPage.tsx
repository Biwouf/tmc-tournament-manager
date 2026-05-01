import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import { formatDate } from '../components/events/EventCard';
import type { ClubEvent, EventType } from '../types';

const TYPE_COLORS: Record<EventType, string> = {
  Animation:          'bg-blue-100 text-blue-700',
  Tournoi:            'bg-purple-100 text-purple-700',
  'Match par équipe': 'bg-green-100 text-green-700',
  Sortie:             'bg-orange-100 text-orange-700',
  Soirée:             'bg-pink-100 text-pink-700',
};

async function fetchEvent(id: string): Promise<ClubEvent> {
  const { data, error } = await supabase.from('events').select('*').eq('id', id).single();
  if (error) throw error;
  return data as ClubEvent;
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: event, isLoading, isError } = useQuery({
    queryKey: ['event', id],
    queryFn: () => fetchEvent(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="p-4 space-y-4">
      <div className="h-6 bg-muted rounded animate-pulse w-1/3" />
      <div className="h-40 bg-muted rounded-xl animate-pulse" />
    </div>;
  }

  if (isError || !event) {
    return <div className="p-6 text-center text-muted-foreground">Événement introuvable.</div>;
  }

  const prix = !event.prix || event.prix === 0 ? 'Gratuit' : `${event.prix} €`;

  return (
    <article className="flex flex-col">
      <button
        onClick={() => navigate(-1)}
        className="mx-4 mt-4 self-start text-sm text-primary font-medium flex items-center gap-1 active:opacity-70"
      >
        ← Retour
      </button>

      {event.image_url && (
        <div className="bg-muted flex items-center justify-center px-4 py-4 mt-4">
          <img
            src={event.image_url}
            alt={event.titre}
            className="max-w-full max-h-[60vh] object-contain block rounded-md"
          />
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[event.type]}`}>
            {event.type}
          </span>
          <span className="text-sm text-muted-foreground ml-auto">{prix}</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground leading-tight">{event.titre}</h1>
        <p className="text-sm text-muted-foreground">{formatDate(event)}</p>
        <div className="prose prose-sm max-w-none text-foreground mt-2">
          <ReactMarkdown>{event.description}</ReactMarkdown>
        </div>
      </div>
    </article>
  );
}
