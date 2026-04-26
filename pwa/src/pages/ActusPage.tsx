import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Actu } from '../types';
import ActuCard from '../components/actus/ActuCard';

const PAGE_SIZE = 10;

async function fetchActus(offset: number): Promise<Actu[]> {
  const { data, error } = await supabase
    .from('actus')
    .select('*')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  return data as Actu[];
}

export default function ActusPage() {
  const [offset, setOffset] = useState(0);
  const [allActus, setAllActus] = useState<Actu[]>([]);
  const [hasMore, setHasMore] = useState(true);

  const { isFetching, isError } = useQuery({
    queryKey: ['actus', offset],
    queryFn: async () => {
      const data = await fetchActus(offset);
      setAllActus((prev) => offset === 0 ? data : [...prev, ...data]);
      if (data.length < PAGE_SIZE) setHasMore(false);
      return data;
    },
  });

  if (isError) {
    return <div className="p-6 text-center text-muted-foreground">Impossible de charger les actualités.</div>;
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">Actualités</h1>

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

      {hasMore && !isFetching && allActus.length > 0 && (
        <button
          onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          className="w-full py-3 rounded-xl border border-border text-sm font-medium text-muted-foreground active:bg-muted transition-colors"
        >
          Voir plus
        </button>
      )}
    </div>
  );
}
