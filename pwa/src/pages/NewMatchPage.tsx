import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ClubEvent, LiveMatchType } from '../types';
import { useHeaderAction } from '../components/layout/HeaderActionContext';

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

const inputClass =
  'block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20';

export default function NewMatchPage() {
  const navigate = useNavigate();

  const [matchType, setMatchType] = useState<LiveMatchType>('simple');
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().split('T')[0]);
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

  const submit = async () => {
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
      scored_by: null,
    };

    const { error } = await supabase.from('live_matches').insert(payload);
    if (error) {
      setSubmitError(error.message);
      setSaving(false);
      return;
    }
    navigate('/matches');
  };

  useHeaderAction({
    kind: 'text',
    label: saving ? 'Création...' : 'Créer',
    accent: true,
    onClick: () => { void submit(); },
  });

  return (
    <div className="p-4 flex flex-col gap-5">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Type de match *</label>
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as LiveMatchType)}
            className={inputClass}
          >
            <option value="simple">Simple</option>
            <option value="double">Double</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Date *</label>
            <input
              type="date"
              value={matchDate}
              onChange={(e) => setMatchDate(e.target.value)}
              className={inputClass}
            />
            {errors.match_date && <p className="mt-1 text-xs text-red-600">{errors.match_date}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Heure <span className="text-muted-foreground">(opt.)</span>
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Événement lié <span className="text-muted-foreground">(opt.)</span>
          </label>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className={inputClass}
          >
            <option value="">Aucun</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {formatEventLabel(ev)}
              </option>
            ))}
          </select>
        </div>

        <PlayerFieldset
          legend={matchType === 'double' ? 'Équipe 1 — Joueur 1' : 'Joueur 1'}
          prenom={j1Prenom} setPrenom={setJ1Prenom}
          nom={j1Nom} setNom={setJ1Nom}
          classement={j1Classement} setClassement={setJ1Classement}
          club={j1Club} setClub={setJ1Club}
          errPrenom={errors.j1_prenom} errNom={errors.j1_nom}
        />

        {matchType === 'double' && (
          <PlayerFieldset
            legend="Équipe 1 — Joueur 2"
            prenom={j3Prenom} setPrenom={setJ3Prenom}
            nom={j3Nom} setNom={setJ3Nom}
            classement={j3Classement} setClassement={setJ3Classement}
            club={j3Club} setClub={setJ3Club}
            errPrenom={errors.j3_prenom} errNom={errors.j3_nom}
          />
        )}

        <PlayerFieldset
          legend={matchType === 'double' ? 'Équipe 2 — Joueur 1' : 'Joueur 2'}
          prenom={j2Prenom} setPrenom={setJ2Prenom}
          nom={j2Nom} setNom={setJ2Nom}
          classement={j2Classement} setClassement={setJ2Classement}
          club={j2Club} setClub={setJ2Club}
          errPrenom={errors.j2_prenom} errNom={errors.j2_nom}
        />

        {matchType === 'double' && (
          <PlayerFieldset
            legend="Équipe 2 — Joueur 2"
            prenom={j4Prenom} setPrenom={setJ4Prenom}
            nom={j4Nom} setNom={setJ4Nom}
            classement={j4Classement} setClassement={setJ4Classement}
            club={j4Club} setClub={setJ4Club}
            errPrenom={errors.j4_prenom} errNom={errors.j4_nom}
          />
        )}

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {submitError}
          </div>
        )}
      </form>
    </div>
  );
}

function PlayerFieldset({
  legend,
  prenom, setPrenom,
  nom, setNom,
  classement, setClassement,
  club, setClub,
  errPrenom, errNom,
}: {
  legend: string;
  prenom: string; setPrenom: (v: string) => void;
  nom: string; setNom: (v: string) => void;
  classement: string; setClassement: (v: string) => void;
  club: string; setClub: (v: string) => void;
  errPrenom?: string; errNom?: string;
}) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
      <legend className="px-2 text-sm font-semibold text-foreground">{legend}</legend>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Prénom *</label>
        <input type="text" value={prenom} onChange={(e) => setPrenom(e.target.value)} className={inputClass} />
        {errPrenom && <p className="mt-1 text-xs text-red-600">{errPrenom}</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Nom *</label>
        <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} className={inputClass} />
        {errNom && <p className="mt-1 text-xs text-red-600">{errNom}</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Classement</label>
        <input
          type="text"
          value={classement}
          onChange={(e) => setClassement(e.target.value)}
          placeholder="ex: 15/4, 30, NC"
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Club</label>
        <input type="text" value={club} onChange={(e) => setClub(e.target.value)} className={inputClass} />
      </div>
    </fieldset>
  );
}
