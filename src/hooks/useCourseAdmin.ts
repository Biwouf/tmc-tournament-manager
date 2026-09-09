import { useCallback, useRef, useState } from "react";
import { courseCommand, courseError } from "../lib/courses";
// Même requête après erreur réseau => même clé. Aucun succès optimiste.
export function useCourseAdmin(clubId: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const last = useRef<{ payload: string; id: string } | null>(null);
  const run = useCallback(
    async (operation: string, data: Record<string, unknown>) => {
      if (!clubId || active.current) return null;
      const payload = JSON.stringify([clubId, operation, data]);
      if (last.current?.payload !== payload)
        last.current = { payload, id: crypto.randomUUID() };
      active.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await courseCommand(
          clubId,
          operation,
          data,
          last.current.id,
        );
        last.current = null;
        return result;
      } catch (e) {
        setError(courseError(e));
        return null;
      } finally {
        active.current = false;
        setBusy(false);
      }
    },
    [clubId],
  );
  return { run, busy, error, setError };
}
