import { useState } from 'react';
import type {
  GlobalConfig,
  TournamentConfig,
  DailyTimeSlot,
  Gender,
  TennisRanking,
} from '../types';
import { TENNIS_RANKINGS } from '../types';

interface Props {
  onSubmit: (config: GlobalConfig) => void;
  initialConfig?: GlobalConfig;
}

export default function ConfigurationForm({ onSubmit, initialConfig }: Props) {
  const [name, setName] = useState(initialConfig?.name ?? '');
  const [startDate, setStartDate] = useState(initialConfig?.startDate ?? '');
  const [endDate, setEndDate] = useState(initialConfig?.endDate ?? '');
  const [numberOfCourts, setNumberOfCourts] = useState(initialConfig?.numberOfCourts ?? 2);
  const [matchDuration, setMatchDuration] = useState(initialConfig?.matchDuration ?? 90);
  const [dailyTimeSlots, setDailyTimeSlots] = useState<DailyTimeSlot[]>(initialConfig?.dailyTimeSlots ?? []);
  const [tournaments, setTournaments] = useState<TournamentConfig[]>(initialConfig?.tournaments ?? []);

  // Daily time slot form
  const [slotDate, setSlotDate] = useState('');
  const [slotFirstMatch, setSlotFirstMatch] = useState('09:00');
  const [slotLastMatch, setSlotLastMatch] = useState('18:00');

  // Tournament form
  const [tournamentGender, setTournamentGender] = useState<Gender>('homme');
  const [numberOfPlayers, setNumberOfPlayers] = useState(8);
  const [minRanking, setMinRanking] = useState<TennisRanking>('40');
  const [maxRanking, setMaxRanking] = useState<TennisRanking>('15');

  // Inline editing
  const [editingTournamentIndex, setEditingTournamentIndex] = useState<number | null>(null);
  const [editTournament, setEditTournament] = useState<Omit<TournamentConfig, 'id'>>({ gender: 'homme', numberOfPlayers: 8, minRanking: '40', maxRanking: '15' });
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [editSlotFirst, setEditSlotFirst] = useState('');
  const [editSlotLast, setEditSlotLast] = useState('');

  const addDailyTimeSlot = () => {
    if (!slotDate) {
      alert('Veuillez sélectionner une date');
      return;
    }

    const newSlot: DailyTimeSlot = {
      date: slotDate,
      firstMatchStart: slotFirstMatch,
      lastMatchStart: slotLastMatch,
    };

    setDailyTimeSlots([...dailyTimeSlots, newSlot]);
    setSlotDate('');
  };

  const removeDailyTimeSlot = (index: number) => {
    setDailyTimeSlots(dailyTimeSlots.filter((_, i) => i !== index));
  };

  const addTournament = () => {
    const newTournament: TournamentConfig = {
      id: `tournament-${tournaments.length + 1}`,
      gender: tournamentGender,
      numberOfPlayers,
      minRanking,
      maxRanking,
    };

    setTournaments([...tournaments, newTournament]);
  };

  const removeTournament = (index: number) => {
    setTournaments(tournaments.filter((_, i) => i !== index));
  };

  const startEditTournament = (index: number) => {
    const t = tournaments[index];
    setEditTournament({ gender: t.gender, numberOfPlayers: t.numberOfPlayers, minRanking: t.minRanking, maxRanking: t.maxRanking });
    setEditingTournamentIndex(index);
  };

  const saveTournament = (index: number) => {
    const updated = [...tournaments];
    updated[index] = { ...updated[index], ...editTournament };
    setTournaments(updated);
    setEditingTournamentIndex(null);
  };

  const startEditSlot = (index: number) => {
    const s = dailyTimeSlots[index];
    setEditSlotFirst(s.firstMatchStart);
    setEditSlotLast(s.lastMatchStart);
    setEditingSlotIndex(index);
  };

  const saveSlot = (index: number) => {
    const updated = [...dailyTimeSlots];
    updated[index] = { ...updated[index], firstMatchStart: editSlotFirst, lastMatchStart: editSlotLast };
    setDailyTimeSlots(updated);
    setEditingSlotIndex(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!startDate || !endDate) {
      alert('Veuillez renseigner les dates de début et fin');
      return;
    }

    if (dailyTimeSlots.length === 0) {
      alert('Veuillez ajouter au moins un créneau horaire');
      return;
    }

    if (tournaments.length === 0) {
      alert('Veuillez ajouter au moins un tournoi');
      return;
    }

    const config: GlobalConfig = {
      name,
      startDate,
      endDate,
      numberOfCourts,
      matchDuration,
      dailyTimeSlots,
      tournaments,
    };

    onSubmit(config);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Global Configuration */}
      <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-card-foreground">
          Configuration Générale
        </h2>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-foreground">
            Nom du tournoi
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex : TMC Été 2025"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Date de début
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Date de fin
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Nombre de courts
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={numberOfCourts}
              onChange={(e) => setNumberOfCourts(parseInt(e.target.value))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Durée d'un match (minutes)
            </label>
            <input
              type="number"
              min="30"
              max="300"
              step="15"
              value={matchDuration}
              onChange={(e) => setMatchDuration(parseInt(e.target.value))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </div>
        </div>
      </div>

      {/* Daily Time Slots */}
      <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-card-foreground">
          Créneaux Horaires par Jour
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Date
            </label>
            <input
              type="date"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Premier match
            </label>
            <input
              type="time"
              value={slotFirstMatch}
              onChange={(e) => setSlotFirstMatch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Dernier match
            </label>
            <input
              type="time"
              value={slotLastMatch}
              onChange={(e) => setSlotLastMatch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={addDailyTimeSlot}
              className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
            >
              Ajouter
            </button>
          </div>
        </div>

        {dailyTimeSlots.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 font-semibold text-foreground">
              Créneaux configurés:
            </h3>
            <div className="space-y-2">
              {dailyTimeSlots.map((slot, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border/70 bg-muted/50 p-3"
                >
                  {editingSlotIndex === index ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium text-foreground">{slot.date}</span>
                      <input
                        type="time"
                        value={editSlotFirst}
                        onChange={(e) => setEditSlotFirst(e.target.value)}
                        className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <input
                        type="time"
                        value={editSlotLast}
                        onChange={(e) => setEditSlotLast(e.target.value)}
                        className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <button type="button" onClick={() => saveSlot(index)} className="text-sm font-medium text-primary transition hover:opacity-80">Valider</button>
                      <button type="button" onClick={() => setEditingSlotIndex(null)} className="text-sm font-medium text-muted-foreground transition hover:opacity-80">Annuler</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">
                        {slot.date}: {slot.firstMatchStart} - {slot.lastMatchStart}
                      </span>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => startEditSlot(index)} className="text-sm font-medium text-primary transition hover:opacity-80">Modifier</button>
                        <button type="button" onClick={() => removeDailyTimeSlot(index)} className="text-sm font-medium text-destructive transition hover:opacity-80">Supprimer</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tournaments */}
      <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-card-foreground">Tournois</h2>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Sexe
            </label>
            <select
              value={tournamentGender}
              onChange={(e) => setTournamentGender(e.target.value as Gender)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="homme">Homme</option>
              <option value="femme">Femme</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Nombre de joueurs
            </label>
            <select
              value={numberOfPlayers}
              onChange={(e) => setNumberOfPlayers(parseInt(e.target.value))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="4">4</option>
              <option value="8">8</option>
              <option value="12">12</option>
              <option value="16">16</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Classement min
            </label>
            <select
              value={minRanking}
              onChange={(e) => setMinRanking(e.target.value as TennisRanking)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {TENNIS_RANKINGS.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Classement max
            </label>
            <select
              value={maxRanking}
              onChange={(e) => setMaxRanking(e.target.value as TennisRanking)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {TENNIS_RANKINGS.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={addTournament}
              className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
            >
              Ajouter
            </button>
          </div>
        </div>

        {tournaments.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 font-semibold text-foreground">
              Tournois configurés:
            </h3>
            <div className="space-y-2">
              {tournaments.map((tournament, index) => (
                <div
                  key={tournament.id}
                  className="rounded-lg border border-border/70 bg-muted/50 p-3"
                >
                  {editingTournamentIndex === index ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={editTournament.gender}
                        onChange={(e) => setEditTournament((t) => ({ ...t, gender: e.target.value as Gender }))}
                        className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="homme">Homme</option>
                        <option value="femme">Femme</option>
                      </select>
                      <select
                        value={editTournament.numberOfPlayers}
                        onChange={(e) => setEditTournament((t) => ({ ...t, numberOfPlayers: parseInt(e.target.value) }))}
                        className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="4">4 joueurs</option>
                        <option value="8">8 joueurs</option>
                        <option value="12">12 joueurs</option>
                        <option value="16">16 joueurs</option>
                      </select>
                      <select
                        value={editTournament.minRanking}
                        onChange={(e) => setEditTournament((t) => ({ ...t, minRanking: e.target.value as TennisRanking }))}
                        className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {TENNIS_RANKINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <select
                        value={editTournament.maxRanking}
                        onChange={(e) => setEditTournament((t) => ({ ...t, maxRanking: e.target.value as TennisRanking }))}
                        className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {TENNIS_RANKINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button type="button" onClick={() => saveTournament(index)} className="text-sm font-medium text-primary transition hover:opacity-80">Valider</button>
                      <button type="button" onClick={() => setEditingTournamentIndex(null)} className="text-sm font-medium text-muted-foreground transition hover:opacity-80">Annuler</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">
                        {tournament.gender === 'homme' ? 'Hommes' : 'Femmes'} -{' '}
                        {tournament.numberOfPlayers} joueurs - Classement:{' '}
                        {tournament.minRanking} à {tournament.maxRanking}
                      </span>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => startEditTournament(index)} className="text-sm font-medium text-primary transition hover:opacity-80">Modifier</button>
                        <button type="button" onClick={() => removeTournament(index)} className="text-sm font-medium text-destructive transition hover:opacity-80">Supprimer</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-center">
        <button
          type="submit"
          className="rounded-lg bg-primary px-8 py-3 text-lg font-semibold text-primary-foreground shadow-sm transition hover:brightness-95"
        >
          Générer le Planning
        </button>
      </div>
    </form>
  );
}
