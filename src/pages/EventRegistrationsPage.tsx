import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import type { ClubEvent, EventSection } from '../types';
import SectionChoice from '../components/SectionChoice';
import { inSection, type SectionPick } from '../lib/eventSections';

interface Participant {
  id: string;
  user_id: string | null;
  is_guest: boolean;
  prenom: string;
  nom: string;
  sections: SectionPick;
}

interface Booking {
  id: string;
  // null : groupe saisi par un admin, sans titulaire avec compte.
  owner_id: string | null;
  owner_prenom: string;
  owner_nom: string;
  created_at: string;
  participants: Participant[];
}

interface MemberHit {
  id: string;
  prenom: string;
  nom: string;
}

const ERRORS: Record<string, string> = {
  EVENT_FULL: 'Jauge atteinte : augmentez-la dans la fiche de l’événement pour ajouter des places.',
  SECTION_FULL: 'Section complète : augmentez sa jauge dans la fiche de l’événement pour ajouter des places',
  ALREADY_REGISTERED: 'Déjà inscrit à cet événement',
  NOT_MEMBER: 'Seuls les membres du club peuvent être inscrits comme titulaire ou co-membre.',
  VALIDATION_ERROR: 'Prénom et nom obligatoires pour chaque personne, et au moins une personne par groupe.',
  FORBIDDEN: 'Réservé aux administrateurs du club.',
};

function errorMessage(error: { message: string; details?: string | null }): string {
  const base = ERRORS[error.message] ?? error.message;
  if (error.message === 'SECTION_FULL' && error.details) return `${base} (${error.details}).`;
  return error.message === 'ALREADY_REGISTERED' && error.details ? `${base} : ${error.details}.` : base;
}

