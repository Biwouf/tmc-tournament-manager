import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readMyPendingInterviews } from '../../lib/interviews';
import './interviews.css';

/**
 * Interviews d'après-match qui attendent le joueur connecté : en tête du Live et de Mon profil, et
 * sur la page du live concerné (`matchId`), où mène la notification.
 */
export default function InterviewInvite({ clubId, userId, matchId }: { clubId: string | null; userId: string | null; matchId?: string }) {
  const pending = useQuery({
    queryKey: ['interviews-pending', clubId, userId],
    queryFn: () => readMyPendingInterviews(clubId!),
    enabled: !!clubId && !!userId,
  });
  const list = (pending.data ?? []).filter((i) => !matchId || i.live_match_id === matchId);
  if (!list.length) return null;
  return (
    <>
      {list.map((i) => (
        <Link key={i.id} to={`/interviews/${i.id}`} className="interview-invite">
          <span className="interview-invite-icon" aria-hidden="true">🎙️</span>
          <span>
            <strong>Une interview t’attend</strong>
            <span className="interview-invite-sub">
              {i.result === 'win' ? 'Ta victoire' : 'Ton match'} contre {i.opponent}
            </span>
          </span>
          <span className="interview-invite-arrow" aria-hidden="true">→</span>
        </Link>
      ))}
    </>
  );
}
