import { forwardRef, useState, type ClipboardEvent } from 'react';
import { cleanCode } from '../lib/emailCode';

// Onboarding P2 (brief SAAS_11 §3.4) — champ « Code à 6 chiffres » : UN SEUL `<input>` (saisie
// automatique iOS / Android depuis Mail avec `autocomplete="one-time-code"`, lecteurs d'écran),
// transparent, posé sur 6 cases décoratives. Collage accepté (« 481 902 ») ; le 6ᵉ chiffre appelle
// `onComplete`. Les cases se stylent par `boxClassName` (`data-active`, `data-filled`).

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Le 6ᵉ chiffre vient d'arriver (saisie ou collage) : envoi automatique. */
  onComplete: (code: string) => void;
  /** Vérification en cours : la frappe est ignorée. Ni `disabled` ni `readOnly` : le champ perdrait
   *  le focus, ou le clavier du téléphone se fermerait, à chaque erreur. */
  busy?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  boxClassName?: string;
};

const OtpCodeInput = forwardRef<HTMLInputElement, Props>(function OtpCodeInput(
  { id, value, onChange, onComplete, busy, invalid, describedBy, className, boxClassName }, ref,
) {
  const [focused, setFocused] = useState(false);
  const set = (raw: string) => {
    if (busy) return;
    const next = cleanCode(raw);
    onChange(next);
    if (next.length === 6 && value.length !== 6) onComplete(next);
  };
  // `maxLength` couperait « 481 902 » à « 481 90 » : le collage est lu en entier puis nettoyé.
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData?.getData('text');
    if (!text) return;
    event.preventDefault();
    set(text);
  };
  const active = Math.min(value.length, 5);
  return (
    <div className={className} style={{ position: 'relative' }}>
      <input ref={ref} id={id} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
        spellCheck={false} value={value} aria-busy={busy || undefined} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onChange={event => set(event.target.value)} onPaste={paste}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, border: 0, padding: 0, margin: 0, fontSize: 16, caretColor: 'transparent', zIndex: 1 }} />
      <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={boxClassName} data-filled={i < value.length || undefined}
            data-active={(focused && i === active && !busy) || undefined} data-invalid={invalid || undefined}>
            {value[i] ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
});

export default OtpCodeInput;
