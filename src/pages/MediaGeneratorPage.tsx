import { Link, useSearchParams } from 'react-router-dom';
import TeamPosterGenerator from '../components/teamMatches/poster/TeamPosterGenerator';
import ProgrammationImagePage from './ProgrammationImagePage';

type MediaType = 'tournoi' | 'equipes';

const MEDIA_TYPES: { key: MediaType; label: string; description: string }[] = [
  { key: 'tournoi', label: 'Tournoi', description: 'Programme à venir ou résultats, depuis une feuille Ten’Up.' },
  { key: 'equipes', label: 'Matches par équipe', description: 'Affiche des rencontres à venir et sa story vidéo.' },
];

export default function MediaGeneratorPage() {
  const [params, setParams] = useSearchParams();
  const type: MediaType = params.get('type') === 'equipes' ? 'equipes' : 'tournoi';

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto px-4 py-8">
          <Link
            to="/"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            ← Accueil
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Génération de médias</h1>
        </div>
      </header>

      <div className="container mx-auto px-4 pt-8">
        <h2 className="mb-3 text-lg font-semibold">Quel média générer ?</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {MEDIA_TYPES.map(({ key, label, description }) => (
            <button
              key={key}
              type="button"
              aria-pressed={type === key}
              onClick={() => setParams(key === 'tournoi' ? {} : { type: key })}
              className={`rounded-xl border bg-card p-4 text-left transition ${
                type === key ? 'border-primary ring-2 ring-primary' : 'border-border hover:bg-muted'
              }`}
            >
              <span className="block font-semibold">{label}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Masqué plutôt que démonté : changer de type ne doit pas perdre le PDF importé. */}
      <ProgrammationImagePage hidden={type !== 'tournoi'} />
      {type === 'equipes' && <TeamPosterGenerator />}
    </div>
  );
}
