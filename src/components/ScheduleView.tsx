import { useState, useRef, useEffect } from 'react';
import type { Schedule, GlobalConfig, ScheduledMatch } from '../types';
import ConfigDropdown from './ConfigDropdown';

interface Props {
  schedule: Schedule;
  config: GlobalConfig;
  onConfigUpdate: (config: GlobalConfig) => void;
  onMoveMatch?: (matchIds: string[], newDate: string, newStartTime: string) => void;
}

export default function ScheduleView({ schedule, config, onConfigUpdate, onMoveMatch }: Props) {
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('calendar');
  const [selectedTournamentIds, setSelectedTournamentIds] = useState<string[]>([]);
  const [draggingMatchId, setDraggingMatchId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{ date: string; time: string } | null>(null);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const scrollAnimRef = useRef<number | null>(null);

  useEffect(() => {
    if (!draggingMatchId) return;

    const SCROLL_ZONE = 80;
    const MAX_SPEED = 15;
    let scrollDirection = 0;
    let scrollSpeed = 0;

    const tick = () => {
      if (scrollDirection !== 0) window.scrollBy(0, scrollDirection * scrollSpeed);
      scrollAnimRef.current = requestAnimationFrame(tick);
    };
    scrollAnimRef.current = requestAnimationFrame(tick);

    const handleDragOver = (e: DragEvent) => {
      const { clientY } = e;
      const { innerHeight } = window;
      if (clientY < SCROLL_ZONE) {
        scrollDirection = -1;
        scrollSpeed = Math.max(1, Math.round(MAX_SPEED * (1 - clientY / SCROLL_ZONE)));
      } else if (clientY > innerHeight - SCROLL_ZONE) {
        scrollDirection = 1;
        scrollSpeed = Math.max(1, Math.round(MAX_SPEED * (1 - (innerHeight - clientY) / SCROLL_ZONE)));
      } else {
        scrollDirection = 0;
        scrollSpeed = 0;
      }
    };

    document.addEventListener('dragover', handleDragOver);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    };
  }, [draggingMatchId]);

  const getTournamentInfo = (tournamentId: string) => {
    return schedule.tournaments.find((t) => t.id === tournamentId);
  };

  const getTournamentLabel = (tournamentId: string) => {
    const tournament = getTournamentInfo(tournamentId);

    if (!tournament) {
      return tournamentId;
    }

    return `${tournament.id.replace('tournament-', 'T')} - ${
      tournament.gender === 'homme' ? 'H' : 'F'
    } - ${tournament.numberOfPlayers} joueurs (${tournament.minRanking} > ${tournament.maxRanking})`;
  };

  const TOURNAMENT_HUES = [210, 30, 140, 280, 10, 175, 55, 320];

  const getTournamentColor = (tournamentId: string) => {
    const index = schedule.tournaments.findIndex((t) => t.id === tournamentId);
    const hue = TOURNAMENT_HUES[index % TOURNAMENT_HUES.length];

    return {
      accent: `hsl(${hue} 65% 45%)`,
      soft: `hsl(${hue} 85% 94%)`,
      surface: `hsl(${hue} 82% 90%)`,
      text: `hsl(${hue} 55% 24%)`,
      border: `hsl(${hue} 60% 78%)`,
    };
  };

  const filteredMatches =
    selectedTournamentIds.length === 0
      ? schedule.scheduledMatches
      : schedule.scheduledMatches.filter((scheduledMatch) =>
          selectedTournamentIds.includes(scheduledMatch.match.tournamentId)
        );

  // Group matches by date
  const matchesByDate = filteredMatches.reduce((acc, match) => {
    if (!acc[match.date]) {
      acc[match.date] = [];
    }
    acc[match.date].push(match);
    return acc;
  }, {} as Record<string, ScheduledMatch[]>);

  const sortedDates = Object.keys(matchesByDate).sort();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const toggleTournament = (tournamentId: string) => {
    setSelectedTournamentIds((currentIds) =>
      currentIds.includes(tournamentId)
        ? currentIds.filter((id) => id !== tournamentId)
        : [...currentIds, tournamentId]
    );
  };

  return (
    <div className="space-y-6">
      {/* Warnings */}
      {schedule.warnings && schedule.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/80 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-amber-900">
                Avertissement
              </h3>
              <div className="mt-2 text-sm text-amber-800">
                <ul className="list-disc pl-5 space-y-1">
                  {schedule.warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold tracking-tight text-card-foreground">
            Planning des Matches
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('calendar')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                viewMode === 'calendar'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:brightness-95'
              }`}
            >
              Vue Calendrier
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                viewMode === 'table'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:brightness-95'
              }`}
            >
              Vue Tableau
            </button>
            <ConfigDropdown config={config} onUpdate={onConfigUpdate} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
            <span className="font-semibold text-foreground">Matches planifiés:</span>
            <span className="ml-2 text-foreground">
              {filteredMatches.length}
              {(selectedTournamentIds.length > 0 ||
                (schedule.unscheduledMatches && schedule.unscheduledMatches.length > 0)) && (
                <span className="text-muted-foreground">
                  {' '}sur {schedule.scheduledMatches.length}
                  {schedule.unscheduledMatches && schedule.unscheduledMatches.length > 0 && (
                    <span className="text-amber-700">
                      {' '}({schedule.scheduledMatches.length + schedule.unscheduledMatches.length} au total)
                    </span>
                  )}
                </span>
              )}
            </span>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
            <span className="font-semibold text-foreground">Tournois:</span>
            <span className="ml-2 text-foreground">
              {schedule.tournaments.length}
            </span>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
            <span className="font-semibold text-foreground">Courts:</span>
            <span className="ml-2 text-foreground">{config.numberOfCourts}</span>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-10 rounded-2xl border bg-card/95 px-6 py-4 shadow-sm backdrop-blur">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Filtrer par tournoi</h3>
            <p className="text-xs text-muted-foreground">
              Clique sur un ou plusieurs tournois pour alléger la vue.
            </p>
          </div>
          {selectedTournamentIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTournamentIds([])}
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-card-foreground transition hover:bg-muted"
            >
              Réinitialiser
            </button>
          )}
          {selectedMatchIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-600 font-medium">
                {selectedMatchIds.size} match{selectedMatchIds.size > 1 ? 'es' : ''} sélectionné{selectedMatchIds.size > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={() => setSelectedMatchIds(new Set())}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-600 transition hover:bg-blue-100"
              >
                Désélectionner
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedTournamentIds([])}
            className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
              selectedTournamentIds.length === 0
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-card-foreground hover:bg-muted'
            }`}
          >
            Tous les tournois
          </button>
          {schedule.tournaments.map((tournament) => {
            const colors = getTournamentColor(tournament.id);
            const isSelected = selectedTournamentIds.includes(tournament.id);

            return (
              <button
                key={tournament.id}
                type="button"
                onClick={() => toggleTournament(tournament.id)}
                className="rounded-full border px-3 py-2 text-xs font-medium transition hover:brightness-95"
                style={{
                  borderColor: colors.border,
                  backgroundColor: isSelected ? colors.accent : colors.soft,
                  color: isSelected ? 'white' : colors.text,
                }}
              >
                {getTournamentLabel(tournament.id)}
              </button>
            );
          })}
        </div>
      </div>

      {viewMode === 'calendar' ? (
        <div className="space-y-6">
          {sortedDates.length === 0 && (
            <div className="rounded-2xl border bg-card/90 p-6 text-sm text-muted-foreground shadow-sm">
              Aucun match ne correspond au filtre sélectionné.
            </div>
          )}
          {sortedDates.map((date) => {
            const dayMatches = matchesByDate[date];
            // Group by time slot
            const matchesByTimeSlot = dayMatches.reduce((acc, match) => {
              const key = match.startTime;
              if (!acc[key]) {
                acc[key] = [];
              }
              acc[key].push(match);
              return acc;
            }, {} as Record<string, ScheduledMatch[]>);

            const sortedTimeSlots = Object.keys(matchesByTimeSlot).sort();

            return (
              <div key={date} className="rounded-2xl border bg-card/90 p-6 shadow-sm">
                <h3 className="mb-4 text-xl font-semibold text-card-foreground">
                  {formatDate(date)}
                </h3>

                <div className="space-y-4">
                  {sortedTimeSlots.map((timeSlot) => {
                    const slotMatches = matchesByTimeSlot[timeSlot];
                    return (
                      <div
                        key={timeSlot}
                        className={`border-l-4 pl-4 rounded transition ${
                          dragOverSlot?.date === date && dragOverSlot?.time === timeSlot
                            ? 'border-blue-400 bg-blue-50/40'
                            : 'border-primary/70'
                        }`}
                        onDragOver={(e) => {
                          if (!draggingMatchId || !onMoveMatch) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverSlot({ date, time: timeSlot });
                        }}
                        onDragLeave={(e) => {
                          // Only clear if leaving to outside this element
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setDragOverSlot(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (draggingMatchId && onMoveMatch) {
                            const idsToMove = selectedMatchIds.has(draggingMatchId) && selectedMatchIds.size > 1
                              ? Array.from(selectedMatchIds)
                              : [draggingMatchId];
                            onMoveMatch(idsToMove, date, timeSlot);
                          }
                          setDraggingMatchId(null);
                          setDragOverSlot(null);
                          setSelectedMatchIds(new Set());
                        }}
                      >
                        <div className="mb-2 font-semibold text-foreground">
                          {timeSlot} - {slotMatches[0].endTime}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {slotMatches.map((scheduledMatch, idx) => {
                            const tournament = getTournamentInfo(
                              scheduledMatch.match.tournamentId
                            );
                            const colors = getTournamentColor(scheduledMatch.match.tournamentId);
                            return (
                              <div
                                key={idx}
                                className="rounded-lg border p-3 transition hover:shadow-sm"
                                draggable={!!onMoveMatch}
                                onClick={(e) => {
                                  if (!onMoveMatch) return;
                                  const id = scheduledMatch.match.id;
                                  setSelectedMatchIds(prev => {
                                    const next = new Set(prev);
                                    if (e.ctrlKey || e.metaKey) {
                                      if (next.has(id)) next.delete(id);
                                      else next.add(id);
                                    } else {
                                      next.clear();
                                      next.add(id);
                                    }
                                    return next;
                                  });
                                }}
                                onDragStart={(e) => {
                                  const id = scheduledMatch.match.id;
                                  setDraggingMatchId(id);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => {
                                  setDraggingMatchId(null);
                                  setDragOverSlot(null);
                                }}
                                style={{
                                  borderColor: selectedMatchIds.has(scheduledMatch.match.id) ? '#3b82f6' : colors.border,
                                  backgroundColor: colors.surface,
                                  opacity: draggingMatchId === scheduledMatch.match.id ? 0.5 : 1,
                                  cursor: onMoveMatch ? 'grab' : undefined,
                                  outline: selectedMatchIds.has(scheduledMatch.match.id) ? '2px solid #3b82f6' : undefined,
                                  outlineOffset: '1px',
                                }}
                              >
                                <div className="flex justify-between items-start mb-2">
                                  <span
                                    className="font-semibold"
                                    style={{ color: colors.text }}
                                  >
                                    Court {scheduledMatch.court}
                                  </span>
                                  <span
                                    className="rounded px-2 py-1 text-xs font-medium"
                                    style={{
                                      backgroundColor: 'rgba(255, 255, 255, 0.55)',
                                      color: colors.text,
                                    }}
                                  >
                                    {tournament?.id.replace('tournament-', 'T')} - {tournament?.gender === 'homme' ? 'H' : 'F'}
                                  </span>
                                </div>
                                <div className="text-sm font-medium" style={{ color: colors.text }}>
                                  {scheduledMatch.match.description}
                                </div>
                                <div className="mt-1 text-xs" style={{ color: colors.text }}>
                                  {tournament?.numberOfPlayers} joueurs ({tournament?.minRanking} - {tournament?.maxRanking})
                                </div>
                                <div className="mt-1 text-xs font-semibold" style={{ color: colors.text }}>
                                  Match {scheduledMatch.match.round}/{Math.log2(tournament?.numberOfPlayers ?? 1)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card/90 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-primary text-primary-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Horaire</th>
                  <th className="px-4 py-3 text-left">Court</th>
                  <th className="px-4 py-3 text-left">Tournoi</th>
                  <th className="px-4 py-3 text-left">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredMatches.map((scheduledMatch, idx) => {
                  const tournament = getTournamentInfo(
                    scheduledMatch.match.tournamentId
                  );
                  const colors = getTournamentColor(scheduledMatch.match.tournamentId);
                  return (
                    <tr
                      key={idx}
                      className="transition hover:brightness-[0.98]"
                      style={{
                        backgroundColor: colors.surface,
                      }}
                    >
                      <td className="px-4 py-3 text-sm" style={{ color: colors.text }}>
                        {new Date(scheduledMatch.date).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: colors.text }}>
                        {scheduledMatch.startTime} - {scheduledMatch.endTime}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold" style={{ color: colors.text }}>
                        Court {scheduledMatch.court}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: colors.text }}>
                        <span
                          className="inline-block rounded px-2 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.55)',
                            color: colors.text,
                          }}
                        >
                          {tournament?.gender === 'homme' ? 'Hommes' : 'Femmes'} (
                          {tournament?.numberOfPlayers})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium" style={{ color: colors.text }}>
                        {scheduledMatch.match.description}
                        <span className="ml-2 text-xs font-normal opacity-70">
                          (match {scheduledMatch.match.round}/{Math.log2(tournament?.numberOfPlayers ?? 1)})
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredMatches.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-sm text-muted-foreground"
                    >
                      Aucun match ne correspond au filtre sélectionné.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
