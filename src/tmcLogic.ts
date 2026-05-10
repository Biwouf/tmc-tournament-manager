import type { Match, MatchBracket, MatchType, TournamentConfig } from './types';

/**
 * Generate all matches for a TMC tournament
 * In TMC, each player plays the same number of matches
 *
 * For 8 players:
 * - Main draw: 4 quarter-finals, 2 semi-finals, 1 final = 7 matches
 * - Ranking: 4 matches for places 5-8, 1 match for 3rd place = 5 matches
 * - Total: 12 matches, each player plays 3 times
 */
export function generateTMCMatches(tournamentConfig: TournamentConfig): Match[] {
  const numPlayers = tournamentConfig.numberOfPlayers;

  switch (numPlayers) {
    case 4:
      return generateTMC4Players(tournamentConfig);
    case 8:
      return generateTMC8Players(tournamentConfig);
    case 12:
      return generateTMC12Players(tournamentConfig);
    case 16:
      return generateTMC16Players(tournamentConfig);
    case 24:
      return generateTMC24Players(tournamentConfig);
    default:
      throw new Error(`Nombre de joueurs non supporté: ${numPlayers} (valeurs autorisées : 4, 8, 12, 16, 24)`);
  }
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function makePusher(config: TournamentConfig, matches: Match[]) {
  let counter = 1;
  return (matchType: MatchType, bracket: MatchBracket, round: number, description: string, playerSlots: number[] = []) => {
    matches.push({
      id: `${config.id}-match-${counter++}`,
      tournamentId: config.id,
      matchType,
      bracket,
      round,
      playerSlots,
      description,
    });
  };
}

/**
 * Generate matches for 4 players TMC
 * - 2 semi-finals
 * - 1 final
 * - 1 match for 3rd place
 * Total: 4 matches, each player plays 2 times
 */
function generateTMC4Players(config: TournamentConfig): Match[] {
  const matches: Match[] = [];
  const push = makePusher(config, matches);

  for (let i = 0; i < 2; i++) {
    push('semi-final', 'main', 1, `Demi-finale ${i + 1}`, [i * 2, i * 2 + 1]);
  }
  push('final', 'main', 2, 'Finale');
  push('ranking-3-4', 'main', 2, 'Match pour la 3ème place');

  return matches;
}

/**
 * Generate matches for 8 players TMC
 * Total: 12 matches, each player plays 3 times
 * Brackets: main (8 matches) + cons-5-8 (4 matches)
 */
function generateTMC8Players(config: TournamentConfig): Match[] {
  const matches: Match[] = [];
  const push = makePusher(config, matches);

  // Main: QF (R1), SF (R2), F + 3e (R3)
  for (let i = 0; i < 4; i++) {
    push('quarter-final', 'main', 1, `Quart de finale ${i + 1}`, [i * 2, i * 2 + 1]);
  }
  for (let i = 0; i < 2; i++) {
    push('semi-final', 'main', 2, `Demi-finale ${i + 1}`);
  }
  push('final', 'main', 3, 'Finale');
  push('ranking-3-4', 'main', 3, 'Match pour la 3ème place');

  // Consolante 5-8: R2 (2 matches between QF losers), R3 (5e + 7e)
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-5-8', 2, `Classement 5-8 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-5-8', 3, 'Match pour la 5ème place');
  push('ranking-5-8', 'cons-5-8', 3, 'Match pour la 7ème place');

  return matches;
}

/**
 * Generate matches for 12 players TMC (asymmetric bracket)
 *
 * 4 players are exempted from round 1; the other 8 play the 1/8 finals.
 * Total: 20 matches, 4 rounds.
 * Brackets: main (12) + cons-9-12 (4) + cons-5-8 (4)
 *
 * Matches per player varies (asymmetric):
 * - exempted, or non-exempted losing R1: 3 matches
 * - non-exempted winning R1: 4 matches
 */
