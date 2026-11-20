import { QueryClient } from '@tanstack/react-query';

/** Server data is cached here, so screens open on what was last seen while a weak connection catches up. */
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
