import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadError } from '../components/layout/LoadState';
import { uiMessage } from '../lib/uiMessage';
import {
  InterviewError,
  answerInterview,
  declineInterview,
  interviewScore,
  prepareQuestions,
  readDraft,
  readInterview,
  writeDraft,
  type Interview,
} from '../lib/interviews';
import '../components/courses/courses.css';
import '../components/interviews/interviews.css';

const MAX = 1000;

/** Zone mixte : le joueur répond aux questions du journaliste après son match. */
export default function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const interview = useQuery({
    queryKey: ['interview', id],
    queryFn: () => readInterview(id!),
    enabled: !!id,
    retry: (count, error) => !(error instanceof InterviewError && error.code) && count < 1,
  });
  const data = interview.data;

  const prepare = useMutation({
    mutationFn: () => prepareQuestions(id!),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['interview', id] }),
  });
  const asked = useRef(false);
  useEffect(() => {
    if (data?.status === 'pending' && !asked.current) {
      asked.current = true;
      prepare.mutate();
    }
  }, [data?.status, prepare]);

  if (interview.isPending) return <p className="interview-page" role="status">Chargement de l’interview…</p>;
  if (interview.isError) {
    const error = interview.error;
    if (error instanceof InterviewError && error.code)
      return <Notice title="Interview indisponible">{error.message}</Notice>;
    return <LoadError title="Impossible de charger l’interview" onRetry={() => void interview.refetch()} />;
  }
  if (!data) return null;

  return (
    <div className="interview-page">
      <header className="interview-hero">
        <span className="interview-kicker">🎙️ INTERVIEW D’APRÈS-MATCH</span>
        <h1>
          {data.result === 'win' ? 'Victoire' : data.result === 'loss' ? 'Défaite' : 'Match'} contre {data.opponent}
        </h1>
        {interviewScore(data) && <p className="interview-score">{interviewScore(data)}</p>}
      </header>
      {data.status === 'pending' && (
        prepare.isError ? (
          <div className="interview-state" role="alert">
            <p>{uiMessage(prepare.error, 'Les questions n’ont pas pu être préparées. Réessaie dans un instant.')}</p>
            <button className="booking-button secondary" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
              Réessayer
            </button>
          </div>
        ) : (
          <p className="interview-state" role="status">Le journaliste prépare ses questions…</p>
        )
      )}
      {data.status === 'ready' && <AnswerForm interview={data} />}
      {data.status === 'published' && (
        <Notice title="Ton interview est publiée">
          Elle apparaît dans le récap du match. <Link to={`/matches/${data.live_match_id}`}>Voir le live →</Link>
        </Notice>
      )}
      {data.status === 'declined' && <Notice title="Pas de commentaire">Tu as choisi de ne pas répondre à cette interview.</Notice>}
      {data.status === 'expired' && <Notice title="Interview expirée">Le délai de 48 heures pour répondre est passé.</Notice>}
      {data.status === 'removed' && <Notice title="Interview retirée">Cette interview a été retirée du récap du match.</Notice>}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="interview-state">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

function AnswerForm({ interview }: { interview: Interview }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>(() => readDraft(interview.id));
  const [confirmDecline, setConfirmDecline] = useState(false);
  const refresh = () => {
    writeDraft(interview.id, null);
    void queryClient.invalidateQueries({ queryKey: ['interview', interview.id] });
    void queryClient.invalidateQueries({ queryKey: ['interviews-pending'] });
  };
  const publish = useMutation({
    mutationFn: () =>
      answerInterview(interview.id, interview.questions.map((q) => ({ question_id: q.id, texte: draft[q.id] ?? '' }))),
    onSuccess: refresh,
  });
  const decline = useMutation({ mutationFn: () => declineInterview(interview.id), onSuccess: refresh });
  const busy = publish.isPending || decline.isPending;
  const answered = interview.questions.some((q) => (draft[q.id] ?? '').trim());
  const error = publish.error ?? decline.error;

  const change = (question: string, value: string) => {
    const next = { ...draft, [question]: value.slice(0, MAX) };
    setDraft(next);
    writeDraft(interview.id, next);
  };

  return (
    <form
      className="interview-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (answered && !busy) publish.mutate();
      }}
    >
      <p className="interview-intro">
        Réponds à chaud, comme un pro. Tu peux passer une question : seules tes réponses seront publiées dans le récap
        du match.
      </p>
      {interview.questions.map((q, index) => (
        <label key={q.id} className="interview-question">
          <span className="interview-question-text">
            <span className="interview-question-index">Question {index + 1}</span>
            {q.texte}
          </span>
          <textarea
            value={draft[q.id] ?? ''}
            onChange={(e) => change(q.id, e.target.value)}
            maxLength={MAX}
            rows={4}
            placeholder="Ta réponse (facultatif)"
            disabled={busy}
          />
        </label>
      ))}
      {error && (
        <p className="booking-error" role="alert">
          {uiMessage(error, 'L’envoi n’a pas abouti. Réessaie.')}
        </p>
      )}
      <button type="submit" className="booking-button primary booking-wide" disabled={!answered || busy}>
        {publish.isPending ? 'Publication…' : 'Publier mes réponses'}
      </button>
      {confirmDecline ? (
        <div className="interview-decline" role="group" aria-label="Confirmer">
          <p>Rien ne sera publié et tu ne pourras plus répondre.</p>
          <button type="button" className="booking-button secondary" onClick={() => decline.mutate()} disabled={busy}>
            Confirmer : pas de commentaire
          </button>
          <button type="button" className="booking-button secondary" onClick={() => setConfirmDecline(false)} disabled={busy}>
            Annuler
          </button>
        </div>
      ) : (
        <button type="button" className="booking-button secondary booking-wide" onClick={() => setConfirmDecline(true)} disabled={busy}>
          Pas de commentaire
        </button>
      )}
    </form>
  );
}
