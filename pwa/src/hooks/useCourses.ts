import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useClub } from '../contexts/ClubContext';
import {
  courseError,
  courseRpc,
  type CourseContext,
  type CoursePage,
} from '../lib/courses';

export function useCourseContext() {
  const { clubId } = useClub();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['courses', clubId, user?.id, 'context'],
    enabled: Boolean(clubId && user),
    queryFn: () =>
      courseRpc<CourseContext>('course_my_context', { p_club: clubId }),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60000,
  });
}
export function useCourseNow(
  page?: Pick<CoursePage<unknown>, 'server_now' | 'received_at'>,
) {
  const [tick, setTick] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return page
    ? Date.parse(page.server_now) + Math.max(0, tick - page.received_at)
    : tick;
}
// Une clé par intention conservée après erreur ; jamais de mutation optimiste.
export function useCourseAction() {
  const client = useQueryClient();
  const locked = useRef(false);
  const previous = useRef({ fingerprint: '', key: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['courses'] });
  async function run(name: string, args: Record<string, unknown>) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    const fingerprint = JSON.stringify([name, args]);
    if (previous.current.fingerprint !== fingerprint)
      previous.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await courseRpc(name, { ...args, p_request_id: previous.current.key });
      previous.current = { fingerprint: '', key: '' };
      await refresh();
      return true;
    } catch (e) {
      setError(courseError(e));
      await refresh();
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error, refresh };
}
