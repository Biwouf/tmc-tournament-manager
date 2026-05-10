import type { ScheduledMatch, GlobalConfig, MatchBracket } from './types';
import { generateTimeSlots, type TimeSlotInfo } from './scheduler';

const MIN_HOURS_BETWEEN_MATCHES = 4 * 60;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toAbsoluteMinutes(date: string, time: string, referenceDate: string): number {
  const d = new Date(date);
  const ref = new Date(referenceDate);
  const daysDiff = Math.floor((d.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff * 24 * 60 + timeToMinutes(time);
}

/**
 * Find feeder matches for a given (tournament, bracket, round): the same
 * bracket's matches with round < n if any, else fall back to main bracket's
 * matches with round < n (since consolante R1 players come from the main
 * bracket). Returns [] if there's no feeder yet (first absolute round).
 */
function findFeederMatches(
  matches: ScheduledMatch[],
  tournamentId: string,
  bracket: MatchBracket,
  round: number,
  excludeIds: Set<string> = new Set()
): ScheduledMatch[] {
  const sameBracket = matches.filter(
    (m) =>
      m.match.tournamentId === tournamentId &&
      m.match.bracket === bracket &&
      m.match.round < round &&
      !excludeIds.has(m.match.id)
  );
  if (sameBracket.length > 0) return sameBracket;
  if (bracket === 'main') return [];
  return matches.filter(
    (m) =>
      m.match.tournamentId === tournamentId &&
      m.match.bracket === 'main' &&
      m.match.round < round &&
      !excludeIds.has(m.match.id)
  );
}

/**
 * Move a match to a new slot and cascade subsequent rounds forward
 * if the 4-hour constraint is violated.
 * Returns null if the move is invalid (slot full or 4h gap with previous round violated).
 */
export function moveMatch(
  scheduledMatches: ScheduledMatch[],
  matchId: string,
  newDate: string,
  newStartTime: string,
  config: GlobalConfig
): { scheduledMatches: ScheduledMatch[]; warnings: string[] } | null {
  const allSlots = generateTimeSlots(config);
  if (allSlots.length === 0) return null;

  const referenceDate = allSlots[0].date;

  const targetSlot = allSlots.find(s => s.date === newDate && s.startTime === newStartTime);
  if (!targetSlot) return null;

  const movingMatch = scheduledMatches.find(m => m.match.id === matchId);
  if (!movingMatch) return null;

  if (movingMatch.date === newDate && movingMatch.startTime === newStartTime) {
    return { scheduledMatches, warnings: [] };
  }

  // Check court capacity at target slot (excluding the moving match)
  const targetSlotOthers = scheduledMatches.filter(
    m => m.date === newDate && m.startTime === newStartTime && m.match.id !== matchId
  );
  if (targetSlotOthers.length >= config.numberOfCourts) return null;

  // Check 4h constraint with feeder bracket-round
  const { tournamentId, bracket, round } = movingMatch.match;
  const feederMatches = findFeederMatches(scheduledMatches, tournamentId, bracket, round);
  if (feederMatches.length > 0) {
    const feederEnd = Math.max(
      ...feederMatches.map(m => toAbsoluteMinutes(m.date, m.endTime, referenceDate))
    );
    const newStart = toAbsoluteMinutes(newDate, newStartTime, referenceDate);
    if (newStart - feederEnd < MIN_HOURS_BETWEEN_MATCHES) return null;
  }

  // Assign first available court at target slot
  const occupiedCourts = new Set(targetSlotOthers.map(m => m.court));
  let newCourt = 1;
  while (occupiedCourts.has(newCourt)) newCourt++;

  let updated = scheduledMatches.map(m =>
    m.match.id === matchId
      ? { ...m, date: newDate, startTime: newStartTime, endTime: targetSlot.endTime, court: newCourt }
      : m
  );

  const warnings: string[] = [];
  updated = cascadeForward(updated, tournamentId, round, config, allSlots, referenceDate, warnings);

  return { scheduledMatches: updated, warnings };
}

/**
 * Move multiple matches to the same target slot.
 * Returns null if the move is invalid for any match.
 */
export function moveMatches(
  scheduledMatches: ScheduledMatch[],
  matchIds: string[],
  newDate: string,
  newStartTime: string,
  config: GlobalConfig
): { scheduledMatches: ScheduledMatch[]; warnings: string[] } | null {
  if (matchIds.length === 0) return null;
  if (matchIds.length === 1) return moveMatch(scheduledMatches, matchIds[0], newDate, newStartTime, config);

  const allSlots = generateTimeSlots(config);
  if (allSlots.length === 0) return null;

  const referenceDate = allSlots[0].date;

  const targetSlot = allSlots.find(s => s.date === newDate && s.startTime === newStartTime);
  if (!targetSlot) return null;

  const movingMatches = matchIds.map(id => scheduledMatches.find(m => m.match.id === id)).filter(Boolean) as ScheduledMatch[];
  if (movingMatches.length !== matchIds.length) return null;

  // Check court capacity: existing matches at target slot (excluding moving ones) + moving ones must fit
  const targetSlotOthers = scheduledMatches.filter(
    m => m.date === newDate && m.startTime === newStartTime && !matchIds.includes(m.match.id)
  );
  if (targetSlotOthers.length + movingMatches.length > config.numberOfCourts) return null;

  // Check 4h constraint with feeder bracket-round for each moving match
  const movingIds = new Set(matchIds);
  for (const movingMatch of movingMatches) {
    const { tournamentId, bracket, round } = movingMatch.match;
    const feederMatches = findFeederMatches(scheduledMatches, tournamentId, bracket, round, movingIds);
    if (feederMatches.length > 0) {
      const feederEnd = Math.max(
        ...feederMatches.map(m => toAbsoluteMinutes(m.date, m.endTime, referenceDate))
      );
      const newStart = toAbsoluteMinutes(newDate, newStartTime, referenceDate);
      if (newStart - feederEnd < MIN_HOURS_BETWEEN_MATCHES) return null;
    }
  }

  // Assign courts sequentially
  const occupiedCourts = new Set(targetSlotOthers.map(m => m.court));
  let updated = scheduledMatches;
  for (const match of movingMatches) {
    let court = 1;
    while (occupiedCourts.has(court)) court++;
    occupiedCourts.add(court);
    updated = updated.map(m =>
      m.match.id === match.match.id
        ? { ...m, date: newDate, startTime: newStartTime, endTime: targetSlot.endTime, court }
        : m
    );
  }

  // Cascade forward for each affected tournament
  const warnings: string[] = [];
  const affectedTournaments = new Map<string, number>(); // tournamentId → max moved round
  for (const match of movingMatches) {
    const { tournamentId, round } = match.match;
    const current = affectedTournaments.get(tournamentId) ?? 0;
    if (round > current) affectedTournaments.set(tournamentId, round);
  }

  for (const [tournamentId, fromRound] of affectedTournaments) {
    updated = cascadeForward(updated, tournamentId, fromRound, config, allSlots, referenceDate, warnings);
  }

  return { scheduledMatches: updated, warnings };
}

function cascadeForward(
  matches: ScheduledMatch[],
  tournamentId: string,
  fromRound: number,
  config: GlobalConfig,
  allSlots: TimeSlotInfo[],
  referenceDate: string,
  warnings: string[]
): ScheduledMatch[] {
  const getTournamentMatches = () => matches.filter(m => m.match.tournamentId === tournamentId);
  const maxRound = Math.max(...getTournamentMatches().map(m => m.match.round));

  for (let round = fromRound + 1; round <= maxRound; round++) {
    const thisRoundMatches = getTournamentMatches().filter(m => m.match.round === round);
    if (thisRoundMatches.length === 0) continue;

    // Group by bracket — the 4h gap is enforced per bracket lineage
    const brackets = [...new Set(thisRoundMatches.map(m => m.match.bracket))];
    let anyCascadedForBracket = false;

    for (const bracket of brackets) {
      const bracketMatches = thisRoundMatches.filter(m => m.match.bracket === bracket);
      const feederMatches = findFeederMatches(matches, tournamentId, bracket, round);
      if (feederMatches.length === 0) continue;

      const feederEnd = Math.max(
        ...feederMatches.map(m => toAbsoluteMinutes(m.date, m.endTime, referenceDate))
      );
      const earliestStart = Math.min(
        ...bracketMatches.map(m => toAbsoluteMinutes(m.date, m.startTime, referenceDate))
      );
      if (earliestStart - feederEnd >= MIN_HOURS_BETWEEN_MATCHES) continue;

      anyCascadedForBracket = true;
      const minValidAbsoluteMinutes = feederEnd + MIN_HOURS_BETWEEN_MATCHES;

      const sortedRoundMatches = [...bracketMatches].sort((a, b) =>
        toAbsoluteMinutes(a.date, a.startTime, referenceDate) -
        toAbsoluteMinutes(b.date, b.startTime, referenceDate)
      );

      let slotSearchStart = minValidAbsoluteMinutes;
      for (const matchToMove of sortedRoundMatches) {
        let placed = false;

        for (const slot of allSlots) {
          const slotAbs = toAbsoluteMinutes(slot.date, slot.startTime, referenceDate);
          if (slotAbs < slotSearchStart) continue;

          const occupiedAtSlot = matches.filter(
            m => m.date === slot.date && m.startTime === slot.startTime && m.match.id !== matchToMove.match.id
          );
          if (occupiedAtSlot.length >= config.numberOfCourts) continue;

          const occupiedCourts = new Set(occupiedAtSlot.map(m => m.court));
          let court = 1;
          while (occupiedCourts.has(court)) court++;

          matches = matches.map(m =>
            m.match.id === matchToMove.match.id
              ? { ...m, date: slot.date, startTime: slot.startTime, endTime: slot.endTime, court }
              : m
          );

          slotSearchStart = slotAbs;
          placed = true;
          break;
        }

        if (!placed) {
          warnings.push(`⚠️ Le match "${matchToMove.match.description}" n'a pas pu être recalé (plus de créneaux disponibles).`);
        }
      }
    }

    // If no bracket needed cascading at this round, subsequent rounds can't be
    // tighter either (the move only pushes things forward), so we can stop.
    if (!anyCascadedForBracket) break;
  }

  return matches;
}
