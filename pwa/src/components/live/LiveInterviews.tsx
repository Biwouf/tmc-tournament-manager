import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteInterview, readMatchInterviews } from '../../lib/interviews';
import { uiMessage } from '../../lib/uiMessage';
import '../interviews/interviews.css';

/** Zone mixte d'un live terminé : interviews publiées des joueurs du club. */
export default function LiveInterviews({ matchId, clubId, userId }: { matchId: string; clubId: string; userId: string | null }) {
  const queryClient = useQueryClient();
  const key = ['live-interviews', clubId, matchId, userId];
  const interviews = useQuery({ queryKey: key, queryFn: () => readMatchInterviews(matchId, clubId) });
  const remove = useMutation({
    mutationFn: deleteInterview,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['live-interviews', clubId, matchId] }),
  });
  const list = (interviews.data ?? []).filter((i) => i.items.length);
  if (!list.length) return null;
  return (
    <section className="mixed-zone" aria-label="Zone mixte">
      <span className="mixed-zone-kicker">🎙️ ZONE MIXTE</span>
      {list.map((i) => (
        <article key={i.id} className="mixed-zone-card">
          <h3>{i.player}</h3>
          {i.items.map((item, n) => (
            <div key={n} className="mixed-zone-item">
              <p className="mixed-zone-question">{item.question}</p>
              <p className="mixed-zone-answer">{item.answer}</p>
            </div>
          ))}
          {i.can_delete && (
            <button
              className="mixed-zone-delete"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm('Retirer cette interview du récap ?')) remove.mutate(i.id);
              }}
            >
              Retirer l’interview
            </button>
          )}
        </article>
      ))}
      {remove.isError && (
        <p className="booking-error" role="alert">{uiMessage(remove.error, 'Le retrait n’a pas abouti. Réessaie.')}</p>
      )}
    </section>
  );
}
