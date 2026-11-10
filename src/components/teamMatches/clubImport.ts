// SaaS S6b — import de toutes les équipes d'un club depuis la page Ten'Up de ses rencontres
// (`/club/<id>/competitions/rencontres`). Sans React, client Supabase injecté. S'appuie sur
// `teamImport.ts` : mêmes saison, compétitions (déductions + badges) et `team_equipe_create`.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TeamCompetition, TeamEquipe } from '../../types';
import type { TenupClub, TenupClubTeam } from '../../../shared/tenupClub.mjs';
import { previewTenupCompetition } from '../../../shared/tenupCompetitionClient';
import { previewTenupPool, type TenupPoolPreview } from '../../../shared/tenupPoolClient';
import {
  championshipUrl, competitionTeams, createCompetition, createTeamFromPool, deduceCompetition, encounterCount, errorMessage,
  findCompetition, seasonCompetitions, type CompetitionDraft,
} from './teamImport';

type Client = Pick<SupabaseClient, 'from' | 'rpc' | 'functions'>;

export type ClubTeamRow = TenupClubTeam & { key: string; imported: boolean };
export type ClubGroup = { key: string; name: string; competition?: TeamCompetition; teams: ClubTeamRow[] };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const teamKey = (t: Pick<TenupClubTeam, 'pool_url' | 'team'>) => `${t.pool_url}|${norm(t.team)}`;

/** Les équipes de la page, par championnat (ordre de la page), chacune marquée « déjà importée »
 *  si la compétition existe et contient la même équipe de la même poule. */
export function groupClubTeams(club: TenupClub, competitions: TeamCompetition[], equipes: TeamEquipe[]): ClubGroup[] {
  const groups = new Map<string, ClubGroup>();
  for (const team of club.teams) {
    const key = championshipUrl(team.pool_url);
    const group = groups.get(key) ?? { key, name: team.competition, competition: findCompetition(competitions, team.pool_url), teams: [] };
    groups.set(key, group);
    const imported = Boolean(group.competition) && equipes.some((e) =>
      e.competition_id === group.competition!.id && e.tenup_source_url === team.pool_url && norm(e.tenup_team_name ?? '') === norm(team.team));
    group.teams.push({ ...team, key: teamKey(team), imported });
  }
  for (const group of groups.values()) group.teams.sort((a, b) => a.team.localeCompare(b.team, 'fr', { numeric: true }));
  return [...groups.values()];
}

/** L'équipe de la poule qui porte exactement ce nom (casse, accents et espaces ignorés). */
export function poolTeamId(pool: Pick<TenupPoolPreview, 'teams'>, name: string): string | null {
  const found = pool.teams.filter((t) => norm(t.name) === norm(name));
  return found.length === 1 ? found[0].id : null;
}

export type PreparedGroup = { group: ClubGroup; teams: ClubTeamRow[] } & (
  | { competition: TeamCompetition; draft?: undefined; error?: undefined }
  | { draft: CompetitionDraft; competition?: undefined; error?: undefined }
  | { error: string; competition?: undefined; draft?: undefined }
);

/** Pour chaque championnat retenu : la compétition existante, ou sa fiche Ten'Up lue (une lecture)
 *  et déduite avec les badges de la page. Une erreur reste propre à son championnat. */
export async function prepareClubCompetitions(
  client: Client, clubId: string, saisonId: string, selection: { group: ClubGroup; teams: ClubTeamRow[] }[],
): Promise<PreparedGroup[]> {
  const competitions = await seasonCompetitions(client, clubId, saisonId);
  const out: PreparedGroup[] = [];
  for (const { group, teams } of selection) {
    const first = teams[0];
    const existing = findCompetition(competitions, first.pool_url);
    if (existing) { out.push({ group, teams, competition: existing }); continue; }
    try {
      const preview = await previewTenupCompetition(client, clubId, saisonId, first.pool_url);
      out.push({ group, teams, draft: deduceCompetition(preview, { category: first.category, genre: first.genre }) });
    } catch (err) {
      out.push({ group, teams, error: errorMessage(err, 'La fiche du championnat Ten’Up est indisponible.') });
    }
  }
  return out;
}

export type TeamOutcome =
  | { status: 'waiting' | 'reading' }
  | { status: 'done'; count: number }
  | { status: 'already' }
  | { status: 'failed'; message: string };

const QUOTA = /Réessayez dans une minute/;

export type ImportItem = { teams: ClubTeamRow[] } & ({ competition: TeamCompetition } | { draft: CompetitionDraft });

/** Crée les compétitions manquantes puis, poule par poule (trois à la fois), lit le calendrier
 *  et crée l'équipe. Un quota par minute atteint est réessayé après une pause. */
export async function importClubTeams(
  client: Client, clubId: string, saisonId: string,
  prepared: ImportItem[],
  onUpdate: (key: string, outcome: TeamOutcome) => void,
  options: { concurrency?: number; pause?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const tasks: { team: ClubTeamRow; competition: TeamCompetition }[] = [];
  for (const item of prepared) {
    let competition: TeamCompetition;
    try {
      competition = 'competition' in item ? item.competition : await createCompetition(client, clubId, saisonId, item.draft);
    } catch (err) {
      const message = errorMessage(err, 'Compétition impossible à créer.');
      item.teams.forEach((t) => onUpdate(t.key, { status: 'failed', message }));
      continue;
    }
    item.teams.forEach((team) => { tasks.push({ team, competition }); onUpdate(team.key, { status: 'waiting' }); });
  }

  const run = async ({ team, competition }: (typeof tasks)[number]) => {
    onUpdate(team.key, { status: 'reading' });
    for (let attempt = 0; ; attempt++) {
      try {
        const preview = await previewTenupPool(client, clubId, competition.id, team.pool_url);
        const id = poolTeamId(preview, team.team);
        if (!id) return onUpdate(team.key, { status: 'failed', message: 'Équipe introuvable dans la poule : ajoutez-la avec le lien de sa poule.' });
        const equipes = await competitionTeams(client, clubId, competition.id);
        if (equipes.some((e) => e.tenup_team_id === id)) return onUpdate(team.key, { status: 'already' });
        await createTeamFromPool(client, clubId, competition.id, { preview, equipes, candidates: [], alreadyImported: [] }, id);
        return onUpdate(team.key, { status: 'done', count: encounterCount(preview, id) });
      } catch (err) {
        const message = errorMessage(err, 'Import impossible.');
        if (QUOTA.test(message) && attempt < 2) { await pause(30_000); continue; }
        if (/déjà ajoutée/i.test(message)) return onUpdate(team.key, { status: 'already' });
        return onUpdate(team.key, { status: 'failed', message });
      }
    }
  };
  let next = 0;
  const worker = async () => { while (next < tasks.length) await run(tasks[next++]); };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 3, tasks.length) }, worker));
}
