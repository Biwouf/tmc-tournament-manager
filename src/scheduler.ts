import type {
  GlobalConfig,
  Match,
  MatchBracket,
  ScheduledMatch,
  Schedule,
  DailyTimeSlot,
  SlotFillingStrategy,
} from './types';
import { generateTMCMatches } from './tmcLogic';

/**
 * Generate the complete schedule for all tournaments
 */
export function generateSchedule(config: GlobalConfig): Schedule {
  // Generate all matches for all tournaments
  const allMatches: Match[] = [];
  config.tournaments.forEach((tournament) => {
    const matches = generateTMCMatches(tournament);
    allMatches.push(...matches);
  });

  // Group matches by (tournament, bracket, round)
  const matchGroups = groupMatchesByTournamentBracketAndRound(allMatches);

  // Generate time slots
  const timeSlots = generateTimeSlots(config);

  // Schedule matches with 4-hour constraint
  const result = scheduleMatchesWithConstraints(
    matchGroups,
    timeSlots,
    config.numberOfCourts,
    config.matchDuration,
    config.slotFillingStrategy ?? 'smooth'
  );

  const warnings: string[] = [];
  if (result.unscheduledMatches.length > 0) {
    warnings.push(
      `⚠️ ${result.unscheduledMatches.length} match(es) n'ont pas pu être planifié(s) par manque de créneaux horaires. Ajoutez plus de jours ou de créneaux.`
    );
  }

  return {
    scheduledMatches: result.scheduledMatches,
    tournaments: config.tournaments,
    unscheduledMatches: result.unscheduledMatches,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

interface MatchGroup {
  tournamentId: string;
  bracket: MatchBracket;
  round: number;
  pending: Match[];
}

/**
 * Group matches by (tournament, bracket, round). Each group corresponds to
 * a bracket-round and is the unit the scheduler iterates on.
 */
function groupMatchesByTournamentBracketAndRound(matches: Match[]): MatchGroup[] {
  const groupMap = new Map<string, MatchGroup>();
  for (const match of matches) {
    const key = `${match.tournamentId}:${match.bracket}:${match.round}`;
    let g = groupMap.get(key);
    if (!g) {
      g = {
        tournamentId: match.tournamentId,
        bracket: match.bracket,
        round: match.round,
        pending: [],
      };
      groupMap.set(key, g);
    }
    g.pending.push(match);
  }
  return Array.from(groupMap.values()).sort((a, b) => a.round - b.round);
}

/**
 * Generate all available time slots based on configuration
 */
export function generateTimeSlots(config: GlobalConfig): TimeSlotInfo[] {
  const slots: TimeSlotInfo[] = [];
  const { startDate, endDate, matchDuration, dailyTimeSlots } = config;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Create a map of daily time slots by date
  const timeSlotMap = new Map<string, DailyTimeSlot>();
  dailyTimeSlots.forEach((slot) => {
    timeSlotMap.set(slot.date, slot);
  });

  // Iterate through each day
  for (
    let date = new Date(start);
    date <= end;
    date.setDate(date.getDate() + 1)
  ) {
    const dateStr = formatDate(date);
    const dailySlot = timeSlotMap.get(dateStr);

    if (!dailySlot) {
      continue; // Skip days without configured time slots
    }

    // Generate time slots for this day
    const daySlots = generateDayTimeSlots(
      dateStr,
      dailySlot.firstMatchStart,
      dailySlot.lastMatchStart,
      matchDuration
    );

    slots.push(...daySlots);
  }

  return slots;
}

export interface TimeSlotInfo {
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Generate time slots for a single day
 */
function generateDayTimeSlots(
  date: string,
  firstMatchStart: string,
  lastMatchStart: string,
  matchDuration: number
): TimeSlotInfo[] {
  const slots: TimeSlotInfo[] = [];

  const startMinutes = timeToMinutes(firstMatchStart);
  const lastStartMinutes = timeToMinutes(lastMatchStart);

  for (
    let currentMinutes = startMinutes;
    currentMinutes <= lastStartMinutes;
    currentMinutes += matchDuration
  ) {
    const startTime = minutesToTime(currentMinutes);
    const endTime = minutesToTime(currentMinutes + matchDuration);

    slots.push({
      date,
      startTime,
      endTime,
    });
  }

  return slots;
}

/**
 * Schedule matches filling all courts at each time slot.
 * All tournaments are interleaved to maximize court usage.
 *
 * Constraints:
 * - Sequential rounds: round n+1 of a tournament can only start once round n
 *   is fully scheduled across all brackets (per-tournament).
 * - 4-hour gap: enforced per (tournament, bracket). The first round of a
 *   consolante bracket falls back to the main bracket's last completed round
 *   end time, since consolante R1 players come from the main bracket.
 * - Last-round soft constraint: defer last round to the last day if possible.
 *
 * Finals are treated like any other match (no special grouping).
 */
function scheduleMatchesWithConstraints(
  groups: MatchGroup[],
  timeSlots: TimeSlotInfo[],
  numberOfCourts: number,
  matchDuration: number,
  fillingStrategy: SlotFillingStrategy
): { scheduledMatches: ScheduledMatch[]; unscheduledMatches: Match[] } {
  const scheduledMatches: ScheduledMatch[] = [];
  const MIN_HOURS_BETWEEN_MATCHES = 4 * 60; // 4 hours in minutes

  // Last round per tournament (soft constraint: prefer scheduling on the last day)
  const maxRoundByTournament = new Map<string, number>();
  groups.forEach(({ tournamentId, round }) => {
    const current = maxRoundByTournament.get(tournamentId) ?? 0;
    if (round > current) maxRoundByTournament.set(tournamentId, round);
  });
  const lastDay = timeSlots[timeSlots.length - 1].date;

  // Per-bracket end time of the last fully-scheduled round (key: `${tid}:${bracket}`)
  const bracketRoundEndTime = new Map<string, number>();
  // Per-tournament: last round fully scheduled across all its brackets
  const tournamentScheduledRound = new Map<string, number>();
  // Pending count per (tournament, round) — drives the per-tournament round completion
  const remainingByTournamentRound = new Map<string, number>();
  for (const g of groups) {
    const k = `${g.tournamentId}:${g.round}`;
    remainingByTournamentRound.set(k, (remainingByTournamentRound.get(k) ?? 0) + g.pending.length);
  }

  const bracketKey = (tid: string, b: MatchBracket) => `${tid}:${b}`;

  // Feeder end time for a bracket-round: same bracket's last completed round
  // if any, else fall back to the main bracket's last completed round.
  const getFeederEnd = (tid: string, bracket: MatchBracket): number => {
    const own = bracketRoundEndTime.get(bracketKey(tid, bracket));
    if (own !== undefined) return own;
    if (bracket === 'main') return -Infinity;
    return bracketRoundEndTime.get(bracketKey(tid, 'main')) ?? -Infinity;
  };

  const getAbsoluteMinutes = (slot: TimeSlotInfo) =>
    getSlotTimeInMinutes(slot, timeSlots[0]);

  const totalMatches = groups.reduce((sum, g) => sum + g.pending.length, 0);
  let scheduled = 0;

  for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
    const slot = timeSlots[slotIdx];
    const slotMinutes = getAbsoluteMinutes(slot);
    const isLastDay = slot.date === lastDay;
    let courtsUsed = 0;

    const remaining = totalMatches - scheduled;
    const mustScheduleNow = Math.max(0, remaining - (timeSlots.length - slotIdx - 1) * numberOfCourts);
    const allowedThisSlot = fillingStrategy === 'max'
      ? numberOfCourts
      : Math.min(
          numberOfCourts,
          Math.max(
            mustScheduleNow,
            Math.max(0, Math.round(totalMatches * (slotIdx + 1) / timeSlots.length) - scheduled)
          )
        );

    while (courtsUsed < allowedThisSlot) {
      let matchScheduled = false;

      for (const group of groups) {
        if (group.pending.length === 0) continue;

        const { tournamentId, bracket, round } = group;

        // Soft constraint: defer last-round matches to the last day unless forced
        const isLastRound = round === maxRoundByTournament.get(tournamentId);
        if (isLastRound && !isLastDay && courtsUsed >= mustScheduleNow) continue;

        // Sequential rounds (per-tournament): can't schedule round n+1 until round n is done
        const lastScheduledRound = tournamentScheduledRound.get(tournamentId) ?? 0;
        if (round > lastScheduledRound + 1) continue;

        // 4h gap (per-bracket, with fallback to main for consolante first rounds)
        const feederEnd = getFeederEnd(tournamentId, bracket);
        if (feederEnd > -Infinity && slotMinutes - feederEnd < MIN_HOURS_BETWEEN_MATCHES) continue;

        const match = group.pending.shift()!;
        scheduledMatches.push({
          match,
          court: courtsUsed + 1,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });

        // Update bracket end time when this bracket-round is fully scheduled
        if (group.pending.length === 0) {
          const endTime = slotMinutes + matchDuration;
          const bk = bracketKey(tournamentId, bracket);
          const currentEnd = bracketRoundEndTime.get(bk) ?? -Infinity;
          bracketRoundEndTime.set(bk, Math.max(currentEnd, endTime));
        }

        // Update tournament-level round completion (across all brackets)
        const trKey = `${tournamentId}:${round}`;
        const newRemaining = (remainingByTournamentRound.get(trKey) ?? 0) - 1;
        remainingByTournamentRound.set(trKey, newRemaining);
        if (newRemaining === 0) {
          const lastDone = tournamentScheduledRound.get(tournamentId) ?? 0;
          if (round > lastDone) tournamentScheduledRound.set(tournamentId, round);
        }

        courtsUsed++;
        scheduled++;
        matchScheduled = true;
        break;
      }

      if (!matchScheduled) break;
    }
  }

  const unscheduledMatches = groups.flatMap((g) => g.pending);
  return { scheduledMatches, unscheduledMatches };
}

/**
 * Get slot time in minutes from the start of the schedule
 */
function getSlotTimeInMinutes(slot: TimeSlotInfo, firstSlot: TimeSlotInfo): number {
  // Calculate days difference
  const slotDate = new Date(slot.date);
  const firstDate = new Date(firstSlot.date);
  const daysDiff = Math.floor((slotDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

  // Add time of day
  const timeInMinutes = timeToMinutes(slot.startTime);

  return daysDiff * 24 * 60 + timeInMinutes;
}

/**
 * Convert time string (HH:mm) to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to time string (HH:mm)
 */
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Try to insert previously-unscheduled matches into the existing schedule.
 *
 * Use case: after the user has manually moved matches around (drag-and-drop),
 * empty slots may have opened up that didn't exist when the schedule was first
 * generated. This function attempts to place each unscheduled match in the
 * earliest valid slot, respecting:
 *   - per-bracket 4-hour gap (feeder = same bracket's previous round, with
 *     fallback to main bracket if first round of consolante)
 *   - sequential-round constraint (per tournament)
 *   - court capacity
 *
 * The already-scheduled matches are NEVER moved. Only the unscheduled ones
 * are placed (in increasing round order so feeders are resolved first).
 */
export function retryUnscheduledMatches(schedule: Schedule, config: GlobalConfig): Schedule {
  const unscheduled = schedule.unscheduledMatches ?? [];
  if (unscheduled.length === 0) return schedule;

  const allSlots = generateTimeSlots(config);
  if (allSlots.length === 0) return schedule;

  const MIN_HOURS_BETWEEN_MATCHES = 4 * 60;
  const firstSlot = allSlots[0];

  const toAbsMinutes = (date: string, time: string) =>
    getSlotTimeInMinutes({ date, startTime: time, endTime: time }, firstSlot);

  const findFeederEnd = (
    placed: ScheduledMatch[],
    tournamentId: string,
    bracket: MatchBracket,
    round: number
  ): number => {
    const sameBracket = placed.filter(
      (sm) =>
        sm.match.tournamentId === tournamentId &&
        sm.match.bracket === bracket &&
        sm.match.round < round
    );
    const pool = sameBracket.length > 0
      ? sameBracket
      : bracket === 'main'
        ? []
        : placed.filter(
            (sm) =>
              sm.match.tournamentId === tournamentId &&
              sm.match.bracket === 'main' &&
              sm.match.round < round
          );
    return pool.length > 0
      ? Math.max(...pool.map((sm) => toAbsMinutes(sm.date, sm.endTime)))
      : -Infinity;
  };

  let scheduledMatches = [...schedule.scheduledMatches];
  const stillUnscheduled: Match[] = [];

  // Process in round order so an earlier-round match is placed before its
  // dependents (the next-round match in the same bracket).
  const queue = [...unscheduled].sort((a, b) => a.round - b.round);

  for (const match of queue) {
    // Sequential check: an earlier-round match in the same tournament that
    // we just gave up on blocks this one too.
    const earlierUnscheduled = stillUnscheduled.some(
      (m) => m.tournamentId === match.tournamentId && m.round < match.round
    );
    if (earlierUnscheduled) {
      stillUnscheduled.push(match);
      continue;
    }

    const feederEnd = findFeederEnd(scheduledMatches, match.tournamentId, match.bracket, match.round);

    let placed = false;
    for (const slot of allSlots) {
      const slotMinutes = getSlotTimeInMinutes(slot, firstSlot);
      if (feederEnd > -Infinity && slotMinutes - feederEnd < MIN_HOURS_BETWEEN_MATCHES) continue;

      const occupied = scheduledMatches.filter(
        (sm) => sm.date === slot.date && sm.startTime === slot.startTime
      );
      if (occupied.length >= config.numberOfCourts) continue;

      const occupiedCourts = new Set(occupied.map((sm) => sm.court));
      let court = 1;
      while (occupiedCourts.has(court)) court++;

      scheduledMatches.push({
        match,
        court,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
      });
      placed = true;
      break;
    }

    if (!placed) stillUnscheduled.push(match);
  }

  const warnings: string[] = [];
  if (stillUnscheduled.length > 0) {
    warnings.push(
      `⚠️ ${stillUnscheduled.length} match(es) n'ont toujours pas pu être planifié(s). Continuez d'ajuster manuellement puis réessayez.`
    );
  }

  return {
    ...schedule,
    scheduledMatches,
    unscheduledMatches: stillUnscheduled.length > 0 ? stillUnscheduled : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
