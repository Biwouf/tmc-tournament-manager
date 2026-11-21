import { useSearchParams } from 'react-router-dom';
import TeamPosterGenerator from '../components/teamMatches/poster/TeamPosterGenerator';
import ProgrammationImagePage from './ProgrammationImagePage';
import PageHeader from '../components/layout/PageHeader';

type MediaType = 'tournoi' | 'equipes' | 'resultats';

const MEDIA_TYPES: { key: MediaType; label: string; description: string }[] = [
  { key: 'tournoi', label: 'Tournoi', description: 'Programme à venir ou résultats, depuis une feuille Ten’Up.' },
  { key: 'equipes', label: 'Matches par équipe', description: 'Affiche des rencontres à venir et sa story vidéo.' },
  { key: 'resultats', label: 'Résultat de rencontre', description: 'Visuel de fin de rencontre : esprit d’équipe ou résultats détaillés.' },
];

export default function MediaGeneratorPage() {
  const [params, setParams] = useSearchParams();
  const param = params.get('type');
  const type: MediaType = param === 'equipes' || param === 'resultats' ? param : 'tournoi';

  return (
    <div className="min-h-screen">
      <PageHeader title="Visuels" />

      <div className="container mx-auto px-4 pt-8">
        <h2 className="mb-3 text-lg font-semibold">Quel média générer ?</h2>
        <div className="grid gap-3 sm:grid-cols-3">
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
      {type === 'equipes' && <TeamPosterGenerator mode="affiche" />}
      {type === 'resultats' && <TeamPosterGenerator mode="resultat" />}
    </div>
  );
}
