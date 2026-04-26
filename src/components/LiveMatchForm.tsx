import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ClubEvent, LiveMatchType } from '../types';

interface FieldErrors {
  j1_prenom?: string;
  j1_nom?: string;
  j2_prenom?: string;
  j2_nom?: string;
  j3_prenom?: string;
  j3_nom?: string;
  j4_prenom?: string;
  j4_nom?: string;
  match_date?: string;
}

function formatEventLabel(ev: Pick<ClubEvent, 'titre' | 'date_debut'>): string {
  const date = new Date(ev.date_debut).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return `${ev.titre} — ${date}`;
}

export default function LiveMatchForm() {
  const navigate = useNavigate();

  const [matchType, setMatchType] = useState<LiveMatchType>('simple');
  const [matchDate, setMatchDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [eventId, setEventId] = useState<string>('');

  const [j1Prenom, setJ1Prenom] = useState('');
  const [j1Nom, setJ1Nom] = useState('');
  const [j1Classement, setJ1Classement] = useState('');
  const [j1Club, setJ1Club] = useState('');

  const [j2Prenom, setJ2Prenom] = useState('');
  const [j2Nom, setJ2Nom] = useState('');
  const [j2Classement, setJ2Classement] = useState('');
  const [j2Club, setJ2Club] = useState('');

  const [j3Prenom, setJ3Prenom] = useState('');
  const [j3Nom, setJ3Nom] = useState('');
  const [j3Classement, setJ3Classement] = useState('');
  const [j3Club, setJ3Club] = useState('');

  const [j4Prenom, setJ4Prenom] = useState('');
  const [j4Nom, setJ4Nom] = useState('');
  const [j4Classement, setJ4Classement] = useState('');
  const [j4Club, setJ4Club] = useState('');

  const [events, setEvents] = useState<Pick<ClubEvent, 'id' | 'titre' | 'date_debut'>[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    supabase
      .from('events')
      .select('id, titre, date_debut')
      .gte('date_debut', since.toISOString())
      .order('date_debut', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setEvents(data);
      });
  }, []);

  const validate = (): FieldErrors => {
    const errs: FieldErrors = {};
    if (!matchDate) errs.match_date = 'Date obligatoire.';
    if (!j1Prenom.trim()) errs.j1_prenom = 'Prénom obligatoire.';
    if (!j1Nom.trim()) errs.j1_nom = 'Nom obligatoire.';
    if (!j2Prenom.trim()) errs.j2_prenom = 'Prénom obligatoire.';
    if (!j2Nom.trim()) errs.j2_nom = 'Nom obligatoire.';
    if (matchType === 'double') {
      if (!j3Prenom.trim()) errs.j3_prenom = 'Prénom obligatoire.';
      if (!j3Nom.trim()) errs.j3_nom = 'Nom obligatoire.';
      if (!j4Prenom.trim()) errs.j4_prenom = 'Prénom obligatoire.';
      if (!j4Nom.trim()) errs.j4_nom = 'Nom obligatoire.';
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    const payload = {
      match_date: matchDate,
      start_time: startTime || null,
      match_type: matchType,
      event_id: eventId || null,

      j1_prenom: j1Prenom.trim(),
      j1_nom: j1Nom.trim(),
      j1_classement: j1Classement.trim(),
      j1_club: j1Club.trim(),

      j2_prenom: j2Prenom.trim(),
      j2_nom: j2Nom.trim(),
      j2_classement: j2Classement.trim(),
      j2_club: j2Club.trim(),

      j3_prenom: matchType === 'double' ? j3Prenom.trim() : null,
      j3_nom: matchType === 'double' ? j3Nom.trim() : null,
      j3_classement: matchType === 'double' ? j3Classement.trim() : null,
      j3_club: matchType === 'double' ? j3Club.trim() : null,

      j4_prenom: matchType === 'double' ? j4Prenom.trim() : null,
      j4_nom: matchType === 'double' ? j4Nom.trim() : null,
      j4_classement: matchType === 'double' ? j4Classement.trim() : null,
      j4_club: matchType === 'double' ? j4Club.trim() : null,

      status: 'pending' as const,
    };

    const { error } = await supabase.from('live_matches').insert(payload);
    if (error) {
      setSubmitError(error.message);
      setSaving(false);
      return;
    }
    navigate('/live-score');
  };

  const handleLogout = () => supabase.auth.signOut();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Nouveau match</h1>
            <Link to="/live-score" className="mt-2 inline-block text-sm text-muted-foreground hover:underline">
              ← Retour à la liste
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border bg-card/90 p-6 shadow-sm">
          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-foreground">Type de match *</label>
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as LiveMatchType)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="simple">Simple</option>
              <option value="double">Double</option>
            </select>
          </div>

          {/* Date / Heure */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground">Date *</label>
              <input
                type="date"
                value={matchDate}
                onChange={(e) => setMatchDate(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {errors.match_date && <p className="mt-1 text-xs text-red-600">{errors.match_date}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">
                Heure de début <span className="text-muted-foreground">(optionnel)</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Événement lié */}
          <div>
            <label className="block text-sm font-medium text-foreground">
              Événement lié <span className="text-muted-foreground">(optionnel)</span>
            </label>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Aucun</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {formatEventLabel(ev)}
                </option>
              ))}
            </select>
          </div>

          {/* Équipe 1 */}
          <fieldset className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
            <legend className="px-2 text-sm font-semibold">
              {matchType === 'double' ? 'Équipe 1 — Joueur 1' : 'Joueur 1'}
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Prénom *</label>
                <input
                  type="text"
                  value={j1Prenom}
                  onChange={(e) => setJ1Prenom(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                {errors.j1_prenom && <p className="mt-1 text-xs text-red-600">{errors.j1_prenom}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Nom *</label>
                <input
                  type="text"
                  value={j1Nom}
                  onChange={(e) => setJ1Nom(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                {errors.j1_nom && <p className="mt-1 text-xs text-red-600">{errors.j1_nom}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Classement</label>
                <input
                  type="text"
                  value={j1Classement}
                  onChange={(e) => setJ1Classement(e.target.value)}
                  placeholder="ex: 15/4, 30, NC"
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Club</label>
                <input
                  type="text"
                  value={j1Club}
                  onChange={(e) => setJ1Club(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </fieldset>

          {matchType === 'double' && (
            <fieldset className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
              <legend className="px-2 text-sm font-semibold">Équipe 1 — Joueur 2</legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Prénom *</label>
                  <input
                    type="text"
                    value={j3Prenom}
                    onChange={(e) => setJ3Prenom(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  {errors.j3_prenom && <p className="mt-1 text-xs text-red-600">{errors.j3_prenom}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Nom *</label>
                  <input
                    type="text"
                    value={j3Nom}
                    onChange={(e) => setJ3Nom(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  {errors.j3_nom && <p className="mt-1 text-xs text-red-600">{errors.j3_nom}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Classement</label>
                  <input
                    type="text"
                    value={j3Classement}
                    onChange={(e) => setJ3Classement(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Club</label>
                  <input
                    type="text"
                    value={j3Club}
                    onChange={(e) => setJ3Club(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </fieldset>
          )}

          {/* Équipe 2 */}
          <fieldset className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
            <legend className="px-2 text-sm font-semibold">
              {matchType === 'double' ? 'Équipe 2 — Joueur 1' : 'Joueur 2'}
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Prénom *</label>
                <input
                  type="text"
                  value={j2Prenom}
                  onChange={(e) => setJ2Prenom(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                {errors.j2_prenom && <p className="mt-1 text-xs text-red-600">{errors.j2_prenom}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Nom *</label>
                <input
                  type="text"
                  value={j2Nom}
                  onChange={(e) => setJ2Nom(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                {errors.j2_nom && <p className="mt-1 text-xs text-red-600">{errors.j2_nom}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Classement</label>
                <input
                  type="text"
                  value={j2Classement}
                  onChange={(e) => setJ2Classement(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Club</label>
                <input
                  type="text"
                  value={j2Club}
                  onChange={(e) => setJ2Club(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </fieldset>

          {matchType === 'double' && (
            <fieldset className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
              <legend className="px-2 text-sm font-semibold">Équipe 2 — Joueur 2</legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Prénom *</label>
                  <input
                    type="text"
                    value={j4Prenom}
                    onChange={(e) => setJ4Prenom(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  {errors.j4_prenom && <p className="mt-1 text-xs text-red-600">{errors.j4_prenom}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Nom *</label>
                  <input
                    type="text"
                    value={j4Nom}
                    onChange={(e) => setJ4Nom(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  {errors.j4_nom && <p className="mt-1 text-xs text-red-600">{errors.j4_nom}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Classement</label>
                  <input
                    type="text"
                    value={j4Classement}
                    onChange={(e) => setJ4Classement(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Club</label>
                  <input
                    type="text"
                    value={j4Club}
                    onChange={(e) => setJ4Club(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </fieldset>
          )}

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Link
              to="/live-score"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
            >
              Annuler
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {saving ? 'Création...' : 'Créer le match'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
