// Faits d'une ou plusieurs rencontres par équipe, tels qu'envoyés à Claude par l'Edge Function
// `generate-post` et montrés en aperçu dans le BO (`ActuGeneratePage`) : les deux passent par ce
// module, l'aperçu montre donc exactement ce qui part.
//
// Minimisation (RGPD) : seuls les prénoms des joueurs du club partent. Ni nom de famille, ni
// classement, ni joueur adverse, ni identifiant. Un « prénom » importé de Ten'Up peut contenir le
// nom complet (« Jean DUPONT ») : les mots tout en majuscules en sont retirés.
//
// Les incohérences sont détectées ici, en code, et rendues en `warnings` : on ne compte pas
// seulement sur le modèle pour les voir.

/** Points d'un double par format — même table que FORMAT_SPECS (teamMatchLabels.ts), vérifiée par test. */
export const FORMAT_POINTS = {
  '2S1D': { simples: 2, doubles: 1, doublePoints: 1 },
  '3S1D': { simples: 3, doubles: 1, doublePoints: 1 },
  '3S1D2': { simples: 3, doubles: 1, doublePoints: 2 },
  '4S1D2': { simples: 4, doubles: 1, doublePoints: 2 },
  '4S2D': { simples: 4, doubles: 2, doublePoints: 1 },
};

const GENRES = { hommes: 'Messieurs', femmes: 'Dames', mixte: 'Mixte', garcons: 'Garçons', filles: 'Filles' };
const STADES = { '1/16': '1/16 de finale', '1/8': '1/8 de finale', '1/4': '1/4 de finale', '1/2': 'demi-finale', finale: 'finale' };
const CATEGORIES = { seniors: 'Seniors', '35_ans': '+35 ans', '60_ans': '+60 ans', '17_18': '17/18 ans', '15_16': '15/16 ans', '13_14': '13/14 ans', '11_12': '11/12 ans' };

export const NOTE_MAX = 300;
export const CONTEXTE_MAX = 200;
export const MAX_RENCONTRES = 12;

const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Prénom seul : les mots tout en majuscules (nom de famille Ten'Up) sont retirés. */
export function firstName(player) {
  const raw = text(player?.prenom, 60);
  const kept = raw.split(' ').filter(word => !(word.length > 1 && word === word.toUpperCase() && /\p{Lu}/u.test(word)));
  return kept.join(' ').slice(0, 40);
}

function dateLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function resultLabel(club, adverse) {
  if (club === null || adverse === null || club === undefined || adverse === undefined) return null;
  return club > adverse ? 'victoire' : club < adverse ? 'défaite' : 'nul';
}

/**
 * @param {{ rencontres: Array<{ rencontre: any, etape: any, equipe: any, competition: any, lines: any[] }>,
 *           extras?: Record<string, { note?: string, contexte?: string }> }} input
 */
export function buildPostFacts({ rencontres, extras = {} }) {
  const warnings = [];
  const sorted = [...rencontres].sort((a, b) =>
    String(a.competition.genre).localeCompare(String(b.competition.genre)) ||
    String(a.equipe.id).localeCompare(String(b.equipe.id)) ||
    String(a.rencontre.date_heure).localeCompare(String(b.rencontre.date_heure)));

  const facts = sorted.map(({ rencontre, etape, equipe, competition, lines }, index) => {
    const genre = GENRES[competition.genre] ?? '';
    const categorie = CATEGORIES[competition.categorie] ?? text(competition.categorie, 40);
    const equipeLabel = `${genre} ${categorie}${equipe.numero > 1 ? ` (équipe ${equipe.numero})` : ''}`.trim();
    const where = `${equipeLabel} contre ${text(rencontre.club_adverse, 80)}`;
    const club = rencontre.score_club ?? null;
    const adverse = rencontre.score_adverse ?? null;
    const format = FORMAT_POINTS[competition.format];

    const matchs = [...lines]
      .sort((a, b) => Number(a.match_type === 'double') - Number(b.match_type === 'double') || (a.slot ?? a.ordre) - (b.slot ?? b.ordre))
      .map(line => {
        const joueurs = (Array.isArray(line.joueurs_club) ? line.joueurs_club : []).map(firstName);
        if (joueurs.some(name => !name)) warnings.push(`${where} : un joueur du ${line.match_type} n'a pas de prénom renseigné.`);
        if (line.gagnant && !text(line.score, 60) && line.result_kind !== 'wo') warnings.push(`${where} : un ${line.match_type} a un vainqueur mais pas de score.`);
        return {
          type: line.match_type,
          joueurs: joueurs.filter(Boolean),
          score: text(line.score, 60) || null,
          vainqueur: line.gagnant === 'club' ? 'club' : line.gagnant === 'adverse' ? 'adversaire' : null,
          issue: line.result_kind === 'wo' ? 'forfait' : line.result_kind === 'retired' ? 'abandon' : null,
        };
      });

    if (club === null || adverse === null) {
      warnings.push(`${where} : le score de la rencontre n'est pas renseigné.`);
    } else if (!rencontre.wo && format && lines.length > 0) {
      const expected = format.simples + format.doubles;
      if (lines.length === expected && lines.every(line => line.gagnant)) {
        let c = 0, a = 0;
        for (const line of lines) {
          const points = line.match_type === 'double' ? format.doublePoints : 1;
          if (line.gagnant === 'club') c += points; else a += points;
        }
        if (c !== club || a !== adverse) warnings.push(`${where} : le score global (${club}-${adverse}) ne correspond pas aux matchs (${c}-${a}).`);
      } else {
        warnings.push(`${where} : tous les matchs ne sont pas renseignés, seuls le score global et les matchs connus sont utilisés.`);
      }
    }

    const extra = extras[rencontre.id] ?? {};
    return {
      // Repère court que Claude renvoie pour dire quel paragraphe parle de quelle rencontre.
      ref: `R${index + 1}`,
      equipe: equipeLabel,
      jeunes: competition.type === 'jeunes',
      competition: text(competition.nom, 80),
      division: text(equipe.division, 20) || null,
      journee: etape.phase === 'poule' ? `journée ${etape.numero_journee}` : (STADES[etape.stade_finale] ?? 'phase finale'),
      date: dateLabel(rencontre.date_heure),
      lieu: rencontre.domicile ? 'domicile' : 'extérieur',
      adversaire: text(rencontre.club_adverse, 80),
      score: club === null || adverse === null ? null : `${club}-${adverse}`,
      resultat: resultLabel(club, adverse),
      forfait: !!rencontre.wo,
      matchs,
      note: text(extra.note, NOTE_MAX) || null,
      contexte_classement: text(extra.contexte, CONTEXTE_MAX) || null,
    };
  });
  // ids[i] : rencontre de facts[i] (et donc du repère `R${i + 1}`).
  return { facts, warnings, ids: sorted.map(({ rencontre }) => rencontre.id) };
}
