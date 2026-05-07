'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry:              1,
      staleTime:          60_000,           /* 1 min default */
      gcTime:             5 * 60_000,       /* 5 min: keep cache across navigations */
      refetchOnWindowFocus: false,          /* avoid surprise re-fetches when switching apps */
      networkMode:        'offlineFirst',   /* serve cache instantly while revalidating */
    },
    mutations: {
      networkMode: 'always',
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const refreshUser = useAuthStore(s => s.refreshUser);
  const token       = useAuthStore(s => s.token);

  useEffect(() => {
    if (token) refreshUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <QueryClientProvider client={qc}>
      {children}
    </QueryClientProvider>
  );
}
