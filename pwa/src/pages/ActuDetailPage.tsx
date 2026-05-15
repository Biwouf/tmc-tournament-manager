import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { supabase } from '../lib/supabase';
import type { Actu } from '../types';
import { focalPointStyle } from '../utils/focalPoint';

const expandBlankLines = (md: string) =>
  md.replace(/\n{3,}/g, (m) => '\n\n' + '&nbsp;\n\n'.repeat(m.length - 2));

const markdownComponents: Components = {
  p: ({ node, children, ...props }) => {
    const onlyChild = node?.children.length === 1 ? node.children[0] : null;
    if (onlyChild && onlyChild.type === 'element' && onlyChild.tagName === 'img') {
      return <>{children}</>;
    }
    return <p {...props}>{children}</p>;
  },
  img: ({ alt, src, ...props }) => {
    if (alt) {
      return (
        <figure>
          <img alt={alt} src={src} {...props} />
          <figcaption>{alt}</figcaption>
        </figure>
      );
    }
    return <img alt={alt} src={src} {...props} />;
  },
};

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
      {actu.image_urls.length > 0 && (
        <div className="flex flex-col gap-2">
          {actu.image_urls.map((url, i) => {
            const caption = actu.image_captions?.[i];
            return (
              <figure key={url}>
                <img
                  src={url}
                  alt={`${actu.titre} — ${i + 1}`}
                  className="w-full h-52 object-cover"
                  style={focalPointStyle(actu.image_focal_points?.[i])}
                />
                {caption && (
                  <figcaption className="px-3 pt-1 text-xs text-muted-foreground italic">
                    {caption}
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{publishedDate}</p>
        <h1 className="text-2xl font-bold text-foreground leading-tight">{actu.titre}</h1>
        <div className="markdown-body text-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkBreaks]}
            rehypePlugins={[rehypeRaw]}
            components={markdownComponents}
          >
            {expandBlankLines(actu.contenu)}
          </ReactMarkdown>
        </div>
      </div>
    </article>
  );
}
