import type { TeamFormat, TeamJoueur, TeamMatchLine, TeamRencontre } from '../../../types';
import { computeScore, expectedMatchCount } from '../teamMatchLabels.ts';

export function finalResult(rencontre: TeamRencontre, lines: TeamMatchLine[], format: TeamFormat) {
  const saved = rencontre.score_club !== null && rencontre.score_adverse !== null;
  if (rencontre.wo || lines.length === 0) {
    return saved ? { club: rencontre.score_club!, adverse: rencontre.score_adverse! } : null;
  }
  if (lines.length !== expectedMatchCount(format) || lines.some(line => !line.gagnant)) return null;
  return computeScore(lines, format);
}

/** A cover crop that never exposes blank edges, including when zoomed. */
export function photoCrop(iw: number, ih: number, width: number, height: number, x: number, y: number, zoom: number) {
  const scale = Math.max(width / iw, height / ih) * zoom;
  const sw = width / scale;
  const sh = height / scale;
  return { sx: Math.max(0, Math.min(iw - sw, iw * x / 100 - sw / 2)), sy: Math.max(0, Math.min(ih - sh, ih * y / 100 - sh / 2)), sw, sh };
}

/** Social posters list singles first, regardless of the order of match entry. */
export function orderedResultLines(lines: TeamMatchLine[]) {
  return [...lines].sort((a, b) =>
    Number(a.match_type === 'double') - Number(b.match_type === 'double') ||
    (a.slot ?? a.ordre) - (b.slot ?? b.ordre) || a.ordre - b.ordre
  );
}

export function posterPlayerLabel(player: TeamJoueur) {
  const name = [player.prenom, player.nom].filter(Boolean).join(' ') || 'Joueur non renseigné';
  return `${name} (${player.classement?.trim() || 'Classement non renseigné'})`;
}
