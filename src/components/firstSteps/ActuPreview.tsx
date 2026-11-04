import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Actu } from '../../types';
import { PhoneFrame } from '../signup/SignupPreview';
import type { StepPreviewProps } from './FirstStepsFlow';

// L'onglet Actu de la PWA (`ActuTabSwitcher`, `ActusFeed`, `ActuCard`), reproduit ici pour les
// mêmes raisons que `SignupPreview`. Il montre les actus publiées du club, lues avec la requête
// de la PWA : donc ce que verront les adhérents, y compris rien.

type Card = Pick<Actu, 'id' | 'titre' | 'contenu' | 'image_urls' | 'image_focal_points' | 'published_at'>;

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function excerpt(markdown: string, maxLength = 120): string {
  const plain = markdown.replace(/[#*_`>\-[\]()]/g, '').replace(/\n+/g, ' ').trim();
  return plain.length > maxLength ? plain.slice(0, maxLength) + '…' : plain;
}

export default function ActuPreview({ club, data, version }: StepPreviewProps) {
  const [actus, setActus] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from('actus')
      .select('id, titre, contenu, image_urls, image_focal_points, published_at')
      .eq('club_id', club.id)
      .eq('published', true)
      .order('published_at', { ascending: false })
      .limit(10)
      .then(({ data: rows, error }) => {
        if (!active) return;
        setFailed(Boolean(error));
        setActus((rows ?? []) as Card[]);
      });
    return () => { active = false; };
  }, [club.id, version]);

  return (
    <PhoneFrame data={data} title="Actualités" tab="Actu">
      <div className="flex gap-6 border-b border-border/60 bg-card px-4">
        <span className="relative py-3 text-base font-extrabold tracking-tight text-foreground">
          Actualités<span className="absolute right-0 -bottom-px left-0 h-[3px] rounded-sm bg-primary" />
        </span>
        <span className="py-3 text-base font-semibold tracking-tight text-muted-foreground">Événements</span>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {failed && <p className="p-2 text-center text-muted-foreground">Impossible de charger les actualités.</p>}
        {!failed && actus?.length === 0 && <p className="py-8 text-center text-muted-foreground">Aucune actualité pour l'instant.</p>}
        {!actus && <div className="h-32 animate-pulse rounded-xl bg-muted" />}
        {actus?.map((actu) => {
          const focal = actu.image_focal_points?.[0];
          return (
            <div key={actu.id} className="block shrink-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              {actu.image_urls[0] && (
                <img src={actu.image_urls[0]} alt="" className="h-40 w-full object-cover"
                  style={{ objectPosition: focal ? `${focal.x}% ${focal.y}%` : '50% 50%' }} />
              )}
              <div className="flex flex-col gap-1 p-4">
                <p className="text-xs text-muted-foreground">{formatDate(actu.published_at)}</p>
                <h3 className="text-base leading-snug font-semibold text-foreground">{actu.titre}</h3>
                <p className="line-clamp-2 text-sm text-muted-foreground">{excerpt(actu.contenu)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </PhoneFrame>
  );
}
