import { useCourseContext } from '../hooks/useCourses';
import { useAuth } from '../hooks/useAuth';
export default function SignupNotice() {
  const { user } = useAuth();
  const context = useCourseContext();
  const status = context.data?.signup_status;
  if (!user || context.data?.is_member || !status) return null;
  return <aside role="status" className="mx-4 my-3 rounded-lg border border-border bg-card p-4 text-sm text-foreground">
    <p>{status === 'pending' ? 'Votre demande est en attente de validation par le club. Les services membres seront accessibles après acceptation.' : status === 'denied' ? 'Votre demande a été refusée. Contactez le club pour toute question.' : 'Votre accès membre a été retiré. Contactez le club pour toute question.'}</p>
    <button type="button" className="min-h-11 text-primary underline" disabled={context.isFetching} onClick={() => void context.refetch()}>Actualiser mon statut</button>
  </aside>;
}
