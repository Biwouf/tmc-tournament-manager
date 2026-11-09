import type { LiveSet3Format, TeamFormat, TeamGenre } from '../../types';
import { FORMAT_LABELS, GENRE_LABELS, GENRES_BY_TYPE } from '../teamMatches/teamMatchLabels';
import type { CompetitionDraft, missingFields } from '../teamMatches/teamImport';

// Les champs d'une compétition que TEN'UP n'a pas permis de déduire (genre, format, 3e set), demandés
// en ligne avant toute création. Partagé par l'import d'une poule et l'import du club (S6, S6b).
export default function DraftFields({ draft, asked, onChange }: {
  draft: CompetitionDraft;
  asked: ReturnType<typeof missingFields>;
  onChange: (draft: CompetitionDraft) => void;
}) {
  return <>
    {asked.includes('genre') && (
      <fieldset className="fs-fieldset">
        <legend className="fs-label">Genre</legend>
        <div className="fs-seg">
          {GENRES_BY_TYPE[draft.type].map((genre: TeamGenre) => (
            <button key={genre} type="button" className="fs-btn fs-btn-o" aria-pressed={draft.genre === genre}
              onClick={() => onChange({ ...draft, genre })}>{GENRE_LABELS[genre]}</button>
          ))}
        </div>
      </fieldset>
    )}
    {asked.includes('format') && (
      <label className="fs-label">Format des rencontres
          <select className="fs-input" value={draft.format ?? ''} onChange={(e) => onChange({ ...draft, format: (e.target.value || null) as TeamFormat | null })}>
            <option value="">Choisir…</option>
            {(Object.keys(FORMAT_LABELS) as TeamFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
          </select>
        </label>
    )}
    {asked.includes('singles_set3_format') && (
      <fieldset className="fs-fieldset">
        <legend className="fs-label">Troisième set des simples</legend>
        <div className="fs-seg">
          {([['normal', 'Set classique'], ['super_tiebreak', 'Super tie-break']] as [LiveSet3Format, string][]).map(([value, label]) => (
            <button key={value} type="button" className="fs-btn fs-btn-o" aria-pressed={draft.singles_set3_format === value}
              onClick={() => onChange({ ...draft, singles_set3_format: value })}>{label}</button>
          ))}
        </div>
      </fieldset>
    )}
  </>;
}
