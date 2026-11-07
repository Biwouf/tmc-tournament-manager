import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import MemberPicker from './MemberPicker';
import { ERRORS, errorMessage, fullName, type Guest, type Member, type Participant } from '../../lib/eventRegistrations';

interface Booking {
  id: string;
  owner_id: string;
  owner_prenom: string;
  owner_nom: string;
  participants: Participant[];
}

// Admin du club : liste des inscrits, ajout manuel et retrait (mêmes RPC que la page Inscrits du BO).
// L'ajout passe outre la clôture et le max par réservation ; la jauge s'applique.
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
  const [owner, setOwner] = useState<Member | null>(null);
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
    setOwner(null);
    setMembers([]);
    setGuests([]);
  };

  const submit = async () => {
    if (!owner) return;
    const cleanGuests = guests.map((g) => ({ prenom: g.prenom.trim(), nom: g.nom.trim() }));
    if (cleanGuests.some((g) => !g.prenom || !g.nom)) {
      setError(ERRORS.VALIDATION_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('event_admin_add', {
      p_club: clubId,
      p_event: eventId,
      p_owner: owner.id,
      p_members: members.map((m) => m.id),
      p_guests: cleanGuests,
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
      p.user_id === booking.owner_id && others > 0
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
    const owner = fullName({ prenom: booking.owner_prenom, nom: booking.owner_nom });
    if (!window.confirm(`Supprimer toute la réservation de ${owner} (${booking.participants.length} places) ?`)) return;
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
          {bookings.map((b) => (
            <li key={b.id} className="rounded-lg bg-muted px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {fullName({ prenom: b.owner_prenom, nom: b.owner_nom }) || 'Membre sans nom'}
                  {b.participants.length > 1 && (
                    <span className="font-normal text-muted-foreground"> · {b.participants.length} places</span>
                  )}
                </p>
                {b.participants.length > 1 && (
                  <button
                    type="button"
                    disabled={removing !== null}
                    onClick={() => removeBooking(b)}
                    className="ml-auto min-h-9 shrink-0 rounded-lg border border-red-300 bg-red-100 px-2.5 text-xs font-semibold text-red-800 disabled:opacity-50"
                  >
                    {removing === b.id ? '…' : 'Supprimer le groupe'}
                  </button>
                )}
              </div>
              <ul className="mt-1 divide-y divide-border">
                {b.participants.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1">
                    <span className={p.user_id === b.owner_id ? '' : 'text-muted-foreground'}>
                      {fullName(p) || 'Membre sans nom'}
                      {p.is_guest && ' (invité)'}
                    </span>
                    <button
                      type="button"
                      disabled={removing !== null}
                      onClick={() => remove(b, p)}
                      className="ml-auto min-h-9 rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 disabled:opacity-50"
                    >
                      {removing === p.id ? '…' : 'Retirer'}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
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
          <p className="text-xs text-muted-foreground">
            Possible même inscriptions closes, sans limite par réservation. Si le titulaire est déjà inscrit, les
            personnes rejoignent sa réservation. La jauge reste appliquée.
          </p>
          {owner ? (
            <p className="text-sm">
              Titulaire : <strong>{fullName(owner)}</strong>{' '}
              <button type="button" onClick={() => setOwner(null)} className="text-xs text-muted-foreground underline">
                changer
              </button>
            </p>
          ) : (
            <MemberPicker clubId={clubId} exclude={members.map((m) => m.id)} onPick={setOwner} placeholder="Titulaire : rechercher un membre" />
          )}

          {owner && (
            <>
              <ul className="flex flex-col gap-2 text-sm">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center rounded-lg bg-muted px-3 py-2">
                    {fullName(m)}
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
                  <li key={i} className="flex gap-2">
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
                  </li>
                ))}
              </ul>
              <MemberPicker
                clubId={clubId}
                exclude={[owner.id, ...members.map((m) => m.id)]}
                onPick={(m) => setMembers([...members, m])}
                placeholder="Ajouter un autre membre"
              />
              <button
                type="button"
                onClick={() => setGuests([...guests, { prenom: '', nom: '' }])}
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
              disabled={!owner || saving}
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
