// Publication en story Facebook, partagée par les vidéos du programme de tournoi et des rencontres
// par équipes (/medias). La section génère d'abord TOUTES les parties (un échec d'encodage ne
// laisse pas une story 1/2 sans sa suite), puis `sendStories` les envoie dans l'ordre à l'Edge
// Function `post-story-to-facebook`, une par appel. Spec : GEN_PROG.md « Publication en story Facebook ».
import { useClubRole } from '../../contexts/ClubRoleContext';
import { invokeEdgeFunction } from '../../lib/functions';
import { STORY_MAX_SECONDS } from './timeline';

export type StoryResult = { ok: boolean; message: string };

/** Même règle que l'Edge Function, qui reste seule juge : ici, on masque seulement le bouton. */
export function useCanPublishStory(): boolean {
  const { role, isSuperAdmin } = useClubRole();
  return isSuperAdmin || role === 'admin' || role === 'manager';
}

/** « · 1/2 » à la suite d'un libellé, rien pour une story unique. */
export const partSuffix = (p: number, n: number) => (n > 1 ? ` · ${p + 1}/${n}` : '');

export const publishLabel = (n: number) => (n > 1 ? `Publier en ${n} stories Facebook` : 'Publier en story Facebook');

/** Phrase qui annonce le découpage sous le bouton (`null` pour une story unique). */
export function describeParts(total: number, parts: number[]): string | null {
  if (parts.length < 2) return null;
  return `La vidéo dure ${total.toFixed(0)} s : une story Facebook est limitée à ${STORY_MAX_SECONDS} s, elle sera publiée en `
    + `${parts.length} parties (${parts.map((d) => `${d.toFixed(0)} s`).join(' + ')}), coupées entre deux écrans, chacune avec `
    + `son récap et son numéro (${parts.map((_, i) => `${i + 1}/${parts.length}`).join(', ')}).`;
}

export function confirmStories(n: number): boolean {
  return window.confirm(n > 1
    ? `Publier ces ${n} stories sur la page Facebook du club ? Elles seront visibles 24 h.`
    : 'Publier cette story sur la page Facebook du club ? Elle sera visible 24 h.');
}

/** Envoie les vidéos dans l'ordre ; s'arrête au premier échec en disant ce qui est déjà publié. */
export async function sendStories(clubId: string, videos: Blob[], onStep: (step: string) => void): Promise<StoryResult> {
  const n = videos.length;
  for (let p = 0; p < n; p++) {
    onStep(n > 1 ? `Envoi de la story ${p + 1} / ${n} à Facebook…` : 'Envoi de la story à Facebook…');
    const form = new FormData();
    form.set('club_id', clubId);
    form.set('video', new File([videos[p]], `story-${p + 1}.mp4`, { type: 'video/mp4' }));
    const res = await invokeEdgeFunction('post-story-to-facebook', form, 'Erreur inconnue lors de la publication de la story.');
    if (!res.success) {
      const done = p === 0 ? '' : `${p === 1 ? '1 story publiée' : `${p} stories publiées`} sur ${n}, puis échec : `;
      return { ok: false, message: done + res.error };
    }
  }
  return { ok: true, message: n > 1 ? `${n} stories publiées sur la page Facebook du club.` : 'Story publiée sur la page Facebook du club.' };
}