const fullName = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`.trim() || 'Membre sans nom';
const isOwner = (b: Booking, p: Participant) => b.owner_id !== null && p.user_id === b.owner_id;
const bookingLabel = (b: Booking) =>
  b.owner_id ? `Réservation de ${fullName({ prenom: b.owner_prenom, nom: b.owner_nom })}` : 'Groupe ajouté par le club';

function PersonTag({ p, sections }: { p: Participant; sections: EventSection[] }) {
  const partial =
    p.sections &&
    sections
      .filter((s) => p.sections!.includes(s.id))
      .map((s) => s.titre)
      .join(' + ');
  return (
    <>
      {p.is_guest && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Sans compte</span>
      )}
      {partial && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{partial}</span>}
    </>
  );
}

// « Jean Dupont » → prénom Jean, nom Dupont (le nom reste modifiable ensuite).
const splitName = (text: string) => {
  const [prenom, ...rest] = text.trim().split(/\s+/);
  return { prenom, nom: rest.join(' ') };
};

// Champ unique : membres avec compte (team_member_search) ou texte saisi ajouté comme
// personne sans compte.
function PersonSearch({
  clubId,
  exclude,
  onPick,
  onPickNamed,
}: {
  clubId: string | null;
  exclude: string[];
  onPick: (m: MemberHit) => void;
  onPickNamed: (name: { prenom: string; nom: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemberHit[]>([]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!clubId || query.trim().length < 2) {
        setHits([]);
        return;
      }
      const { data } = await supabase.rpc('team_member_search', { p_club: clubId, p_search: query });
      if (active) setHits((data as MemberHit[] | null) ?? []);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [clubId, query]);

  const typed = query.trim();
  const visible = hits.filter((m) => !exclude.includes(m.id));
  const clear = () => {
    setQuery('');
    setHits([]);
  };

  return (
    <div>
      <input
        value={query}
        autoComplete="off"
        placeholder="Nom d'une personne à inscrire"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      {typed.length >= 2 && (
        <ul className="mt-1 rounded-lg border border-border bg-card">
          {visible.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(m);
                  clear();
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {fullName(m)}
              </button>
            </li>
          ))}
          <li className="border-t border-border">
            <button
              type="button"
              onClick={() => {
                onPickNamed(splitName(typed));
                clear();
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              + « {typed} » <span className="text-muted-foreground">sans compte</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export default function EventRegistrationsPage() {
  const { id } = useParams();
  const { clubId } = useClub();
  const [event, setEvent] = useState<ClubEvent | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [sections, setSections] = useState<EventSection[]>([]);
  // Filtre de la liste par section (null = tous les inscrits).
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Le premier membre avec compte devient titulaire ; aucun → groupe sans titulaire.
  const [members, setMembers] = useState<(MemberHit & { sections: SectionPick })[]>([]);
  // Personnes sans compte (prénom + nom).
  const [guests, setGuests] = useState<{ prenom: string; nom: string; sections: SectionPick }[]>([]);
  const [saving, setSaving] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      supabase.from('events').select('*').eq('id', id).eq('club_id', clubId).single(),
      supabase.rpc('event_admin_bookings', { p_club: clubId, p_event: id }),
      supabase.from('event_sections').select('*').eq('event_id', id).order('position').order('id'),
    ]).then(([ev, list, secs]) => {
      if (cancelled) return;
      if (ev.error) setError(`Événement introuvable : ${ev.error.message}`);
      else setEvent(ev.data as ClubEvent);
      if (list.error) setError(errorMessage(list.error));
      else setBookings((list.data as Booking[]) ?? []);
      setSections((secs.data as EventSection[] | null) ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, clubId, reloadKey]);

  const taken = bookings.reduce((n, b) => n + b.participants.length, 0);
  const sectionTaken = (sectionId: string) =>
    bookings.reduce((n, b) => n + b.participants.filter((p) => inSection(p.sections, sectionId)).length, 0);
  const shown = filter
    ? bookings
        .map((b) => ({
          ...b,
          participants: b.participants.filter((p) => inSection(p.sections, filter)),
        }))
        .filter((b) => b.participants.length > 0)
    : bookings;

  const removeBooking = async (booking: Booking) => {
    const label = booking.owner_id ? `toute la réservation de ${fullName({ prenom: booking.owner_prenom, nom: booking.owner_nom })}` : 'ce groupe';
    if (!window.confirm(`Supprimer ${label} (${booking.participants.length} places) ?`)) return;
    setError(null);
    const { error: err } = await supabase.rpc('event_admin_remove_booking', { p_club: clubId, p_booking: booking.id });
    if (err) setError(errorMessage(err));
    reload();
  };

  const remove = async (booking: Booking, p: Participant) => {
    const others = booking.participants.length - 1;
    const question =
      isOwner(booking, p) && others > 0
        ? `Retirer ${fullName(p)} annule toute sa réservation (${others} autre(s) personne(s)). Continuer ?`
        : `Retirer ${fullName(p)} ?`;
    if (!window.confirm(question)) return;
    setError(null);
    const { error: err } = await supabase.rpc('event_admin_remove', { p_club: clubId, p_participant: p.id });
    if (err) setError(errorMessage(err));
    reload();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanGuests = guests.map((g) => ({
      prenom: g.prenom.trim(),
      nom: g.nom.trim(),
      sections: g.sections,
    }));
    if (!id || members.length + cleanGuests.length === 0) return;
    if (cleanGuests.some((g) => !g.prenom || !g.nom)) {
      setError(ERRORS.VALIDATION_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('event_admin_add', {
      p_club: clubId,
      p_event: id,
      p_owner: members[0]?.id ?? null,
      p_members: members.slice(1).map((m) => m.id),
      p_guests: cleanGuests,
      p_member_sections: Object.fromEntries(members.map((m) => [m.id, m.sections])),
    });
    setSaving(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    setMembers([]);
    setGuests([]);
    reload();
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Chargement...</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl font-semibold tracking-tight">Inscrits — {event?.titre ?? ''}</h1>
          <Link to="/events" className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
            ← Retour à la liste
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
        {event && (
          <p className="text-sm text-muted-foreground">
            {taken} place{taken > 1 ? 's' : ''} prise{taken > 1 ? 's' : ''}
            {event.registration_capacity !== null && ` sur ${event.registration_capacity}`} ·{' '}
            {event.registration_enabled
              ? `inscription en ligne, ${event.registration_max_per_member} place(s) max par réservation`
              : 'inscription en ligne désactivée'}
          </p>
        )}

        {sections.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter(null)}
              className={`rounded-full border px-3 py-1 text-sm ${filter === null ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
            >
              Tous · {taken}
            </button>
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setFilter(s.id)}
                className={`rounded-full border px-3 py-1 text-sm ${filter === s.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
              >
                {s.titre} · {sectionTaken(s.id)}
                {s.capacity !== null && ` / ${s.capacity}`}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-muted-foreground">
            Aucune inscription.
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((b) => {
              const removeButton = (p: Participant) => (
                <button
                  onClick={() => remove(b, p)}
                  className="ml-auto rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
                >
                  Retirer
                </button>
              );
              const date = new Date(b.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
              // Une seule place : une ligne, sans répéter le nom en titre.
              if (b.participants.length === 1 && !filter) {
                const [p] = b.participants;
                return (
                  <li key={b.id} className="flex items-center gap-2 rounded-2xl border bg-card/90 p-4 text-sm shadow-sm">
                    <span className="font-semibold">{fullName(p)}</span>
                    <PersonTag p={p} sections={sections} />
                    <span className="text-muted-foreground">· {date}</span>
                    {removeButton(p)}
                  </li>
                );
              }
              return (
                <li key={b.id} className="rounded-2xl border bg-card/90 p-4 shadow-sm">
                  <div className="flex items-start gap-2">
                    <p className="text-sm font-semibold">
                      {bookingLabel(b)}{' '}
                      <span className="font-normal text-muted-foreground">
                        · {b.participants.length} places · {date}
                      </span>
                    </p>
                    <button
                      onClick={() => removeBooking(b)}
                      className="ml-auto shrink-0 rounded-lg border border-red-300 bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 transition hover:bg-red-200"
                    >
                      Supprimer la réservation
                    </button>
                  </div>
                  <ul className="mt-2 divide-y divide-border">
                    {b.participants.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span>{fullName(p)}</span>
                        <PersonTag p={p} sections={sections} />
                        {removeButton(p)}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={add} className="space-y-4 rounded-2xl border bg-card/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Ajouter des inscrits</h2>
          {(members.length > 0 || guests.length > 0) && (
            <ul className="space-y-2">
              {members.map((m, i) => (
                <li key={m.id} className="space-y-1.5 rounded-lg bg-muted px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span>{fullName(m)}</span>
                    {i === 0 && <span className="text-xs text-muted-foreground">titulaire</span>}
                    <button
                      type="button"
                      aria-label={`Retirer ${fullName(m)}`}
                      onClick={() => setMembers(members.filter((x) => x.id !== m.id))}
                      className="ml-auto px-2"
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
                <li key={i} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={g.prenom}
                      placeholder="Prénom"
                      aria-label="Prénom"
                      maxLength={100}
                      onChange={(e) =>
                        setGuests(guests.map((x, j) => (j === i ? { ...x, prenom: e.target.value } : x)))
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <input
                      value={g.nom}
                      placeholder="Nom"
                      aria-label="Nom"
                      maxLength={100}
                      onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x)))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      aria-label="Retirer la personne"
                      onClick={() => setGuests(guests.filter((_, j) => j !== i))}
                      className="rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      ×
                    </button>
                  </div>
                  <SectionChoice
                    sections={sections}
                    value={g.sections}
                    onChange={(pick) => setGuests(guests.map((x, j) => (j === i ? { ...x, sections: pick } : x)))}
                  />
                </li>
              ))}
            </ul>
          )}
          <PersonSearch
            clubId={clubId}
            exclude={members.map((m) => m.id)}
            onPick={(m) => setMembers([...members, { ...m, sections: null }])}
            onPickNamed={(name) => setGuests([...guests, { ...name, sections: null }])}
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={members.length + guests.length === 0 || saving}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Inscrire'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
