import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import SectionTitle from '../layout/SectionTitle';
import { supabase } from '../../lib/supabase';
import { readCourses, type Course } from '../../lib/courses';

interface Entry {
  key: string;
  at: string;
  kind: string;
  title: string;
  to: string;
}

interface RawRencontre {
  id: string;
  club_adverse: string;
  date_heure: string;
  domicile: boolean;
}

const WEEK_MS = 7 * 86_400_000;

const formatDate = (iso: string) => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));

async function readWeek(clubId: string, withCourses: boolean): Promise<Entry[]> {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + WEEK_MS).toISOString();
  const [events, rencontres, courses] = await Promise.all([
    // Un événement déjà commencé et pas encore fini en fait partie (même règle que `/events`).
    supabase.from('events').select('id, titre, date_debut').eq('club_id', clubId)
      .lte('date_debut', to)
      .or(`date_fin.gte.${from},and(date_fin.is.null,date_debut.gte.${from})`),
    supabase.from('team_rencontres').select('id, club_adverse, date_heure, domicile').eq('club_id', clubId)
      .eq('wo', false).gte('date_heure', from).lte('date_heure', to),
    // Lecture admin, cours à venir, les plus proches d'abord.
    withCourses ? readCourses<Course>(clubId, 'courses') : [],
  ]);
  if (events.error) throw new Error(events.error.message);
  if (rencontres.error) throw new Error(rencontres.error.message);

  return [
    ...(events.data as { id: string; titre: string; date_debut: string }[]).map((e) => ({
      key: `event-${e.id}`, at: e.date_debut, kind: 'Événement', title: e.titre, to: `/events/${e.id}/edit`,
    })),
    ...(rencontres.data as RawRencontre[]).map((r) => ({
      key: `rencontre-${r.id}`, at: r.date_heure, kind: r.domicile ? 'Rencontre à domicile' : 'Rencontre à l’extérieur',
      title: `Contre ${r.club_adverse}`, to: `/team-matches/rencontre/${r.id}`,
    })),
    ...courses.filter((c) => !c.cancelled_at && Date.parse(c.starts_at) <= Date.parse(to)).map((c) => ({
      key: `course-${c.id}`, at: c.starts_at, kind: 'Cours', title: c.name, to: `/courses/${c.id}/registrations`,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// PR-BO2 — « Cette semaine au club » : événements, rencontres et cours des 7 prochains jours.
// Les cours se lisent par une RPC d'admin : absents pour un gestionnaire.
export default function WeekAgenda({ clubId, withCourses }: { clubId: string; withCourses: boolean }) {
  const titleId = useId();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readWeek(clubId, withCourses).then(
      (rows) => { if (!cancelled) { setEntries(rows); setError(false); } },
      (reason) => { console.error('[accueil] agenda', reason); if (!cancelled) setError(true); },
    );
    return () => { cancelled = true; };
  }, [clubId, withCourses, attempt]);

  return (
    <section aria-labelledby={titleId}>
      <SectionTitle id={titleId} title="Cette semaine au club" />
      <div className="rounded-2xl border bg-card shadow-sm">
        {error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <p className="text-sm text-foreground">Impossible de charger la semaine.</p>
            <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-semibold transition hover:bg-muted" onClick={() => setAttempt((n) => n + 1)}>
              Réessayer
            </button>
          </div>
        ) : !entries ? (
          <p role="status" className="px-4 py-4 text-sm text-muted-foreground">Chargement…</p>
        ) : entries.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">Rien de prévu dans les 7 prochains jours.</p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.key}>
                <Link to={entry.to} className="block px-4 py-3 transition hover:bg-muted/60">
                  <span className="block text-xs text-muted-foreground">{formatDate(entry.at)} · {entry.kind}</span>
                  <span className="mt-0.5 block break-words text-sm font-semibold text-card-foreground">{entry.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
