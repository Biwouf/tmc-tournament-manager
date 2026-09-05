// Multi-tenant — PR7 : choix du fond, sur les deux écrans qui génèrent une affiche
// (`ProgrammationImagePage`, `teamMatches/poster/PosterPanel`).
//
// Partagé parce qu'il est monté DEUX fois dans deux contextes de largeur très différents — une
// page pleine et un panneau latéral de 372 px. D'où le `flex-wrap` sur des vignettes de taille
// fixe plutôt qu'une grille : il se replie tout seul, et aucun des deux appelants n'a de
// dimension à lui passer.
//
// Rendu MÊME quand le club n'a qu'un seul fond : c'est alors la seule façon de voir lequel
// s'applique. La liste vide, elle, est l'affaire de `PosterBackgroundEmpty` ci-dessous — pas
// d'un sélecteur à zéro option.
import { Link } from 'react-router-dom';
import type { PosterBackground } from '../lib/clubConfig';

export default function PosterBackgroundPicker({
  backgrounds,
  selectedIndex,
  onSelect,
  label = 'Fond de l’affiche',
}: {
  backgrounds: PosterBackground[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  label?: string;
}) {
  if (backgrounds.length === 0) return null;

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {backgrounds.map((background, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelect(index)}
              aria-pressed={selected}
              // `title` en plus du nom visible : un nom long est tronqué sous la vignette.
              title={background.name}
              className={`flex w-24 flex-col gap-1.5 rounded-xl border p-1.5 text-left transition ${
                selected
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                  : 'border-border bg-card hover:bg-muted'
              }`}
            >
              <img
                src={background.image}
                alt=""
                // `object-contain` et non `cover` : on choisit un fond en reconnaissant sa
                // composition, qu'un recadrage de vignette masquerait.
                className="h-28 w-full rounded-lg bg-muted/40 object-contain"
              />
              <span
                className={`truncate text-[11px] font-medium ${
                  selected ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {background.name}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * L'état « aucun fond configuré », qui REND LA GÉNÉRATION IMPOSSIBLE.
 *
 * Un message, et surtout le chemin pour en sortir : sans le lien, l'admin sait qu'il est bloqué
 * sans savoir où aller. La route `/admin/site` est `adminOnly` — un `manager` verra donc le
 * refus sans pouvoir le lever lui-même, ce que le texte dit plutôt que de le laisser buter sur
 * une redirection.
 */
export function PosterBackgroundEmpty({ poster }: { poster: string }) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
      <p className="font-medium">Aucun fond d’affiche configuré — la génération est impossible.</p>
      <p className="mt-1 text-amber-900/80">
        Un administrateur du club doit ajouter au moins un fond pour {poster} dans{' '}
        <Link to="/admin/site" className="font-medium underline underline-offset-2">
          Configuration du site → Affiches
        </Link>
        .
      </p>
    </div>
  );
}
