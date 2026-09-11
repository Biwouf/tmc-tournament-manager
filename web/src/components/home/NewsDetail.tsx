import { useEffect, useId, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { editorialRehypePlugins } from '../../lib/markdown';
import { feedDate, type NewsItem } from '../../lib/feeds';

/** Le dialog natif assure le focus modal, le fond inerte et la touche Échap. */
export default function NewsDetail({ item, onDismiss }: { item: NewsItem; onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousOverflow = document.body.style.overflow;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onDismiss(); }}
      onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
      onClick={event => {
        if (backdropPress.current && event.target === event.currentTarget) onDismiss();
        backdropPress.current = false;
      }}
      className="news-dialog m-auto max-h-[90dvh] w-[calc(100%-24px)] max-w-3xl overflow-y-auto overscroll-contain rounded-card border border-line bg-bg p-0 text-text shadow-soft backdrop:bg-black/60">
      <article>
        <div className="sticky top-0 z-10 flex justify-end border-b border-line bg-bg px-4 py-3">
          <button type="button" autoFocus onClick={onDismiss} aria-label="Fermer l’actualité"
            className="rounded-full border border-line bg-card px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            Fermer <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="p-6 sm:p-10">
          {item.published_at && <time dateTime={item.published_at} className="text-sm text-muted">{feedDate(item.published_at)}</time>}
          <h2 id={titleId} className="mt-2 mb-6 text-[clamp(24px,4vw,36px)] leading-tight font-extrabold break-words">{item.titre}</h2>
          {item.images.length > 0 && <div className="mb-8 grid gap-4">
            {item.images.map((src, index) => <img key={`${index}-${src}`} src={src}
              alt={`${item.titre} — photo ${index + 1}`} loading="lazy" decoding="async"
              className="max-h-[65dvh] w-full rounded-soft object-contain" />)}
          </div>}
          <div className="news-content">
            <ReactMarkdown remarkPlugins={[remarkBreaks]} rehypePlugins={editorialRehypePlugins}
              components={{
                img: ({ src, alt }) => <img src={src} alt={alt || ''} loading="lazy" decoding="async" />,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
              }}>
              {item.content}
            </ReactMarkdown>
          </div>
        </div>
      </article>
    </dialog>
  );
}
