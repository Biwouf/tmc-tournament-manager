import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';

// Widget Cloudflare Turnstile (rendu explicite). Un jeton ne sert qu'une fois : le parent
// appelle `reset()` après chaque réponse de `club-signup` qui l'a consommé.
type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT; script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    script.onerror = () => { loading = null; reject(new Error('turnstile')); };
    document.head.appendChild(script);
  });
  return loading;
}

export type TurnstileHandle = { reset: () => void };

const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; onToken: (token: string | null) => void; onError: () => void }>(
  function Turnstile({ siteKey, onToken, onError }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const widget = useRef<string | null>(null);
    const callbacks = useRef({ onToken, onError });
    useLayoutEffect(() => { callbacks.current = { onToken, onError }; });
    useImperativeHandle(ref, () => ({
      reset: () => { callbacks.current.onToken(null); if (widget.current) window.turnstile?.reset(widget.current); },
    }), []);
    useEffect(() => {
      let active = true;
      loadTurnstile().then(api => {
        if (!active || !box.current) return;
        widget.current = api.render(box.current, {
          sitekey: siteKey, theme: 'dark', language: 'fr', action: 'club-signup',
          callback: (token: string) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => { callbacks.current.onToken(null); callbacks.current.onError(); },
        });
      }).catch(() => { if (active) callbacks.current.onError(); });
      return () => {
        active = false;
        callbacks.current.onToken(null);
        if (widget.current) window.turnstile?.remove(widget.current);
        widget.current = null;
      };
    }, [siteKey]);
    return <div ref={box} className="fl-turnstile" />;
  },
);
export default Turnstile;
