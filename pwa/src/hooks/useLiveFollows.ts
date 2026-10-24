import { useQuery } from '@tanstack/react-query';
import { fetchLiveFollows } from '../lib/liveFollows';

// Matches followed by the current member, shared by every bell of the page.
export function useLiveFollows(clubId: string | null, userId: string | null) {
  return useQuery({
    queryKey: ['live-follows', clubId, userId],
    enabled: !!clubId && !!userId,
    queryFn: () => fetchLiveFollows(clubId!),
    staleTime: 60_000,
  });
}
