import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import type { ClubEvent } from '../types';

interface Participant {
  id: string;
  user_id: string | null;
  is_guest: boolean;
  prenom: string;
  nom: string;
}

interface Booking {
  id: string;
  owner_id: string;
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
  ALREADY_REGISTERED: 'Déjà inscrit à cet événement',
  NOT_MEMBER: 'Seuls les membres du club peuvent être inscrits comme titulaire ou co-membre.',
  VALIDATION_ERROR: 'Prénom et nom obligatoires pour chaque invité.',
  FORBIDDEN: 'Réservé aux administrateurs du club.',
};

function errorMessage(error: { message: string; details?: string | null }): string {
  const base = ERRORS[error.message] ?? error.message;
  return error.message === 'ALREADY_REGISTERED' && error.details ? `${base} : ${error.details}.` : base;
}

const fullName = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`.trim() || 'Membre sans nom';

function MemberSearch({ clubId, label, onPick }: { clubId: string | null; label: string; onPick: (m: MemberHit) => void }) {
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

  return (
    <div>
      <label className="block text-sm font-medium text-foreground">{label}</label>
      <input
        value={query}
        autoComplete="off"
        placeholder="Rechercher un membre (2 lettres min.)"
        onChange={(e) => setQuery(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      {hits.length > 0 && (
        <ul className="mt-1 rounded-lg border border-border bg-card">
          {hits.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(m);
                  setQuery('');
                  setHits([]);
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {fullName(m)}
              </button>
            </li>
          ))}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [owner, setOwner] = useState<MemberHit | null>(null);
  const [members, setMembers] = useState<MemberHit[]>([]);
  const [guests, setGuests] = useState<{ prenom: string; nom: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      supabase.from('events').select('*').eq('id', id).eq('club_id', clubId).single(),
      supabase.rpc('event_admin_bookings', { p_club: clubId, p_event: id }),
    ]).then(([ev, list]) => {
      if (cancelled) return;
      if (ev.error) setError(`Événement introuvable : ${ev.error.message}`);
      else setEvent(ev.data as ClubEvent);
      if (list.error) setError(errorMessage(list.error));
      else setBookings((list.data as Booking[]) ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, clubId, reloadKey]);

  const taken = bookings.reduce((n, b) => n + b.participants.length, 0);

  const removeBooking = async (booking: Booking) => {
    const owner = fullName({ prenom: booking.owner_prenom, nom: booking.owner_nom });
    if (!window.confirm(`Supprimer toute la réservation de ${owner} (${booking.participants.length} places) ?`)) return;
    setError(null);
    const { error: err } = await supabase.rpc('event_admin_remove_booking', { p_club: clubId, p_booking: booking.id });
    if (err) setError(errorMessage(err));
    reload();
  };

  const remove = async (booking: Booking, p: Participant) => {
    const isOwner = p.user_id === booking.owner_id;
    const others = booking.participants.length - 1;
    const question =
      isOwner && others > 0
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
    if (!owner || !id) return;
    const cleanGuests = guests.map((g) => ({ prenom: g.prenom.trim(), nom: g.nom.trim() }));
    if (cleanGuests.some((g) => !g.prenom || !g.nom)) {
      setError(ERRORS.VALIDATION_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('event_admin_add', {
      p_club: clubId,
      p_event: id,
      p_owner: owner.id,
      p_members: members.map((m) => m.id),
      p_guests: cleanGuests,
    });
    setSaving(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    setOwner(null);
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

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {bookings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-muted-foreground">
            Aucune inscription.
          </div>
        ) : (
          <ul className="space-y-3">
            {bookings.map((b) => (
              <li key={b.id} className="rounded-2xl border bg-card/90 p-4 shadow-sm">
                <div className="flex items-start gap-2">
                  <p className="text-sm font-semibold">
                    Réservation de {fullName({ prenom: b.owner_prenom, nom: b.owner_nom })}{' '}
                    <span className="font-normal text-muted-foreground">
                      · {b.participants.length} place{b.participants.length > 1 ? 's' : ''} ·{' '}
                      {new Date(b.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </p>
                  {b.participants.length > 1 && (
                    <button
                      onClick={() => removeBooking(b)}
                      className="ml-auto shrink-0 rounded-lg border border-red-300 bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 transition hover:bg-red-200"
                    >
                      Supprimer la réservation
                    </button>
                  )}
                </div>
                <ul className="mt-2 divide-y divide-border">
                  {b.participants.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <span>{fullName(p)}</span>
                      {p.is_guest && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Invité</span>
                      )}
                      <button
                        onClick={() => remove(b, p)}
                        className="ml-auto rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
                      >
                        Retirer
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="space-y-4 rounded-2xl border bg-card/90 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Ajouter des inscrits</h2>
          <p className="text-xs text-muted-foreground">
            Possible même si l'inscription en ligne est fermée, sans limite de places par réservation. Si le titulaire a
            déjà une réservation, les personnes y sont ajoutées. La jauge reste appliquée.
          </p>
          {owner ? (
            <p className="text-sm">
              Titulaire : <strong>{fullName(owner)}</strong>{' '}
              <button type="button" onClick={() => setOwner(null)} className="text-xs text-muted-foreground underline">
                changer
              </button>
            </p>
          ) : (
            <MemberSearch clubId={clubId} label="Titulaire (membre)" onPick={setOwner} />
          )}

          {owner && (
            <>
              <MemberSearch
                clubId={clubId}
                label="Autres membres"
                onPick={(m) => {
                  if (m.id !== owner.id && !members.some((x) => x.id === m.id)) setMembers([...members, m]);
                }}
              />
              {members.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs">
                      {fullName(m)}
                      <button type="button" aria-label="Retirer" onClick={() => setMembers(members.filter((x) => x.id !== m.id))}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">Invités non membres</p>
                {guests.map((g, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={g.prenom}
                      placeholder="Prénom"
                      maxLength={100}
                      onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, prenom: e.target.value } : x)))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <input
                      value={g.nom}
                      placeholder="Nom"
                      maxLength={100}
                      onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x)))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      aria-label="Retirer l'invité"
                      onClick={() => setGuests(guests.filter((_, j) => j !== i))}
                      className="rounded-lg border border-border px-3 text-sm"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setGuests([...guests, { prenom: '', nom: '' }])}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
                >
                  + Ajouter un invité
                </button>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!owner || saving}
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
