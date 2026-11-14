import { useState, type FormEvent } from 'react';
import PasswordInput from '../PasswordInput';
import { supabase } from '../../lib/supabase';
import { passwordProblem, passwordUpdateError } from '../../lib/dashboardChecklist';
import Modal from './Modal';

const INPUT = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring';

// SaaS S8 — « Choisir un mot de passe » (promis par S4 aux comptes nés du tunnel). Le succès
// pose `password_set` dans `user_metadata` dans le même appel : c'est ce que lit la checklist.
export default function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    setError(problem);
    if (problem) return;
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password, data: { password_set: true } });
    setBusy(false);
    if (updateError) { setError(passwordUpdateError(updateError)); return; }
    onDone();
  };

  return (
    <Modal title="Choisir un mot de passe" onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        Facultatif : vous pourrez toujours vous connecter par un lien reçu par e-mail.
      </p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div>
          <label htmlFor="checklist-password" className="mb-1.5 block text-sm font-medium">Nouveau mot de passe</label>
          <PasswordInput id="checklist-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} minLength={6} autoComplete="new-password" />
        </div>
        <div>
          <label htmlFor="checklist-password-confirm" className="mb-1.5 block text-sm font-medium">Confirmer le mot de passe</label>
          <PasswordInput id="checklist-password-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={INPUT} minLength={6} autoComplete="new-password" />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition hover:bg-muted">Annuler</button>
          <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60">
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
