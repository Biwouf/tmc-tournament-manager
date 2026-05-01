import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ClubEvent } from '../types';
import EventCard from '../components/events/EventCard';

async function fetchUpcomingEvents(): Promise<ClubEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date_debut', { ascending: true });
  if (error) throw error;

  const now = new Date();
  return (data as ClubEvent[]).filter((e) => {
    // Garder si la date de fin n'est pas passée (ou si pas de date de fin, que date_debut est à venir)
    const end = e.date_fin ? new Date(e.date_fin) : new Date(e.date_debut);
    return end >= now;
  });
}

export default function EventsPage() {
  const { data: events, isLoading, isError } = useQuery({
    queryKey: ['events'],
    queryFn: fetchUpcomingEvents,
  });

  if (isError) {
    return <div className="p-6 text-center text-muted-foreground">Impossible de charger les événements.</div>;
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">Événements</h1>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-muted rounded-xl h-[130px] animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && events?.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Aucun événement à venir.</p>
      )}

      {events && events.length > 0 && (
        <div className="flex flex-col gap-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
