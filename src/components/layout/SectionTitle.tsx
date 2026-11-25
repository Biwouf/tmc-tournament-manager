import type { ElementType, ReactNode } from 'react';

type Level = 'h2' | 'h3';

interface Props {
  title: ReactNode;
  as?: Level;
  id?: string;
  count?: number;
  countClassName?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const TITLE: Record<Level, string> = {
  h2: 'text-lg leading-7 font-semibold tracking-tight text-foreground',
  h3: 'text-base leading-6 font-semibold text-foreground',
};

// Titre de section unique du BO (brief « titres de sections »). Remplace les 24 copies de
// l'ancien style (12 px, capitales, gris, interlettrage 0,08em). Pas de capitales,
// pas de couleur du club : l'encre, 18 px, au-dessus des titres de cartes (16 px).
export default function SectionTitle({
  title,
  as = 'h2',
  id,
  count,
  countClassName,
  description,
  action,
  className = '',
}: Props) {
  const Heading = as as ElementType;
  return (
    <div className={`mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="min-w-0">
        <Heading id={id} className={`m-0 flex flex-wrap items-center gap-2 break-words ${TITLE[as]}`}>
          <span>{title}</span>
          {count !== undefined && (
            <span
              className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums ${
                countClassName ?? 'bg-muted text-muted-foreground'
              }`}
            >
              {count}
            </span>
          )}
        </Heading>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
