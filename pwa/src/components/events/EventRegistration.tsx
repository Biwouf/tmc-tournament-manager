import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import EventAdminRegistrations from './EventAdminRegistrations';
import MemberPicker from './MemberPicker';
import SectionChoice from './SectionChoice';
import {
  ERRORS,
  errorMessage,
  cleanGuests,
  fullName,
  defaultPick,
  sectionsLabel,
  type EventSection,
  type Guest,
  type Member,
  type Participant,
  type SectionPick,
} from '../../lib/eventRegistrations';

interface RegistrationState {
  enabled: boolean;
  open: boolean;
  closes_at: string;
  capacity: number | null;
  taken: number;
  max_per_member: number;
  // Absent tant que la migration des sections n'est pas appliquée.
  sections?: EventSection[];
  is_member: boolean;
  is_admin: boolean;
  booking:
    | { id: string; is_owner: true; participants: Participant[] }
    | { id: string; is_owner: false; owner_name: string | null; sections?: SectionPick }
    | null;
}

const formatDeadline = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

// Programme de l'événement : heure, prix et places restantes de chaque section.
function SectionsSummary({ sections }: { sections: EventSection[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {sections.map((s) => {
        const left = s.capacity === null ? null : Math.max(0, s.capacity - s.taken);
        return (
          <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-foreground">
              {s.heure_debut && `${formatTime(s.heure_debut)} · `}
              {s.titre}
            </span>
            <span className="text-muted-foreground">{s.prix ? `${s.prix} €` : 'Gratuit'}</span>
            {left !== null && (
              <span className={left === 0 ? 'text-red-700' : 'text-muted-foreground'}>
                · {left === 0 ? 'complet' : `${left} place${left > 1 ? 's' : ''}`}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BookingEditor({
  clubId,
  eventId,
  max,
  userId,
  initial,
  sections,
  onDone,
}: {
  clubId: string;
  eventId: string;
  max: number;
  userId: string;
  initial: Participant[];
  sections: EventSection[];
  onDone: (saved: boolean) => void;
}) {
  const [mySections, setMySections] = useState<SectionPick>(() => {
    const me = initial.find((p) => p.user_id === userId);
    return me ? me.sections : defaultPick(sections);
  });
  const [members, setMembers] = useState<(Member & { sections: SectionPick })[]>(() =>
    initial
      .filter((p) => !p.is_guest && p.user_id !== userId)
      .map((p) => ({ id: p.user_id!, prenom: p.prenom, nom: p.nom, sections: p.sections ?? null })),
  );
  const [guests, setGuests] = useState<Guest[]>(() =>
    initial.filter((p) => p.is_guest).map((p) => ({ prenom: p.prenom, nom: p.nom, sections: p.sections ?? null })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const places = 1 + members.length + guests.length;
  const full = places >= max;

  const submit = async () => {
    const named = cleanGuests(guests);
    if (named.some((g) => !g.prenom || !g.nom)) {
      setError(ERRORS.VALIDATION_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('event_member_save', {
      p_club: clubId,
      p_event: eventId,
      p_members: members.map((m) => m.id),
      p_guests: named,
      ...(sections.length > 0 && {
        p_member_sections: Object.fromEntries([[userId, mySections], ...members.map((m) => [m.id, m.sections])]),
      }),
    });
    setSaving(false);
    if (err) setError(errorMessage(err));
    else onDone(true);
  };

  return (
    <div className="flex flex-col gap-3">
      {max > 1 && (
        <p className="text-sm text-muted-foreground">
          {places} / {max} place{max > 1 ? 's' : ''} pour votre réservation
        </p>
      )}
      <ul className="flex flex-col gap-2 text-sm">
        <li className="rounded-lg bg-muted px-3 py-2">
          Vous
          <SectionChoice sections={sections} value={mySections} onChange={setMySections} />
        </li>
        {members.map((m) => (
          <li key={m.id} className="rounded-lg bg-muted px-3 py-2">
            <div className="flex items-center">
              {fullName(m)}
              <button
                type="button"
                aria-label={`Retirer ${fullName(m)}`}
                className="ml-auto min-h-8 px-2"
                onClick={() => setMembers(members.filter((x) => x.id !== m.id))}
              >
                ×
              </button>
            </div>
            <SectionChoice
              sections={sections}
              value={m.sections}
              onChange={(pick) => setMembers(members.map((x) => (x.id === m.id ? { ...x, sections: pick } : x)))}
            />
          </li>
        ))}
        {guests.map((g, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <input
                value={g.prenom}
                placeholder="Prénom"
                maxLength={100}
                onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, prenom: e.target.value } : x)))}
                className="min-h-11 w-full rounded-lg border border-border bg-background px-3"
              />
              <input
                value={g.nom}
                placeholder="Nom"
                maxLength={100}
                onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x)))}
                className="min-h-11 w-full rounded-lg border border-border bg-background px-3"
              />
              <button
                type="button"
                aria-label="Retirer l'invité"
                className="min-h-11 px-2"
                onClick={() => setGuests(guests.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
            <SectionChoice
              sections={sections}
              value={g.sections ?? null}
              onChange={(pick) => setGuests(guests.map((x, j) => (j === i ? { ...x, sections: pick } : x)))}
            />
          </li>
        ))}
      </ul>
      {!full && (
        <>
          <MemberPicker
            clubId={clubId}
            exclude={[userId, ...members.map((m) => m.id)]}
            onPick={(m) => setMembers([...members, { ...m, sections: defaultPick(sections) }])}
          />
          <button
            type="button"
            onClick={() => setGuests([...guests, { prenom: '', nom: '', sections: defaultPick(sections) }])}
            className="min-h-11 rounded-lg border border-border text-sm font-medium"
          >
            + Ajouter une personne non membre
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onDone(false)}
          className="min-h-11 flex-1 rounded-lg border border-border text-sm font-medium"
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="min-h-11 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Valider'}
        </button>
      </div>
    </div>
  );
}

export default function EventRegistration({ clubId, eventId }: { clubId: string; eventId: string }) {
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = ['event-registration', clubId, eventId, user?.id ?? null];
  const { data: state } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('event_registration_state', { p_club: clubId, p_event: eventId });
      if (err) throw err;
      return data as RegistrationState;
    },
  });

  if (!state || (!state.enabled && !state.booking && !state.is_admin)) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const remaining = state.capacity === null ? null : Math.max(0, state.capacity - state.taken);
  const sections = state.sections ?? [];
  // Avec des sections : complet quand plus aucune n'a de place.
  const sectionsFull = sections.length > 0 && sections.every((s) => s.capacity !== null && s.taken >= s.capacity);
  const booking = state.booking;

  const cancel = async () => {
    if (!booking) return;
    const others = booking.is_owner ? booking.participants.length - 1 : 0;
    const question = booking.is_owner
      ? others > 0
        ? `Annuler votre réservation ? Les ${others} autre(s) personne(s) inscrite(s) avec vous seront aussi désinscrites.`
        : 'Annuler votre inscription ?'
      : 'Vous désinscrire de cet événement ?';
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('event_member_cancel', { p_club: clubId, p_event: eventId });
    setBusy(false);
    if (err) setError(errorMessage(err));
    await refresh();
  };

  let body: React.ReactNode;
  if (editing && user) {
    body = (
      <BookingEditor
        clubId={clubId}
        eventId={eventId}
        max={state.max_per_member}
        userId={user.id}
        initial={booking?.is_owner ? booking.participants : []}
        sections={sections}
        onDone={async (saved) => {
          setEditing(false);
          if (saved) await refresh();
        }}
      />
    );
  } else if (booking?.is_owner) {
    body = (
      <>
        <p className="text-sm font-semibold text-green-700">
          Vous êtes inscrit{booking.participants.length > 1 ? ` · ${booking.participants.length} places` : ''}
        </p>
        {booking.participants.length > 1 && (
          <ul className="text-sm text-muted-foreground">
            {booking.participants.map((p) => (
              <li key={p.id}>
                {p.user_id === user?.id ? 'Vous' : fullName(p)}
                {p.is_guest && ' (invité)'}
                {sectionsLabel(p.sections, sections) && ` · ${sectionsLabel(p.sections, sections)}`}
              </li>
            ))}
          </ul>
        )}
        {booking.participants.length === 1 && sectionsLabel(booking.participants[0].sections, sections) && (
          <p className="text-sm text-muted-foreground">{sectionsLabel(booking.participants[0].sections, sections)}</p>
        )}
        {state.open && (
          <div className="flex gap-2">
            {(state.max_per_member > 1 || sections.length > 0) && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="min-h-11 flex-1 rounded-lg border border-border text-sm font-medium"
              >
                Modifier
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="min-h-11 flex-1 rounded-lg border border-red-200 bg-red-50 text-sm font-medium text-red-700 disabled:opacity-50"
            >
              Me désinscrire
            </button>
          </div>
        )}
      </>
    );
  } else if (booking) {
    body = (
      <>
        <p className="text-sm font-semibold text-green-700">Vous êtes inscrit par {booking.owner_name ?? 'le club'}</p>
        {sectionsLabel(booking.sections ?? null, sections) && (
          <p className="text-sm text-muted-foreground">{sectionsLabel(booking.sections ?? null, sections)}</p>
        )}
        {state.open && (
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="min-h-11 rounded-lg border border-red-200 bg-red-50 text-sm font-medium text-red-700 disabled:opacity-50"
          >
            Me désinscrire
          </button>
        )}
      </>
    );
  } else if (!state.enabled) {
    body = <p className="text-sm text-muted-foreground">Pas d'inscription en ligne pour cet événement.</p>;
  } else if (!state.open) {
    body = <p className="text-sm text-muted-foreground">Les inscriptions sont closes.</p>;
  } else if (remaining === 0 || sectionsFull) {
    body = <p className="text-sm text-muted-foreground">Complet.</p>;
  } else if (!user) {
    body = (
      <Link
        to="/login"
        state={{ from: location.pathname + location.search }}
        className="flex min-h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
      >
        Se connecter pour s'inscrire
      </Link>
    );
  } else if (!state.is_member) {
    body = <p className="text-sm text-muted-foreground">Inscription réservée aux membres du club.</p>;
  } else {
    body = (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
      >
        S'inscrire
      </button>
    );
  }

  return (
    <section className="mt-2 flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-base font-semibold text-foreground">Inscription</h2>
        {remaining !== null && (
          <span className="text-sm text-muted-foreground">
            {remaining} place{remaining > 1 ? 's' : ''} restante{remaining > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {state.open && (
        <p className="text-xs text-muted-foreground">Jusqu'au {formatDeadline(state.closes_at)}</p>
      )}
      {sections.length > 0 && <SectionsSummary sections={sections} />}
      {body}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {state.is_admin && (
        <EventAdminRegistrations
          clubId={clubId}
          eventId={eventId}
          taken={state.taken}
          sections={sections}
          onChange={refresh}
        />
      )}
    </section>
  );
}
