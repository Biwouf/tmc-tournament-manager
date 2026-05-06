import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../lib/pwa';

const DISMISS_KEY = 'cac:installPromptDismissedAt';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InstallVariant = 'android' | 'ios' | null;
type PromptResult = 'accepted' | 'dismissed' | 'unavailable';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  const isSafari = !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

function isRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function useInstallPrompt(): {
  variant: InstallVariant;
  promptInstall: () => Promise<PromptResult>;
  dismiss: () => void;
} {
  const [variant, setVariant] = useState<InstallVariant>(null);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isRecentlyDismissed()) return;
    if (isStandalone()) return;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setVariant('android');
    };

    const onAppInstalled = () => {
      deferredRef.current = null;
      setVariant(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    if (isIOSSafari()) {
      setVariant('ios');
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setVariant(null);
  };

  const promptInstall = async (): Promise<PromptResult> => {
    const ev = deferredRef.current;
    if (!ev) return 'unavailable';
    await ev.prompt();
    const choice = await ev.userChoice;
    deferredRef.current = null;
    if (choice.outcome === 'accepted') {
      setVariant(null);
      return 'accepted';
    }
    dismiss();
    return 'dismissed';
  };

  return { variant, promptInstall, dismiss };
}
