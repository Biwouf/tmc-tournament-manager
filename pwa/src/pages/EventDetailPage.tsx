import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { editorialRehypePlugins } from '../lib/markdown';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import { formatDate } from '../components/events/EventCard';
import EventRegistration from '../components/events/EventRegistration';
import type { ClubEvent, EventType } from '../types';
import { LoadError } from '../components/layout/LoadState';

const expandBlankLines = (md: string) =>
  md.replace(/\n{3,}/g, (m) => '\n\n' + '&nbsp;\n\n'.repeat(m.length - 2));

const TYPE_COLORS: Record<EventType, string> = {
  Animation:          'bg-blue-100 text-blue-700',
  Tournoi:            'bg-purple-100 text-purple-700',
  'Match par équipe': 'bg-green-100 text-green-700',
  Sortie:             'bg-orange-100 text-orange-700',
  Soirée:             'bg-pink-100 text-pink-700',
};

async function fetchEvent(id: string, clubId: string | null): Promise<ClubEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .eq('club_id', clubId)
    .maybeSingle();
  if (error) throw error;
  // Aucune ligne (retirée, non publiée) : « introuvable », pas une erreur réseau.
  return data as ClubEvent | null;
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { clubId } = useClub();

  const { data: event, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['event', id, clubId],
    queryFn: () => fetchEvent(id!, clubId),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="p-4 space-y-4">
      <div className="sk h-6 w-1/3" role="status" aria-label="Chargement de l’événement…" />
      <div className="sk h-40 rounded-xl" />
    </div>;
  }

  if (isError) return <LoadError title="Impossible de charger l’événement" onRetry={() => void refetch()} retrying={isFetching} />;
  if (!event) return <LoadError title="Événement introuvable" message="Il a peut-être été retiré par le club." />;

  const prix = !event.prix || event.prix === 0 ? 'Gratuit' : `${event.prix} €`;

  return (
    <article className="flex flex-col">
      {event.image_url && (
        <div className="bg-muted flex items-center justify-center px-4 py-4">
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
        </div>
        <h1 className="text-2xl font-bold text-foreground leading-tight">{event.titre}</h1>
        <p className="text-sm text-muted-foreground">{formatDate(event)}</p>
        <p className="self-start rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Tarif <span className="ml-1 text-base font-bold text-foreground">{prix}</span>
        </p>
        {clubId && <EventRegistration clubId={clubId} eventId={event.id} />}
        <div className="markdown-body text-foreground mt-2">
          <ReactMarkdown remarkPlugins={[remarkBreaks]} rehypePlugins={editorialRehypePlugins}>{expandBlankLines(event.description)}</ReactMarkdown>
        </div>
      </div>
    </article>
  );
}
