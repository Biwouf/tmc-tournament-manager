import type {
  GlobalConfig,
  Match,
  ScheduledMatch,
  Schedule,
  DailyTimeSlot,
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

  // Group matches by tournament and round
  const matchesByTournamentAndRound = groupMatchesByTournamentAndRound(allMatches);

  // Generate time slots
  const timeSlots = generateTimeSlots(config);

  // Schedule matches with 4-hour constraint
  const result = scheduleMatchesWithConstraints(
    matchesByTournamentAndRound,
    timeSlots,
    config.numberOfCourts,
    config.matchDuration
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

/**
 * Group matches by tournament and round
 */
function groupMatchesByTournamentAndRound(matches: Match[]): Map<string, Match[][]> {
  const tournamentMap = new Map<string, Match[][]>();

  // Group by tournament ID
  matches.forEach((match) => {
    if (!tournamentMap.has(match.tournamentId)) {
      tournamentMap.set(match.tournamentId, []);
    }
  });

  // For each tournament, group by round
  tournamentMap.forEach((_, tournamentId) => {
    const tournamentMatches = matches.filter((m) => m.tournamentId === tournamentId);
    const maxRound = Math.max(...tournamentMatches.map((m) => m.round));
    const roundsArray: Match[][] = [];

    for (let round = 1; round <= maxRound; round++) {
      const roundMatches = tournamentMatches.filter((m) => m.round === round);
      if (roundMatches.length > 0) {
        roundsArray.push(roundMatches);
      }
    }

    tournamentMap.set(tournamentId, roundsArray);
  });

  return tournamentMap;
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
 * 4-hour constraint is enforced per tournament between rounds.
 * Finals are treated like any other match (no special grouping).
 */
function scheduleMatchesWithConstraints(
  matchesByTournamentAndRound: Map<string, Match[][]>,
  timeSlots: TimeSlotInfo[],
  numberOfCourts: number,
  matchDuration: number
): { scheduledMatches: ScheduledMatch[]; unscheduledMatches: Match[] } {
  const scheduledMatches: ScheduledMatch[] = [];
  const MIN_HOURS_BETWEEN_MATCHES = 4 * 60; // 4 hours in minutes

  interface MatchGroup {
    tournamentId: string;
    roundIndex: number;
    pending: Match[];
  }

  const groups: MatchGroup[] = [];
  matchesByTournamentAndRound.forEach((rounds, tournamentId) => {
    rounds.forEach((matches, roundIndex) => {
      if (matches.length > 0) {
        groups.push({ tournamentId, roundIndex, pending: [...matches] });
      }
    });
  });
  groups.sort((a, b) => a.roundIndex - b.roundIndex);

  // Last round per tournament (soft constraint: prefer scheduling on the last day)
  const maxRoundByTournament = new Map<string, number>();
  groups.forEach(({ tournamentId, roundIndex }) => {
    const current = maxRoundByTournament.get(tournamentId) ?? -1;
    if (roundIndex > current) maxRoundByTournament.set(tournamentId, roundIndex);
  });
  const lastDay = timeSlots[timeSlots.length - 1].date;

  const tournamentRoundEndTime = new Map<string, number>();
  const tournamentScheduledRound = new Map<string, number>();

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
    const smoothTarget = Math.max(0, Math.round(totalMatches * (slotIdx + 1) / timeSlots.length) - scheduled);
    const allowedThisSlot = Math.min(numberOfCourts, Math.max(mustScheduleNow, smoothTarget));

    while (courtsUsed < allowedThisSlot) {
      let matchScheduled = false;

      for (const group of groups) {
        if (group.pending.length === 0) continue;

        const { tournamentId, roundIndex } = group;

        // Soft constraint: defer last-round matches to the last day unless forced
        const isLastRound = roundIndex === maxRoundByTournament.get(tournamentId);
        if (isLastRound && !isLastDay && courtsUsed >= mustScheduleNow) continue;

        const lastScheduledRound = tournamentScheduledRound.get(tournamentId) ?? -1;
        if (roundIndex > lastScheduledRound + 1) continue;

        const lastEndTime = tournamentRoundEndTime.get(tournamentId) ?? -Infinity;
        const isFirstRound = lastEndTime === -Infinity;
        if (!isFirstRound && slotMinutes - lastEndTime < MIN_HOURS_BETWEEN_MATCHES) continue;

        const match = group.pending.shift()!;
        scheduledMatches.push({
          match,
          court: courtsUsed + 1,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });

        if (group.pending.length === 0) {
          const endTime = slotMinutes + matchDuration;
          const currentEnd = tournamentRoundEndTime.get(tournamentId) ?? -Infinity;
          tournamentRoundEndTime.set(tournamentId, Math.max(currentEnd, endTime));
          tournamentScheduledRound.set(tournamentId, roundIndex);
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
