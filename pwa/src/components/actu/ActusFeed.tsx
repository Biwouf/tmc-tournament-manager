import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import type { Actu } from '../../types';
import ActuCard from '../actus/ActuCard';
import PullToRefreshWrapper from '../layout/PullToRefreshWrapper';

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

  if (isError) {
    return <div className="p-6 text-center text-muted-foreground">Impossible de charger les actualités.</div>;
  }

  return (
    <PullToRefreshWrapper onRefresh={handleRefresh} isRefreshing={isRefreshing}>
      <div className="p-4 flex flex-col gap-4">
        {allActus.length === 0 && !isFetching && (
          <p className="text-center text-muted-foreground py-8">Aucune actualité pour l'instant.</p>
        )}

        {allActus.map((actu) => (
          <ActuCard key={actu.id} actu={actu} />
        ))}

        {isFetching && (
          <div className="flex flex-col gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-muted rounded-xl h-32 animate-pulse" />
            ))}
          </div>
        )}

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
