import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import type { Actu } from '../../types';
import ActuCard from '../actus/ActuCard';
import PullToRefreshWrapper from '../layout/PullToRefreshWrapper';
import { LoadError, StaleNotice, CardSkeleton } from '../layout/LoadState';

const PAGE_SIZE = 10;

async function fetchActus(offset: number, clubId: string | null): Promise<Actu[]> {
  const { data, error } = await supabase
    .from('actus')
    .select('*')
    .eq('club_id', clubId)
    .eq('published', true)
    .order('published_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  return data as Actu[];
}

export default function ActusFeed() {
  const { clubId } = useClub();
  const { data, fetchNextPage, isFetching, isFetchingNextPage, isError, hasNextPage, refetch } =
    useInfiniteQuery({
      queryKey: ['actus', clubId],
      queryFn: ({ pageParam }) => fetchActus(pageParam, clubId),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
    });

  const allActus = data?.pages.flat() ?? [];
  const isRefreshing = isFetching && !isFetchingNextPage;

  const handleRefresh = async () => {
    await refetch();
  };

  // Rien en cache : écran d'erreur. Liste déjà affichée : bandeau discret au-dessus.
  if (isError && allActus.length === 0) {
    return <LoadError title="Impossible de charger les actualités" onRetry={() => void refetch()} retrying={isFetching} />;
  }

  return (
    <PullToRefreshWrapper onRefresh={handleRefresh} isRefreshing={isRefreshing}>
      {isError && <StaleNotice onRetry={() => void refetch()} />}
      <div className="p-4 flex flex-col gap-4">
        {allActus.length === 0 && !isFetching && (
          <p className="text-center text-muted-foreground py-8">Aucune actualité pour l'instant.</p>
        )}

        {allActus.map((actu) => (
          <ActuCard key={actu.id} actu={actu} />
        ))}

        {isFetching && allActus.length === 0 && <CardSkeleton height={128} label="Chargement des actualités…" />}

        {hasNextPage && !isFetching && allActus.length > 0 && (
          <button
            onClick={() => fetchNextPage()}
            className="w-full py-3 rounded-xl border border-border text-sm font-medium text-muted-foreground active:bg-muted transition-colors"
          >
            Voir plus
          </button>
        )}
      </div>
    </PullToRefreshWrapper>
  );
}
