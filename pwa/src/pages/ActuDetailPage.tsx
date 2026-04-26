import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import type { Actu } from '../types';

async function fetchActu(id: string): Promise<Actu> {
  const { data, error } = await supabase
    .from('actus')
    .select('*')
    .eq('id', id)
    .eq('published', true)
    .single();
  if (error) throw error;
  return data as Actu;
}

export default function ActuDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: actu, isLoading, isError } = useQuery({
    queryKey: ['actu', id],
    queryFn: () => fetchActu(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="p-4 space-y-4">
      <div className="h-6 bg-muted rounded animate-pulse w-1/3" />
      <div className="h-48 bg-muted rounded-xl animate-pulse" />
    </div>;
  }

  if (isError || !actu) {
    return <div className="p-6 text-center text-muted-foreground">Actualité introuvable.</div>;
  }

  const publishedDate = actu.published_at
    ? new Date(actu.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return (
    <article className="flex flex-col">
      <button
        onClick={() => navigate(-1)}
        className="mx-4 mt-4 self-start text-sm text-primary font-medium flex items-center gap-1 active:opacity-70"
      >
        ← Retour
      </button>

      {actu.image_urls.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {actu.image_urls.map((url, i) => (
            <img
              key={url}
              src={url}
              alt={`${actu.titre} — ${i + 1}`}
              className="w-full h-52 object-cover"
            />
          ))}
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{publishedDate}</p>
        <h1 className="text-2xl font-bold text-foreground leading-tight">{actu.titre}</h1>
        <div className="prose prose-sm max-w-none text-foreground">
          <ReactMarkdown>{actu.contenu}</ReactMarkdown>
        </div>
      </div>
    </article>
  );
}
