import { useId } from 'react';
import { Link } from 'react-router-dom';
import SectionTitle from '../layout/SectionTitle';
import { competitionLabel } from '../teamMatches/teamMatchLabels';
import { inboxTotal, useAdminInbox, type AdminInbox } from '../../lib/adminInbox';
import { formatCourseDate } from '../../lib/courses';

interface Row {
  key: string;
  label: string;
  detail: string;
  action: string;
  to: string;
  /** Élément le plus ancien du type : il fixe l'ordre des lignes. */
  oldest: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function waitingSince(iso: string | null): string {
  const days = iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;
  return days < 1 ? 'La plus ancienne date de moins d’un jour' : `La plus ancienne attend depuis ${plural(days, 'jour', 'jours')}`;
}

function scoresDetail(inbox: AdminInbox): string {
  const shown = inbox.scores_preview.map((r) => `${competitionLabel(r)}, éq. ${r.numero} contre ${r.club_adverse}`);
  const others = inbox.scores_to_enter - shown.length;
  return [...shown, ...(others > 0 ? [`+${plural(others, 'autre', 'autres')}`] : [])].join(' · ');
}

function buildRows(inbox: AdminInbox): Row[] {
  const rows: Row[] = [];
  if (inbox.signup_pending > 0) rows.push({
    key: 'signup',
    label: plural(inbox.signup_pending, 'demande d’adhésion', 'demandes d’adhésion'),
    detail: waitingSince(inbox.signup_oldest_at),
    action: 'Examiner',
    to: '/admin/members#demandes',
    oldest: inbox.signup_oldest_at,
  });
  if (inbox.scores_to_enter > 0) rows.push({
    key: 'scores',
    label: plural(inbox.scores_to_enter, 'score de rencontre à saisir', 'scores de rencontre à saisir'),
    detail: scoresDetail(inbox),
    action: 'Saisir les scores',
    to: '/team-matches',
    oldest: inbox.scores_oldest_at,
  });
  if (inbox.course_pending > 0 && inbox.course_next) rows.push({
    key: 'courses',
    label: plural(inbox.course_pending, 'inscription à un cours à valider', 'inscriptions à un cours à valider'),
    detail: `${inbox.course_next.name}, ${formatCourseDate(inbox.course_next.starts_at)}`,
    action: 'Valider',
    to: `/courses/${inbox.course_next.id}/registrations?status=pending`,
    oldest: inbox.course_oldest_at,
  });
  if (inbox.stale_lives > 0) rows.push({
    key: 'lives',
    label: plural(inbox.stale_lives, 'live ouvert depuis plus de 6 jours', 'lives ouverts depuis plus de 6 jours'),
    detail: inbox.stale_lives > 1 ? 'Ils restent « En direct » dans l’app' : 'Il reste « En direct » dans l’app',
    action: 'Vérifier',
    to: '/live-score',
    oldest: inbox.stale_lives_oldest_at,
  });
  return rows.sort((a, b) => new Date(a.oldest ?? 0).getTime() - new Date(b.oldest ?? 0).getTime());
}

// PR-BO2 — « À traiter » (brief back office §3.1) : une ligne par type, masquée à 0, la plus
// ancienne d'abord. Pas de ligne Messages tant que `contact_messages.read_at` n'existe pas (PR-BO6).
export default function InboxCard() {
  const titleId = useId();
  const { inbox, error, refresh } = useAdminInbox();
  const rows = inbox ? buildRows(inbox) : [];
  const total = inbox ? inboxTotal(inbox) : 0;

  return (
    <section aria-labelledby={titleId}>
      <SectionTitle
        id={titleId}
        title="À traiter"
        count={total > 0 ? total : undefined}
        countClassName="bg-foreground text-background"
      />
      <div className="rounded-2xl border bg-card shadow-sm">
        {rows.length > 0 ? (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.key} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-card-foreground">{row.label}</h3>
                  <p className="mt-0.5 break-words text-sm text-muted-foreground">{row.detail}</p>
                </div>
                <Link
                  to={row.to}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:bg-muted"
                >
                  {row.action}
                </Link>
              </li>
            ))}
          </ul>
        ) : inbox ? (
          <p className="px-4 py-6 text-foreground sm:px-6">Rien à traiter pour l’instant</p>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <p className="text-foreground">Impossible de charger les éléments à traiter.</p>
            <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-semibold transition hover:bg-muted" onClick={refresh}>
              Réessayer
            </button>
          </div>
        ) : (
          <p role="status" className="px-4 py-6 text-muted-foreground sm:px-6">Chargement…</p>
        )}
      </div>
    </section>
  );
}
