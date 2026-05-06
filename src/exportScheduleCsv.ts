import type { GlobalConfig, Schedule, ScheduledMatch, TournamentConfig } from './types';

const HEADERS = ['Date', 'Heure début', 'Heure fin', 'Terrain', 'Tournoi', 'Tour', 'Match'];

function buildTournamentLabel(tournament: TournamentConfig): string {
  return `${tournament.gender} – ${tournament.minRanking}/${tournament.maxRanking} (${tournament.numberOfPlayers}J)`;
}

function escapeField(value: string | number): string {
  const str = String(value);
  if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function compareScheduledMatches(a: ScheduledMatch, b: ScheduledMatch): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
  return a.court - b.court;
}

function buildFilename(config: GlobalConfig): string {
  const slug = config.name.replace(/\s+/g, '-').toLowerCase();
  return `planning-${slug}-${config.startDate}.csv`;
}

export function buildScheduleCsv(schedule: Schedule, config: GlobalConfig): string {
  const tournamentsById = new Map<string, TournamentConfig>(
    config.tournaments.map((t) => [t.id, t])
  );

  const sorted = [...schedule.scheduledMatches].sort(compareScheduledMatches);

  const lines = [HEADERS.join(';')];
  for (const sm of sorted) {
    const tournament = tournamentsById.get(sm.match.tournamentId);
    const tournamentLabel = tournament ? buildTournamentLabel(tournament) : '';
    const row = [
      sm.date,
      sm.startTime,
      sm.endTime,
      sm.court,
      tournamentLabel,
      sm.match.round,
      sm.match.description,
    ].map(escapeField);
    lines.push(row.join(';'));
  }

  return lines.join('\r\n');
}

export function exportScheduleCsv(schedule: Schedule, config: GlobalConfig): void {
  const csv = buildScheduleCsv(schedule, config);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildFilename(config);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
