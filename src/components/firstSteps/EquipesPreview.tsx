import { useEffect, useState } from 'react';
import { seasonLabel } from '../teamMatches/teamMatchLabels';
import { MatchesScreen } from '../signup/SignupPreview';
import { loadMatchesScreen, type Screen } from './matchesScreen';
import type { StepPreviewProps } from './FirstStepsFlow';
import { useTeamsVersion } from './teamsSignal';

// SaaS S6 — l'onglet « Matchs équipes » de la PWA avec les rencontres réellement créées (`matchesScreen.ts`).
export default function EquipesPreview({ club, data, version }: StepPreviewProps) {
  const teams = useTeamsVersion();
  const [screen, setScreen] = useState<Screen | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadMatchesScreen(club.id).then((result) => { if (active) setScreen(result); }, () => { if (active) setScreen(null); });
    return () => { active = false; };
  }, [club.id, version, teams]);

  return (
    <MatchesScreen
      data={data}
      season={screen?.season ?? seasonLabel(new Date())}
      matches={screen?.upcoming ?? []}
      past={screen?.past ?? 0}
      empty={screen === undefined
        ? <div className="h-32 animate-pulse rounded-xl bg-muted" />
        : <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="text-base font-bold text-foreground">{screen && screen.past ? 'Aucune rencontre à venir' : 'Vos rencontres arrivent ici'}</span>
            <span className="h-3 w-2/3 rounded-md bg-muted" />
          </div>}
    />
  );
}
