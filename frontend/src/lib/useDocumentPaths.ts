import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDocuments } from './api';

/**
 * Source paths of the documents currently in the knowledge base, or null
 * while unknown (loading / offline). Lets saved chats mark citations whose
 * document has since been deleted.
 */
export function useDocumentPaths(enabled = true): Set<string> | null {
  const { data } = useQuery({
    queryKey: ['documents'],
    queryFn: fetchDocuments,
    staleTime: 60_000,
    retry: false,
    enabled,
  });
  return useMemo(() => (data ? new Set(data.documents.map((d) => d.source_path)) : null), [data]);
}
