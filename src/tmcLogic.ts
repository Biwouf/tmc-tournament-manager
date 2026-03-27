import type { Match, TournamentConfig } from './types';

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

  // Currently only supporting power of 2 player counts
  if (!isPowerOfTwo(numPlayers)) {
    throw new Error('Le nombre de joueurs doit être une puissance de 2 (4, 8, 16, 32, etc.)');
  }

  switch (numPlayers) {
    case 4:
      return generateTMC4Players(tournamentConfig);
    case 8:
      return generateTMC8Players(tournamentConfig);
    case 16:
      return generateTMC16Players(tournamentConfig);
    default:
      throw new Error(`Nombre de joueurs non supporté: ${numPlayers}`);
  }
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
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
  let matchCounter = 1;

  // Semi-finals (2 matches)
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'semi-final',
      round: 1,
      playerSlots: [i * 2, i * 2 + 1],
      description: `Demi-finale ${i + 1}`,
    });
  }

  // Final
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'final',
    round: 2,
    playerSlots: [], // Winners of semi-finals
    description: 'Finale',
  });

  // 3rd place match
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-3-4',
    round: 2,
    playerSlots: [], // Losers of semi-finals
    description: 'Match pour la 3ème place',
  });

  return matches;
}

/**
 * Generate matches for 8 players TMC
 * - 4 quarter-finals
 * - 2 semi-finals
 * - 1 final
 * - 4 matches for places 5-8 (consolation bracket)
 * - 1 match for 3rd place
 * Total: 12 matches, each player plays 3 times
 */
function generateTMC8Players(config: TournamentConfig): Match[] {
  const matches: Match[] = [];
  let matchCounter = 1;

  // Quarter-finals (4 matches)
  for (let i = 0; i < 4; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'quarter-final',
      round: 1,
      playerSlots: [i * 2, i * 2 + 1],
      description: `Quart de finale ${i + 1}`,
    });
  }

  // Semi-finals (2 matches)
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'semi-final',
      round: 2,
      playerSlots: [], // Winners of QF i*2 and i*2+1
      description: `Demi-finale ${i + 1}`,
    });
  }

  // Final
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'final',
    round: 3,
    playerSlots: [], // Winners of semi-finals
    description: 'Finale',
  });

  // 3rd place match
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-3-4',
    round: 3,
    playerSlots: [], // Losers of semi-finals
    description: 'Match pour la 3ème place',
  });

  // Consolation bracket for places 5-8 (losers of quarter-finals)
  // Round 1 of consolation: 4 losers play 2 matches
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'ranking-5-8',
      round: 2,
      playerSlots: [], // Losers of QF i*2 and i*2+1
      description: `Classement 5-8 (Match ${i + 1})`,
    });
  }

  // Round 2 of consolation: determining 5-6 and 7-8
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 3,
    playerSlots: [], // Winners of consolation round 1
    description: 'Match pour la 5ème place',
  });

  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 3,
    playerSlots: [], // Losers of consolation round 1
    description: 'Match pour la 7ème place',
  });

  return matches;
}

/**
 * Generate matches for 16 players TMC
 * Total: 32 matches, each player plays 4 times
 *
 * Structure:
 * - Tableau principal (15 matches): 8×1/8, 4×1/4, 2×1/2, 1×finale
 * - Consolante 9-16 (12 matches): perdants des 1/8
 * - Consolante 5-8 (4 matches): perdants des 1/4 du tableau principal
 * - Consolante 3-4 (1 match): perdants des 1/2 du tableau principal
 */
function generateTMC16Players(config: TournamentConfig): Match[] {
  const matches: Match[] = [];
  let matchCounter = 1;

  // ===== TABLEAU PRINCIPAL (15 matches) =====

  // Round 1: 1/8 de finale (8 matches)
  for (let i = 0; i < 8; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'quarter-final',
      round: 1,
      playerSlots: [i * 2, i * 2 + 1],
      description: `1/8 de finale ${i + 1} (Tableau principal)`,
    });
  }

  // Round 2: 1/4 de finale (4 matches)
  for (let i = 0; i < 4; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'quarter-final',
      round: 2,
      playerSlots: [],
      description: `Quart de finale ${i + 1} (Tableau principal)`,
    });
  }

  // Round 3: 1/2 finale (2 matches)
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'semi-final',
      round: 3,
      playerSlots: [],
      description: `Demi-finale ${i + 1} (Tableau principal)`,
    });
  }

  // Round 4: Finale (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'final',
    round: 4,
    playerSlots: [],
    description: 'Finale',
  });

  // ===== CONSOLANTE 9-16 (12 matches) - Perdants des 1/8 =====

  // Round 2: 1/4 de finale consolante 9-16 (4 matches)
  for (let i = 0; i < 4; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'ranking-5-8',
      round: 2,
      playerSlots: [],
      description: `Quart de finale consolante 9-16 (Match ${i + 1})`,
    });
  }

  // Round 3: 1/2 finale consolante 9-12 (2 matches)
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'ranking-5-8',
      round: 3,
      playerSlots: [],
      description: `Demi-finale consolante 9-12 (Match ${i + 1})`,
    });
  }

  // Round 3: Consolante 13-16 - Perdants des 1/4 consolante (4 matches)
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'ranking-5-8',
      round: 3,
      playerSlots: [],
      description: `Demi-finale consolante 13-16 (Match ${i + 1})`,
    });
  }

  // Round 4: Finale consolante 9-10 (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 4,
    playerSlots: [],
    description: 'Match pour la 9ème place',
  });

  // Round 4: Match consolante 11-12 (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 4,
    playerSlots: [],
    description: 'Match pour la 11ème place',
  });

  // Round 4: Finale consolante 13-14 (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 4,
    playerSlots: [],
    description: 'Match pour la 13ème place',
  });

  // Round 4: Match consolante 15-16 (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 4,
    playerSlots: [],
    description: 'Match pour la 15ème place',
  });

  // ===== CONSOLANTE 5-8 (4 matches) - Perdants des 1/4 du tableau principal =====

  // Round 3: 1/2 finale consolante 5-8 (2 matches)
  for (let i = 0; i < 2; i++) {
    matches.push({
      id: `${config.id}-match-${matchCounter++}`,
      tournamentId: config.id,
      matchType: 'ranking-5-8',
      round: 3,
      playerSlots: [],
      description: `Demi-finale consolante 5-8 (Match ${i + 1})`,
    });
  }

  // Round 4: Finale consolante 5-6 (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 4,
    playerSlots: [],
    description: 'Match pour la 5ème place',
  });

  // Round 4: Match consolante 7-8 (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-5-8',
    round: 4,
    playerSlots: [],
    description: 'Match pour la 7ème place',
  });

  // ===== CONSOLANTE 3-4 (1 match) - Perdants des 1/2 du tableau principal =====

  // Round 4: Match pour la 3ème place (1 match)
  matches.push({
    id: `${config.id}-match-${matchCounter++}`,
    tournamentId: config.id,
    matchType: 'ranking-3-4',
    round: 4,
    playerSlots: [],
    description: 'Match pour la 3ème place',
  });

  return matches;
}

/**
 * Calculate total number of matches for a TMC tournament
 */
export function calculateTotalMatches(numberOfPlayers: number): number {
  if (!isPowerOfTwo(numberOfPlayers)) {
    return 0;
  }

  // Each player plays log2(n) matches
  // Total matches = (numberOfPlayers * matchesPerPlayer) / 2
  const matchesPerPlayer = Math.log2(numberOfPlayers);
  return (numberOfPlayers * matchesPerPlayer) / 2;
}
