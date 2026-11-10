// Import d'une équipe depuis le lien Ten'Up de sa poule : saison, compétition, puis équipe et
// calendrier par `team_equipe_create`. Sans React, client Supabase injecté : utilisé par l'étape
// « Vos équipes » des premiers pas (SaaS S6) ; `nextTeamNumber` et `clubTeamCandidates` sont aussi
// ceux de `CreateEquipeForm`.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveSet3Format, TeamCompetition, TeamEquipe, TeamFormat, TeamGenre, TeamSaison, TeamType } from '../../types';
import { GENRES_BY_TYPE, inferCategorie, inferGenre, inferType, seasonLabel } from './teamMatchLabels';
import { previewTenupCompetition } from '../../../shared/tenupCompetitionClient';
import { previewTenupPool, suggestedTeamIds, type TenupPoolPreview } from '../../../shared/tenupPoolClient';
import { normalizeTenupPoolUrl, teamCalendar } from '../../../shared/tenupPool.mjs';

type Client = Pick<SupabaseClient, 'from' | 'rpc' | 'functions'>;

export type SeasonChoice =
  | { kind: 'reuse'; saison: TeamSaison; activate: boolean }
  | { kind: 'create'; label: string };

/** La saison active ; sinon celle de l'année sportive en cours (activée) ; sinon à créer. */
export function chooseSeason(saisons: TeamSaison[], now: Date): SeasonChoice {
  const active = saisons.find((s) => s.actif);
  if (active) return { kind: 'reuse', saison: active, activate: false };
  const label = seasonLabel(now);
  const same = saisons.find((s) => s.label.trim() === label);
  return same ? { kind: 'reuse', saison: same, activate: true } : { kind: 'create', label };
}

/** Lien canonique du championnat (sans division, phase ni poule) : clé d'unicité par saison. */
export function championshipUrl(url: string): string {
  return url.split('?')[0];
}

export function findCompetition(competitions: TeamCompetition[], poolUrl: string): TeamCompetition | undefined {
  const base = championshipUrl(poolUrl);
  return competitions.find((c) => c.tenup_url && championshipUrl(c.tenup_url) === base);
}

export type CompetitionDraft = {
  nom: string;
  tenup_url: string;
  type: TeamType;
  categorie: string;
  genre: TeamGenre | null;
  format: TeamFormat | null;
  singles_set3_format: LiveSet3Format | null;
};

/** Badges d'une rencontre sur la page Ten'Up du club (S6b) : catégorie (« Senior ») et genre
 *  (« Femme », « Homme », « Mixte »). */
export type ClubBadges = { category?: string; genre?: string };

