// SaaS S7 — création du fond « Aux couleurs du club » dans `config.posters.team_match_backgrounds`.
//
// Un fond NORMAL : même bucket et même dossier que « Configuration du site › Affiches »
// (`uploadConfigImage`), même entrée `{ name, image }`. Le club peut ensuite le supprimer ou en
// ajouter d'autres depuis cet écran ; le rendu de l'affiche n'a aucun cas particulier.
//
// Créé seulement si la liste est VIDE, et jamais pour un club `internal` (le CAC n'est pas touché).
// La liste est relue en base avant de dessiner, puis une seconde fois dans l'écriture
// (`updateClubConfigKey` relit la ligne) : un fond ajouté entre-temps l'emporte, et l'image
// téléversée pour rien est supprimée. Deux appels simultanés dans le même onglet (double montage,
// retour rapide à l'étape) partagent la même promesse.
import { parseClubConfig, type PosterBackground } from './clubConfig';
import { updateClubConfigKey } from './clubConfigWrite';
import { deleteConfigImage, uploadConfigImage } from './configImages';
import { CLUB_BACKGROUND_NAME, renderClubPosterBackground, type ClubBackgroundBrand } from './clubPosterBackground';
import { supabase } from './supabase';
import type { Club } from '../contexts/ClubContext';

export type DefaultBackgroundResult = { backgrounds: PosterBackground[]; created: boolean };

const inFlight = new Map<string, Promise<DefaultBackgroundResult>>();

const listOf = (posters: unknown): PosterBackground[] =>
  parseClubConfig({ posters }).posters.team_match_backgrounds;

async function readBackgrounds(clubId: string): Promise<PosterBackground[]> {
  const { data, error } = await supabase.from('club_settings').select('config').eq('club_id', clubId).maybeSingle();
  if (error) throw new Error(`Lecture de la configuration impossible : ${error.message}`);
  return parseClubConfig(data?.config ?? {}).posters.team_match_backgrounds;
}

async function create(club: Pick<Club, 'id' | 'plan'>, brand: ClubBackgroundBrand): Promise<DefaultBackgroundResult> {
  const current = await readBackgrounds(club.id);
  if (club.plan === 'internal' || current.length > 0) return { backgrounds: current, created: false };

  const blob = await renderClubPosterBackground(brand);
  const file = new File([blob], 'aux-couleurs-du-club.png', { type: 'image/png' });
  const image = await uploadConfigImage(club.id, 'team_match_backgrounds.0.image', file);

  let backgrounds: PosterBackground[] = [];
  const result = await updateClubConfigKey(club.id, 'posters', (existing) => {
    const raw = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
    const list = listOf(raw);
    if (list.length > 0) { backgrounds = list; return raw; }
    backgrounds = [{ name: CLUB_BACKGROUND_NAME, image }];
    return { ...raw, team_match_backgrounds: backgrounds };
  });
  const created = result.success && backgrounds[0]?.image === image;
  if (!created) await deleteConfigImage(image);
  if (!result.success) throw new Error(result.errors.join(' '));
  return { backgrounds, created };
}

/**
 * Les fonds d'affiche des rencontres du club, après avoir créé « Aux couleurs du club » si la liste
 * était vide. Lève si la lecture, le dessin, l'envoi ou l'écriture échoue.
 */
export function ensureClubPosterBackground(
  club: Pick<Club, 'id' | 'plan'>,
  brand: ClubBackgroundBrand,
): Promise<DefaultBackgroundResult> {
  const pending = inFlight.get(club.id);
  if (pending) return pending;
  const run = create(club, brand).finally(() => inFlight.delete(club.id));
  inFlight.set(club.id, run);
  return run;
}