function generateTMC12Players(config: TournamentConfig): Match[] {
  const matches: Match[] = [];
  const push = makePusher(config, matches);

  // Main: 1/8 (R1), 1/4 (R2), 1/2 (R3), F + 3e (R4)
  for (let i = 0; i < 4; i++) {
    push('quarter-final', 'main', 1, `1/8 de finale ${i + 1}`, [i * 2, i * 2 + 1]);
  }
  for (let i = 0; i < 4; i++) {
    push('quarter-final', 'main', 2, `Quart de finale ${i + 1} (Tableau principal)`);
  }
  for (let i = 0; i < 2; i++) {
    push('semi-final', 'main', 3, `Demi-finale ${i + 1} (Tableau principal)`);
  }
  push('final', 'main', 4, 'Finale');
  push('ranking-3-4', 'main', 4, 'Match pour la 3ème place');

  // Consolante 9-12: SF (R2), finales 9 + 11 (R3)
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-9-12', 2, `Demi-finale consolante 9-12 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-9-12', 3, 'Match pour la 9ème place');
  push('ranking-5-8', 'cons-9-12', 3, 'Match pour la 11ème place');

  // Consolante 5-8: SF (R3), finales 5 + 7 (R4)
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-5-8', 3, `Demi-finale consolante 5-8 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-5-8', 4, 'Match pour la 5ème place');
  push('ranking-5-8', 'cons-5-8', 4, 'Match pour la 7ème place');

  return matches;
}

/**
 * Generate matches for 16 players TMC
 * Total: 32 matches, each player plays 4 times
 *
 * Brackets:
 * - main (16): 8×1/8 + 4×1/4 + 2×1/2 + 1×finale + 1×3e
 * - cons-9-16 (12): 4 QF + 2 SF 9-12 + 2 SF 13-16 + 4 finales (9, 11, 13, 15)
 * - cons-5-8 (4): 2 SF + 2 finales (5, 7)
 */
function generateTMC16Players(config: TournamentConfig): Match[] {
  const matches: Match[] = [];
  const push = makePusher(config, matches);

  // Main draw
  for (let i = 0; i < 8; i++) {
    push('quarter-final', 'main', 1, `1/8 de finale ${i + 1} (Tableau principal)`, [i * 2, i * 2 + 1]);
  }
  for (let i = 0; i < 4; i++) {
    push('quarter-final', 'main', 2, `Quart de finale ${i + 1} (Tableau principal)`);
  }
  for (let i = 0; i < 2; i++) {
    push('semi-final', 'main', 3, `Demi-finale ${i + 1} (Tableau principal)`);
  }
  push('final', 'main', 4, 'Finale');
  push('ranking-3-4', 'main', 4, 'Match pour la 3ème place');

  // Consolante 9-16
  for (let i = 0; i < 4; i++) {
    push('ranking-5-8', 'cons-9-16', 2, `Quart de finale consolante 9-16 (Match ${i + 1})`);
  }
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-9-16', 3, `Demi-finale consolante 9-12 (Match ${i + 1})`);
  }
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-9-16', 3, `Demi-finale consolante 13-16 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 9ème place');
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 11ème place');
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 13ème place');
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 15ème place');

  // Consolante 5-8
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-5-8', 3, `Demi-finale consolante 5-8 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-5-8', 4, 'Match pour la 5ème place');
  push('ranking-5-8', 'cons-5-8', 4, 'Match pour la 7ème place');

  return matches;
}

/**
 * Generate matches for 24 players TMC (asymmetric bracket)
 *
 * 8 seeded players enter directly in the 1/8 finals; the 16 others play an
 * additional 1/16 round. Total: 48 matches over 5 rounds.
 *
 * Principle: every player plays at least 4 matches, except seeds who lose
 * their 1/8 (3 matches). To avoid forcing 5 matches on a non-seed who keeps
 * winning, we assume they will lose at the 1/8 stage; if they end up reaching
 * the main 1/4 or beyond, the 5th match is "managed live" (forfeit possible).
 *
 * Brackets:
 * - main (24): 1/16, 1/8, 1/4, 1/2, finale + 3e
 * - cons-17-24 (12): QF + SF + finales (17, 19, 21, 23)
 * - cons-9-16 (8): QF + finales (9, 11, 13, 15)
 * - cons-5-8 (4): SF + finales (5, 7)
 */
