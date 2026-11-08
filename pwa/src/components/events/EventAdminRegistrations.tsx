import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import MemberPicker from './MemberPicker';
import {
  ERRORS,
  cleanGuests,
  errorMessage,
  fullName,
  type Guest,
  type Member,
  type Participant,
} from '../../lib/eventRegistrations';

interface Booking {
  id: string;
  // null : groupe saisi par un admin, sans titulaire avec compte.
  owner_id: string | null;
  owner_prenom: string;
  owner_nom: string;
  participants: Participant[];
}

// Admin du club : liste des inscrits, ajout manuel et retrait (mêmes RPC que la page Inscrits du BO).
// L'ajout passe outre la clôture et le max par réservation ; la jauge s'applique.
// Un seul champ : membres avec compte (le premier devient titulaire ; s'il a déjà une
// réservation, les personnes la rejoignent) ou personnes sans compte (prénom + nom). Sans
// aucun membre avec compte, le groupe n'a pas de titulaire.

const isOwner = (b: Booking, p: Participant) => b.owner_id !== null && p.user_id === b.owner_id;
const bookingLabel = (b: Booking) =>
  b.owner_id ? fullName({ prenom: b.owner_prenom, nom: b.owner_nom }) || 'Membre sans nom' : 'Groupe ajouté par le club';
export default function EventAdminRegistrations({
  clubId,
  eventId,
  taken,
  onChange,
}: {
  clubId: string;
  eventId: string;
  taken: number;
  onChange: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const { data: bookings, isLoading, isError, refetch } = useQuery({
    queryKey: ['event-admin-bookings', clubId, eventId],
    enabled: open,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('event_admin_bookings', { p_club: clubId, p_event: eventId });
      if (err) throw err;
      return (data as Booking[]) ?? [];
    },
  });

  const reset = () => {
    setAdding(false);
    setMembers([]);
    setGuests([]);
  };

  const submit = async () => {
    const named = cleanGuests(guests);
    if (members.length + named.length === 0) return;
    if (named.some((g) => !g.prenom || !g.nom)) {
      setError(ERRORS.VALIDATION_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('event_admin_add', {
      p_club: clubId,
      p_event: eventId,
      p_owner: members[0]?.id ?? null,
      p_members: members.slice(1).map((m) => m.id),
      p_guests: named,
    });
    setSaving(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    reset();
    await Promise.all([refetch(), onChange()]);
  };

  // Retirer le titulaire annule toute sa réservation (règle serveur) : on le dit avant.
  const remove = async (booking: Booking, p: Participant) => {
    const others = booking.participants.length - 1;
    const question =
      isOwner(booking, p) && others > 0
        ? `Retirer ${fullName(p)} annule toute sa réservation (${others} autre(s) personne(s)). Continuer ?`
        : `Retirer ${fullName(p)} ?`;
    if (!window.confirm(question)) return;
    setRemoving(p.id);
    setRemoveError(null);
    const { error: err } = await supabase.rpc('event_admin_remove', { p_club: clubId, p_participant: p.id });
    setRemoving(null);
    if (err) setRemoveError(errorMessage(err));
    await Promise.all([refetch(), onChange()]);
  };

  const removeBooking = async (booking: Booking) => {
    const label = booking.owner_id ? `la réservation de ${bookingLabel(booking)}` : 'ce groupe';
    if (!window.confirm(`Supprimer ${label} (${booking.participants.length} places) ?`)) return;
    setRemoving(booking.id);
    setRemoveError(null);
    const { error: err } = await supabase.rpc('event_admin_remove_booking', { p_club: clubId, p_booking: booking.id });
    setRemoving(null);
    if (err) setRemoveError(errorMessage(err));
    await Promise.all([refetch(), onChange()]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-lg border border-border text-sm font-medium"
      >
        Voir les inscrits ({taken})
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex items-center">
        <h3 className="text-sm font-semibold">Inscrits ({taken})</h3>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto min-h-8 px-2 text-sm text-muted-foreground">
          Masquer
        </button>
      </div>

      {isLoading && <div className="h-16 animate-pulse rounded-lg bg-muted" />}
      {isError && <p className="text-sm text-red-700">Impossible de charger les inscrits.</p>}
      {bookings && bookings.length === 0 && <p className="text-sm text-muted-foreground">Aucune inscription.</p>}
      {bookings && bookings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {bookings.map((b) => {
            const removeButton = (p: Participant) => (
              <button
                type="button"
                disabled={removing !== null}
                onClick={() => remove(b, p)}
                className="ml-auto min-h-9 shrink-0 rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 disabled:opacity-50"
              >
                {removing === p.id ? '…' : 'Retirer'}
              </button>
            );
            if (b.participants.length === 1) {
              const [p] = b.participants;
              return (
                <li key={b.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">
                    {fullName(p) || 'Membre sans nom'}
                    {p.is_guest && <span className="font-normal text-muted-foreground"> (sans compte)</span>}
                  </span>
                  {removeButton(p)}
                </li>
              );
            }
            return (
              <li key={b.id} className="rounded-lg bg-muted px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {bookingLabel(b)}
                    <span className="font-normal text-muted-foreground"> · {b.participants.length} places</span>
                  </p>
                  <button
                    type="button"
                    disabled={removing !== null}
                    onClick={() => removeBooking(b)}
                    className="ml-auto min-h-9 shrink-0 rounded-lg border border-red-300 bg-red-100 px-2.5 text-xs font-semibold text-red-800 disabled:opacity-50"
                  >
                    {removing === b.id ? '…' : 'Supprimer le groupe'}
                  </button>
                </div>
                <ul className="mt-1 divide-y divide-border">
                  {b.participants.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1">
                      <span className={isOwner(b, p) ? '' : 'text-muted-foreground'}>
                        {fullName(p) || 'Membre sans nom'}
                        {p.is_guest && ' (sans compte)'}
                      </span>
                      {removeButton(p)}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {removeError && (
        <p role="alert" className="text-sm text-red-700">
          {removeError}
        </p>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          Ajouter des inscrits
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          {(members.length > 0 || guests.length > 0) && (
            <ul className="flex flex-col gap-2 text-sm">
              {members.map((m, i) => (
                <li key={m.id} className="flex items-center gap-1 rounded-lg bg-muted px-3 py-2">
                  {fullName(m)}
                  {i === 0 && <span className="text-muted-foreground"> · titulaire</span>}
                  <button
                    type="button"
                    aria-label={`Retirer ${fullName(m)}`}
                    className="ml-auto min-h-8 px-2"
                    onClick={() => setMembers(members.filter((x) => x.id !== m.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
              {guests.map((g, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    value={g.prenom}
                    placeholder="Prénom"
                    aria-label="Prénom"
                    maxLength={100}
                    onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, prenom: e.target.value } : x)))}
                    className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3"
                  />
                  <input
                    value={g.nom}
                    placeholder="Nom"
                    aria-label="Nom"
                    maxLength={100}
                    onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x)))}
                    className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3"
                  />
                  <button
                    type="button"
                    aria-label="Retirer la personne"
                    className="min-h-11 shrink-0 px-2"
                    onClick={() => setGuests(guests.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <MemberPicker
            clubId={clubId}
            exclude={members.map((m) => m.id)}
            onPick={(m) => setMembers([...members, m])}
            onPickNamed={(name) => setGuests([...guests, name])}
            placeholder="Nom d'une personne à inscrire"
          />

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                setError(null);
              }}
              className="min-h-11 flex-1 rounded-lg border border-border text-sm font-medium"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={members.length + guests.length === 0 || saving}
              onClick={submit}
              className="min-h-11 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Inscrire'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
