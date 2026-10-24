// Ligne de la liste « Notifications » de Mon profil : titre, sous-titre court, interrupteur à droite.
export default function PushSwitchRow({ title, description, checked, disabled, onToggle, error }: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  error?: string;
}) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={title}
          disabled={disabled}
          onClick={onToggle}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-end disabled:opacity-50"
        >
          {/* Rond à gauche quand c'est coupé, à droite quand c'est activé, toujours dans la piste. */}
          <span className={`relative block h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
            <span className={`absolute left-0.5 top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </li>
  );
}
