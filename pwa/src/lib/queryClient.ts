import { QueryClient } from '@tanstack/react-query';

export function createPwaQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  });
}
