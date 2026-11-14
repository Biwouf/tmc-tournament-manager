import { useState } from 'react';

/** « Copier le lien » : l'état dit si la copie a eu lieu (sinon, l'adresse reste à sélectionner). */
export function useCopy() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      return true;
    } catch {
      setState('failed');
      return false;
    }
  };
  return { state, copy };
}
