import { QueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            1000 * 60 * 2,   // 2 min  — re-fetch after this when online
      gcTime:               1000 * 60 * 30,  // 30 min — keep in memory while offline
      //                    ↑ raised from the default 5 min so cached data
      //                      (products, payment methods, customers, etc.) survives
      //                      a mid-day internet outage without being evicted.
      retry:                1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (err) => {
        const msg = err?.response?.data?.message || 'Something went wrong';
        toast.error(msg);
      },
    },
  },
});
