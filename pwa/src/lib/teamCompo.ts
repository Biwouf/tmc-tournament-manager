// Compo lue sur la photo d'une feuille (Edge Function compo-scan) : classements admis et
// rapprochement des noms avec les membres du club. Aucune dépendance : testé par `npm run test:team-compo`.

export type CompoEntry = { ordre: number; prenom: string; nom: string; classement: string | null };
export type RosterMember = { id: string; prenom: string; nom: string; classement: string | null };

export const COMPO_RANKS = ['NC', '40', '30/5', '30/4', '30/3', '30/2', '30/1', '30', '15/5', '15/4', '15/3', '15/2', '15/1',
  '15', '5/6', '4/6', '3/6', '2/6', '1/6', '0', '-2/6', '-4/6', '-15', '-30'];
// Valeurs acceptées par profile_details.classement (pas de -30).
export const PROFILE_RANKS = COMPO_RANKS.filter(rank => rank !== '-30');

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z]+/g, ' ').trim();

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

const THRESHOLD = 0.75;

/** Membre le plus proche, ou null si aucun n'est assez proche ou si deux membres sont à égalité. */
export function matchMember(entry: { prenom: string; nom: string; classement: string | null }, roster: RosterMember[]): RosterMember | null {
  const name = normalize(`${entry.prenom} ${entry.nom}`);
  if (name.length < 3) return null;
  const scored = roster.map(member => {
    const score = Math.max(similarity(name, normalize(`${member.prenom} ${member.nom}`)), similarity(name, normalize(`${member.nom} ${member.prenom}`)));
    return { member, score: score + (entry.classement && entry.classement === member.classement ? 0.05 : 0) };
  }).sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < THRESHOLD) return null;
  if (second && second.score >= THRESHOLD && best.score - second.score < 0.05) return null;
  return best.member;
}