/** Genre lu sur le badge Ten'Up, selon le type ; null si le badge est absent ou inattendu. */
export function badgeGenre(badge: string | undefined, type: TeamType): TeamGenre | null {
  const word = (badge ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const genre: TeamGenre | null = /^(femmes?|dames?|feminin)$/.test(word) ? (type === 'jeunes' ? 'filles' : 'femmes')
    : /^(hommes?|messieurs|masculin)$/.test(word) ? (type === 'jeunes' ? 'garcons' : 'hommes')
    : /^(mixtes?)$/.test(word) ? 'mixte' : null;
  return genre && GENRES_BY_TYPE[type].includes(genre) ? genre : null;
}

/** Catégorie lue sur le badge Ten'Up (« Senior » → « Seniors », « 13/14 ans »…) ; null sinon. */
export function badgeCategorie(badge: string | undefined): string | null {
  if (!badge) return null;
  return /^seniors?$/i.test(badge.trim()) ? 'Seniors' : inferCategorie(badge);
}

/** Ce que l'on sait d'une compétition à partir de sa fiche Ten'Up (et, en import de club, des
 *  badges de ses rencontres). `genre`, `format` et `singles_set3_format` à null = à demander au
 *  fondateur, jamais devinés. */
export function deduceCompetition(
  preview: { url: string; nom: string; format: TeamFormat | null; singles_set3_format: LiveSet3Format | null },
  badges: ClubBadges = {},
): CompetitionDraft {
  const categorie = inferCategorie(preview.nom) ?? badgeCategorie(badges.category) ?? 'Seniors';
  const type = inferType(categorie);
  return {
    nom: preview.nom, tenup_url: preview.url, type, categorie,
    genre: badgeGenre(badges.genre, type) ?? inferGenre(preview.nom, type),
    format: preview.format, singles_set3_format: preview.singles_set3_format,
  };
}

export function missingFields(draft: CompetitionDraft): ('genre' | 'format' | 'singles_set3_format')[] {
  return (['genre', 'format', 'singles_set3_format'] as const).filter((key) => !draft[key]);
}

/** Numéro proposé pour une nouvelle équipe d'une compétition. */
export function nextTeamNumber(equipes: Pick<TeamEquipe, 'competition_id' | 'numero'>[], competitionId: string): number {
  return Math.max(0, ...equipes.filter((e) => e.competition_id === competitionId).map((e) => e.numero)) + 1;
}

/** Numéro d'une équipe importée : celui de son nom Ten'Up (« TC ALPHA 2 » → 2), sinon le suivant
 *  de la compétition. Le numéro est un libellé, il peut se répéter (2026100103). */
export function teamNumber(tenupName: string, equipes: Pick<TeamEquipe, 'competition_id' | 'numero'>[], competitionId: string): number {
  const n = Number(/\s(\d{1,3})$/.exec(tenupName.trim())?.[1]);
  return n >= 1 && n <= 999 ? n : nextTeamNumber(equipes, competitionId);
}

/** Équipes de la poule qui semblent être celles du club et ne sont pas encore importées. */
export function clubTeamCandidates(
  pool: TenupPoolPreview, clubNames: string[], city: string,
  equipes: Pick<TeamEquipe, 'competition_id' | 'tenup_team_id'>[], competitionId: string,
): string[] {
  return suggestedTeamIds(pool, clubNames, city).filter(
    (id) => !equipes.some((e) => e.competition_id === competitionId && e.tenup_team_id === id),
  );
}

/** Message lisible d'une erreur Supabase ou d'un client Ten'Up. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** La saison à utiliser, créée ou activée si besoin (décision 1 du brief S6). */
export async function ensureSeason(client: Client, clubId: string, now = new Date()): Promise<TeamSaison> {
  const { data, error } = await client.from('team_saisons').select('*').eq('club_id', clubId).order('created_at', { ascending: false });
  if (error) throw error;
  const choice = chooseSeason((data ?? []) as TeamSaison[], now);
  if (choice.kind === 'reuse') {
    if (choice.activate) {
      const { error: err } = await client.from('team_saisons').update({ actif: true }).eq('id', choice.saison.id).eq('club_id', clubId);
      if (err) throw err;
    }
    return { ...choice.saison, actif: true };
  }
  const { data: created, error: err } = await client.from('team_saisons').insert({ club_id: clubId, label: choice.label, actif: true }).select('*').single();
  if (err) throw err;
  return created as TeamSaison;
}

export async function seasonCompetitions(client: Client, clubId: string, saisonId: string): Promise<TeamCompetition[]> {
  const { data, error } = await client.from('team_competitions').select('*').eq('club_id', clubId).eq('saison_id', saisonId);
  if (error) throw error;
  return (data ?? []) as TeamCompetition[];
}

/** Compétition du championnat de la poule : retrouvée sans lecture si le club l'a déjà dans la
 *  saison, sinon lue sur Ten'Up (une lecture) et rendue comme brouillon à compléter. */
export async function prepareCompetition(
  client: Client, clubId: string, saisonId: string, poolUrl: string,
): Promise<{ competition: TeamCompetition } | { draft: CompetitionDraft }> {
  const url = normalizeTenupPoolUrl(poolUrl);
  const existing = findCompetition(await seasonCompetitions(client, clubId, saisonId), url);
  if (existing) return { competition: existing };
  return { draft: deduceCompetition(await previewTenupCompetition(client, clubId, saisonId, url)) };
}

/** Crée la compétition d'un brouillon complet. Déjà créée (essai précédent, autre onglet) :
 *  l'index unique la signale, on la reprend. */
export async function createCompetition(client: Client, clubId: string, saisonId: string, draft: CompetitionDraft): Promise<TeamCompetition> {
  if (missingFields(draft).length) throw new Error('Précisez le genre, le format et le troisième set de la compétition.');
  const { data, error } = await client.from('team_competitions')
    .insert({ club_id: clubId, saison_id: saisonId, ...draft })
    .select('*').single();
  if (!error) return data as TeamCompetition;
  if (error.code === '23505') {
    const found = findCompetition(await seasonCompetitions(client, clubId, saisonId), draft.tenup_url);
    if (found) return found;
  }
  throw error;
}

export async function competitionTeams(client: Client, clubId: string, competitionId: string): Promise<TeamEquipe[]> {
  const { data, error } = await client.from('team_equipes').select('*').eq('club_id', clubId).eq('competition_id', competitionId);
  if (error) throw error;
  return (data ?? []) as TeamEquipe[];
}

export type PoolReading = {
  preview: TenupPoolPreview;
  /** Équipes déjà importées dans cette compétition. */
  equipes: TeamEquipe[];
  /** Équipes du club reconnues et pas encore importées. */
  candidates: string[];
  /** Équipes du club reconnues mais déjà importées. */
  alreadyImported: TeamEquipe[];
};

/** Lit la poule (une lecture) et reconnaît l'équipe du club. */
export async function readPool(
  client: Client, clubId: string, competition: TeamCompetition, poolUrl: string, clubNames: string[], city: string,
): Promise<PoolReading> {
  const preview = await previewTenupPool(client, clubId, competition.id, poolUrl);
  const equipes = await competitionTeams(client, clubId, competition.id);
  const recognised = suggestedTeamIds(preview, clubNames, city);
  return {
    preview, equipes,
    candidates: clubTeamCandidates(preview, clubNames, city, equipes, competition.id),
    alreadyImported: equipes.filter((e) => e.tenup_team_id && recognised.includes(e.tenup_team_id)),
  };
}

/** Rencontres de l'équipe dans la poule (journées exemptes exclues). */
export function encounterCount(preview: TenupPoolPreview, teamId: string): number {
  return teamCalendar(preview, teamId).filter((r) => !r.exempt).length;
}

/** Crée l'équipe, ses journées et ses rencontres depuis l'aperçu serveur. */
export async function createTeamFromPool(
  client: Client, clubId: string, competitionId: string, reading: PoolReading, teamId: string,
): Promise<string> {
  const { data, error } = await client.rpc('team_equipe_create', {
    p_club: clubId,
    p_competition: competitionId,
    p_numero: teamNumber(reading.preview.teams.find((t) => t.id === teamId)?.name ?? '', reading.equipes, competitionId),
    p_division: reading.preview.division,
    p_journees: reading.preview.rounds.length,
    p_preview: reading.preview.id,
    p_team_id: teamId,
  });
  if (error) throw error;
  return data as string;
}
