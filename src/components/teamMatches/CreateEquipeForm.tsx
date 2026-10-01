import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import { useClubConfig } from '../../hooks/useClubConfig';
import type { TeamCompetition, TeamEquipe } from '../../types';
import { competitionLabel } from './teamMatchLabels';
import {
  previewTenupPool,
  suggestedTeamIds,
  type TenupPoolPreview,
} from '../../../shared/tenupPoolClient';
import { teamCalendar } from '../../../shared/tenupPool.mjs';

export default function CreateEquipeForm({
  competitions,
  existingEquipes,
  defaultCompetitionId,
  onClose,
  onCreated,
}: {
  competitions: TeamCompetition[];
  existingEquipes: TeamEquipe[];
  defaultCompetitionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { clubId, club } = useClub();
  const { config, loading: configLoading } = useClubConfig();
  const clubNames = [config.brand.name, club?.name ?? ''];
  const nextNumber = (id: string) =>
    Math.max(
      0,
      ...existingEquipes
        .filter((e) => e.competition_id === id)
        .map((e) => e.numero)
    ) + 1;
  const [competitionId, setCompetitionId] = useState(defaultCompetitionId);
  const [numero, setNumero] = useState(nextNumber(defaultCompetitionId));
  const [division, setDivision] = useState('');
  const [nbJournees, setNbJournees] = useState(5);
  const [url, setUrl] = useState(
    competitions.find((c) => c.id === defaultCompetitionId)?.tenup_url ?? ''
  );
  const competition = competitions.find((c) => c.id === competitionId);
  const [preview, setPreview] = useState<TenupPoolPreview | null>(null);
  const [teamId, setTeamId] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendar = preview && teamId ? teamCalendar(preview, teamId) : [];
  const suggestions = preview
    ? suggestedTeamIds(preview, clubNames, config.brand.city)
    : [];
  const duplicate =
    !!teamId &&
    existingEquipes.some(
      (e) => e.competition_id === competitionId && e.tenup_team_id === teamId
    );
  const resetPreview = () => {
    setPreview(null);
    setTeamId('');
    setReviewed(false);
  };
  const read = async () => {
    if (busy || !clubId || configLoading) return;
    setBusy(true);
    setError(null);
    resetPreview();
    try {
      const result = await previewTenupPool(
        supabase,
        clubId,
        competitionId,
        url
      );
      const candidates = suggestedTeamIds(
        result,
        clubNames,
        config.brand.city
      ).filter(
        (id) =>
          !existingEquipes.some(
            (e) => e.competition_id === competitionId && e.tenup_team_id === id
          )
      );
      setTeamId(candidates.length === 1 ? candidates[0] : '');
      setPreview(result);
      setDivision(result.division);
      setNbJournees(result.rounds.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lecture Ten’Up impossible.');
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (busy || !clubId) return;
    setError(null);
    if (
      !competitionId ||
      !division.trim() ||
      division.trim().length > 160 ||
      !Number.isInteger(numero) ||
      numero < 1 ||
      numero > 999 ||
      !Number.isInteger(nbJournees) ||
      nbJournees < 1 ||
      nbJournees > 30
    ) {
      setError(
        'Vérifiez la compétition, le numéro, la division et le nombre de journées (1 à 30).'
      );
      return;
    }
    if (preview && (!teamId || !reviewed || duplicate)) {
      setError(
        duplicate
          ? 'Cette équipe Ten’Up est déjà ajoutée.'
          : 'Choisissez une équipe et validez son calendrier.'
      );
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('team_equipe_create', {
        p_club: clubId,
        p_competition: competitionId,
        p_numero: numero,
        p_division: division.trim(),
        p_journees: nbJournees,
        p_preview: preview?.id ?? null,
        p_team_id: teamId || null,
      });
      if (error) throw error;
      onCreated();
    } catch (e) {
      setError((e as { message?: string }).message ?? 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };
  const cls =
    'mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-team-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl"
      >
        <h3 id="create-team-title" className="mb-4 text-lg font-semibold">
          Créer une équipe
        </h3>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label htmlFor="team-competition">Compétition</label>
            <select
              id="team-competition"
              value={competitionId}
              className={cls}
              onChange={(e) => {
                const id = e.target.value;
                setCompetitionId(id);
                setNumero(nextNumber(id));
                setUrl(competitions.find((c) => c.id === id)?.tenup_url ?? '');
                setDivision('');
                setNbJournees(5);
                resetPreview();
                setError(null);
              }}
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {competitionLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border p-3">
            {preview && !competition?.tenup_url && (
              <p className="mb-3 text-sm text-amber-700">
                Cette compétition n’a pas de lien Ten’Up enregistré : vérifiez
                que la poule appartient au bon championnat. Vous pouvez
                enregistrer son lien depuis « Modifier la compétition ».
              </p>
            )}
            <label htmlFor="team-tenup-url">
              Lien Ten’Up de la poule (facultatif)
            </label>
            <input
              id="team-tenup-url"
              type="url"
              value={url}
              className={cls}
              onChange={(e) => {
                setUrl(e.target.value);
                resetPreview();
              }}
              placeholder="https://tenup.fft.fr/championnat/…?division=…&phase=…&poule=…"
            />
            <button
              type="button"
              onClick={read}
              disabled={!url.trim() || configLoading}
              className="mt-3 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            >
              {busy ? 'Lecture…' : 'Lire les équipes et le calendrier'}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              Copiez le lien de la poule contenant votre équipe. Vous choisirez
              l’équipe avant de créer.
            </p>
          </div>
          {preview && (
            <div>
              <p className="text-sm">
                {preview.division} · {preview.phase} · {preview.poule}
              </p>
              <label htmlFor="team-tenup-choice">Équipe Ten’Up à ajouter</label>
              <select
                id="team-tenup-choice"
                className={cls}
                value={teamId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setReviewed(false);
                }}
              >
                <option value="">Choisir une équipe…</option>
                {[...preview.teams]
                  .sort(
                    (a, b) =>
                      Number(suggestions.includes(b.id)) -
                      Number(suggestions.includes(a.id))
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {suggestions.includes(t.id) ? ' · Club probable' : ''}
                      {existingEquipes.some(
                        (e) =>
                          e.competition_id === competitionId &&
                          e.tenup_team_id === t.id
                      )
                        ? ' · Déjà ajoutée'
                        : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="team-number">Numéro dans le club</label>
              <input
                id="team-number"
                type="number"
                min={1}
                max={999}
                value={numero}
                onChange={(e) => setNumero(Number(e.target.value))}
                className={cls}
              />
            </div>
            <div>
              <label htmlFor="team-division">Division</label>
              <input
                id="team-division"
                value={division}
                maxLength={160}
                readOnly={!!preview}
                onChange={(e) => setDivision(e.target.value)}
                placeholder="R2, Groupe A…"
                className={cls}
              />
            </div>
          </div>
          <div>
            <label htmlFor="team-rounds">Journées de poule</label>
            <input
              id="team-rounds"
              type="number"
              min={1}
              max={30}
              value={nbJournees}
              readOnly={!!preview}
              onChange={(e) => setNbJournees(Number(e.target.value))}
              className={cls}
            />
          </div>
          {calendar.length > 0 && (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Journée</th>
                    <th className="text-left">Date</th>
                    <th className="text-left">Adversaire</th>
                    <th className="text-left">Lieu</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.map((r) => (
                    <tr key={r.numero}>
                      <td className="py-2">J{r.numero}</td>
                      <td>
                        {r.date
                          ? new Date(r.date + 'T12:00:00Z').toLocaleDateString(
                              'fr-FR',
                              { timeZone: 'Europe/Paris' }
                            )
                          : '—'}
                      </td>
                      <td>{r.exempt ? 'Exempte' : r.adversaire}</td>
                      <td>
                        {r.exempt
                          ? '—'
                          : r.domicile
                            ? 'Au club'
                            : 'Déplacement'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                Les heures ne sont pas fournies par ce calendrier : elles seront
                à préciser dans les rencontres. Les résultats seront
                synchronisés séparément.
              </p>
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                J’ai vérifié l’équipe et son calendrier.
              </label>
            </div>
          )}
          {preview && (
            <button
              type="button"
              onClick={() => {
                resetPreview();
                setError(null);
              }}
              className="text-sm underline"
            >
              Passer à la saisie manuelle
            </button>
          )}
        </fieldset>
        {duplicate && (
          <p role="alert" className="mt-3 text-red-600">
            Cette équipe Ten’Up est déjà ajoutée.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-red-600">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border px-4 py-2"
          >
            Annuler
          </button>
          <button
            onClick={create}
            disabled={
              busy || duplicate || (!!preview && (!teamId || !reviewed))
            }
            className="rounded-lg bg-primary px-5 py-2 text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Chargement…' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}
