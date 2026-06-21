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
        // Auth errors (TOKEN_EXPIRED, INVALID_TOKEN) are handled by the Axios
        // interceptor — it either silently refreshes the token or redirects to
        // /login. Showing a toast here would be noise and cause the "Token
        // expired" flash the user sees on PIN unlock.
        const code = err?.response?.data?.code;
        if (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN') return;
        const msg = err?.response?.data?.message || 'Something went wrong';
        toast.error(msg);
      },
    },
  },
});
