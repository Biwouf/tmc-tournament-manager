import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import type { ClubEvent } from '../../types';
import EventCard from '../events/EventCard';
import PullToRefreshWrapper from '../layout/PullToRefreshWrapper';
import { LoadError, StaleNotice, CardSkeleton } from '../layout/LoadState';

async function fetchUpcomingEvents(clubId: string | null): Promise<ClubEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('club_id', clubId)
    .order('date_debut', { ascending: true });
  if (error) throw error;

  const now = new Date();
  return (data as ClubEvent[]).filter((e) => {
    // Garder si la date de fin n'est pas passée (ou si pas de date de fin, que date_debut est à venir)
    const end = e.date_fin ? new Date(e.date_fin) : new Date(e.date_debut);
    return end >= now;
  });
}

export default function EventsFeed() {
  const { clubId } = useClub();
  const { data: events, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['events', clubId],
    queryFn: () => fetchUpcomingEvents(clubId),
  });

  const handleRefresh = async () => {
    await refetch();
  };

  if (isError && !events) {
    return <LoadError title="Impossible de charger les événements" onRetry={() => void refetch()} retrying={isFetching} />;
  }

  return (
    <PullToRefreshWrapper onRefresh={handleRefresh} isRefreshing={isFetching}>
      {isError && <StaleNotice onRetry={() => void refetch()} />}
      <div className="p-4 flex flex-col gap-4">
        {isLoading && <CardSkeleton height={130} label="Chargement des événements…" />}

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
    </PullToRefreshWrapper>
  );
}
