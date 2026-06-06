import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import TeamMatchesHeader from './TeamMatchesHeader';
import { competitionLabel, etapeLabel } from './teamMatchLabels';

/** ISO → valeur pour <input type="datetime-local"> (heure locale, sans secondes). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Context {
  etape: TeamEtape;
  equipe: TeamEquipe;
  competition: TeamCompetition;
}

export default function TeamRencontreForm() {
  const { id } = useParams(); // présent en mode édition
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [context, setContext] = useState<Context | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clubAdverse, setClubAdverse] = useState('');
  const [dateHeure, setDateHeure] = useState('');
  const [domicile, setDomicile] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadContextFromEtape = async (etapeId: string) => {
      const { data: etape } = await supabase
        .from('team_etapes')
        .select('*')
        .eq('id', etapeId)
        .single();
      if (!etape) return null;
      const { data: equipe } = await supabase
        .from('team_equipes')
        .select('*')
        .eq('id', (etape as TeamEtape).equipe_id)
        .single();
      if (!equipe) return null;
      const { data: competition } = await supabase
        .from('team_competitions')
        .select('*')
        .eq('id', (equipe as TeamEquipe).competition_id)
        .single();
      if (!competition) return null;
      return {
        etape: etape as TeamEtape,
        equipe: equipe as TeamEquipe,
        competition: competition as TeamCompetition,
      };
    };

    (async () => {
      setLoading(true);
      let etapeId: string | null = null;

      if (isEdit && id) {
        const { data: renc } = await supabase
          .from('team_rencontres')
          .select('*')
          .eq('id', id)
          .single();
        if (!renc) {
          if (!cancelled) {
            setLoadError('Rencontre introuvable.');
            setLoading(false);
          }
          return;
        }
        const r = renc as TeamRencontre;
        setClubAdverse(r.club_adverse);
        setDateHeure(isoToLocalInput(r.date_heure));
        setDomicile(r.domicile);
        etapeId = r.etape_id;
      } else {
        etapeId = searchParams.get('etapeId');
      }

      if (!etapeId) {
        if (!cancelled) {
          setLoadError('Étape manquante.');
          setLoading(false);
        }
        return;
      }

      const ctx = await loadContextFromEtape(etapeId);
      if (cancelled) return;
      if (!ctx) {
        setLoadError('Contexte introuvable.');
        setLoading(false);
        return;
      }
      setContext(ctx);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, isEdit, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!clubAdverse.trim()) return setError('Le club adverse est obligatoire.');
    if (!dateHeure) return setError('La date et l\'heure sont obligatoires.');
    if (!context) return;

    setSaving(true);
    const isoDate = new Date(dateHeure).toISOString();

    if (isEdit && id) {
      const { error: updErr } = await supabase
        .from('team_rencontres')
        .update({ club_adverse: clubAdverse.trim(), date_heure: isoDate, domicile })
        .eq('id', id);
      if (updErr) {
        setError(updErr.message);
        setSaving(false);
        return;
      }
      navigate(`/team-matches/rencontre/${id}`);
    } else {
      const { data, error: insErr } = await supabase
        .from('team_rencontres')
        .insert({
          etape_id: context.etape.id,
          club_adverse: clubAdverse.trim(),
          date_heure: isoDate,
          domicile,
        })
        .select('id')
        .single();
      if (insErr || !data) {
        setError(insErr?.message ?? 'Création impossible.');
        setSaving(false);
        return;
      }
      navigate(`/team-matches/rencontre/${data.id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Chargement...
      </div>
    );
  }

  if (loadError || !context) {
    return (
      <div className="min-h-screen">
        <TeamMatchesHeader title="Rencontre" backTo="/team-matches" backLabel="Matches par équipe" />
        <main className="container mx-auto px-4 py-12 text-center text-muted-foreground">
          {loadError ?? 'Contexte introuvable.'}
        </main>
      </div>
    );
  }

  const backTo = `/team-matches/equipe/${context.equipe.id}`;

  return (
    <div className="min-h-screen">
      <TeamMatchesHeader
        title={isEdit ? 'Modifier la rencontre' : 'Nouvelle rencontre'}
        backTo={backTo}
        backLabel="Retour à l'équipe"
      />

      <main className="container mx-auto max-w-2xl px-4 py-8">
        {/* Contexte lecture seule */}
        <div className="mb-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-medium">{competitionLabel(context.competition)}</p>
          <p className="text-muted-foreground">
            Équipe {context.equipe.numero} · {etapeLabel(context.etape)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border bg-card/90 p-6 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-foreground">Club adverse *</label>
            <input
              type="text"
              value={clubAdverse}
              onChange={(e) => setClubAdverse(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground">Date et heure *</label>
            <input
              type="datetime-local"
              value={dateHeure}
              onChange={(e) => setDateHeure(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground">Lieu *</label>
            <div className="mt-1 inline-flex rounded-lg border border-border p-0.5">
              {[
                { val: true, label: 'Au club' },
                { val: false, label: 'Déplacement' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setDomicile(opt.val)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                    domicile === opt.val
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate(backTo)}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
