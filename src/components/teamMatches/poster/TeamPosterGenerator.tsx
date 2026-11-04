import { Link } from 'react-router-dom';
import { useTeamSaisons } from '../useTeamSaisons';
import { useTeamSeasonGrid } from '../useTeamSeasonGrid';
import PosterPanel from './PosterPanel';

/**
 * Monté avec `key={saisonId}` : `useTeamSeasonGrid` garde les rencontres de l'ancienne saison
 * jusqu'à sa réponse, et `PosterPanel` initialise sa présélection une seule fois, au montage.
 */
function SeasonPoster({ saisonId }: { saisonId: string }) {
  const { loading, error, entries } = useTeamSeasonGrid(saisonId);

  if (error) return <p className="text-sm text-destructive">Erreur de chargement : {error}</p>;
  if (loading) return <p className="text-sm text-muted-foreground">Chargement des rencontres…</p>;
  return (
    <div className="max-w-2xl rounded-xl border border-border bg-card">
      <PosterPanel entries={entries} />
    </div>
  );
}

/** Affiche des rencontres à venir dans `/medias` : choix de la saison, puis `PosterPanel`. */
export default function TeamPosterGenerator() {
  const { saisons, error, ready, saisonId, selectSaison } = useTeamSaisons();

  return (
    <main className="container mx-auto px-4 py-8 space-y-6">
      {error ? (
        <p className="text-sm text-destructive">Erreur de chargement : {error}</p>
      ) : !ready ? (
        <p className="text-sm text-muted-foreground">Chargement des saisons…</p>
      ) : saisons.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          Aucune saison.{' '}
          <Link to="/team-matches/admin" className="font-semibold text-primary hover:underline">
            Créez-en une dans le référentiel
          </Link>
          .
        </div>
      ) : (
        <>
          <label className="flex items-center gap-3 text-sm font-medium">
            Saison
            <select
              value={saisonId}
              onChange={(e) => selectSaison(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal"
            >
              {saisons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.actif ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </label>
          <SeasonPoster key={saisonId} saisonId={saisonId} />
        </>
      )}
    </main>
  );
}