function generateTMC24Players(config: TournamentConfig): Match[] {
  const matches: Match[] = [];
  const push = makePusher(config, matches);

  // Main draw: 1/16 (R1), 1/8 (R2), 1/4 (R3), 1/2 (R4), F + 3e (R5)
  for (let i = 0; i < 8; i++) {
    push('quarter-final', 'main', 1, `1/16 de finale ${i + 1}`, [i * 2, i * 2 + 1]);
  }
  for (let i = 0; i < 8; i++) {
    push('quarter-final', 'main', 2, `1/8 de finale ${i + 1} (Tableau principal)`);
  }
  for (let i = 0; i < 4; i++) {
    push('quarter-final', 'main', 3, `Quart de finale ${i + 1} (Tableau principal)`);
  }
  for (let i = 0; i < 2; i++) {
    push('semi-final', 'main', 4, `Demi-finale ${i + 1} (Tableau principal)`);
  }
  push('final', 'main', 5, 'Finale');
  push('ranking-3-4', 'main', 5, 'Match pour la 3ème place');

  // Consolante 17-24: QF (R2), SF (R3), finales (R4)
  for (let i = 0; i < 4; i++) {
    push('ranking-5-8', 'cons-17-24', 2, `Quart de finale consolante 17-24 (Match ${i + 1})`);
  }
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-17-24', 3, `Demi-finale consolante 17-20 (Match ${i + 1})`);
  }
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-17-24', 3, `Demi-finale consolante 21-24 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-17-24', 4, 'Match pour la 17ème place');
  push('ranking-5-8', 'cons-17-24', 4, 'Match pour la 19ème place');
  push('ranking-5-8', 'cons-17-24', 4, 'Match pour la 21ème place');
  push('ranking-5-8', 'cons-17-24', 4, 'Match pour la 23ème place');

  // Consolante 9-16: QF (R3), finales (R4)
  for (let i = 0; i < 4; i++) {
    push('ranking-5-8', 'cons-9-16', 3, `Quart de finale consolante 9-16 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 9ème place');
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 11ème place');
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 13ème place');
  push('ranking-5-8', 'cons-9-16', 4, 'Match pour la 15ème place');

  // Consolante 5-8: SF (R4), finales (R5)
  for (let i = 0; i < 2; i++) {
    push('ranking-5-8', 'cons-5-8', 4, `Demi-finale consolante 5-8 (Match ${i + 1})`);
  }
  push('ranking-5-8', 'cons-5-8', 5, 'Match pour la 5ème place');
  push('ranking-5-8', 'cons-5-8', 5, 'Match pour la 7ème place');

  return matches;
}

/**
 * Calculate total number of matches for a TMC tournament
 */
export function calculateTotalMatches(numberOfPlayers: number): number {
  if (numberOfPlayers === 12) {
    // Asymmetric bracket — see generateTMC12Players
    return 20;
  }
  if (numberOfPlayers === 24) {
    // Asymmetric bracket — see generateTMC24Players
    return 48;
  }
  if (!isPowerOfTwo(numberOfPlayers)) {
    return 0;
  }

  // Each player plays log2(n) matches
  // Total matches = (numberOfPlayers * matchesPerPlayer) / 2
  const matchesPerPlayer = Math.log2(numberOfPlayers);
  return (numberOfPlayers * matchesPerPlayer) / 2;
}

/**
 * Total number of rounds for a TMC tournament (used for display "Match R/N").
 * For power-of-2 brackets, equals log2(n) (also = matches per player).
 * For 12 players (asymmetric), returns 4.
 * For 24 players (asymmetric), returns 5.
 */
export function getTotalRounds(numberOfPlayers: number): number {
  if (numberOfPlayers === 12) return 4;
  if (numberOfPlayers === 24) return 5;
  if (!isPowerOfTwo(numberOfPlayers)) return 0;
  return Math.log2(numberOfPlayers);
}
