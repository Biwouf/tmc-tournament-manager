// Message d'erreur montré à l'utilisateur (brief UX PWA, PR3, 15/11/2026) : jamais l'anglais
// brut de Supabase, de PostgREST ou du navigateur (« Failed to fetch », « JWT expired »,
// « new row violates row-level security policy »…).
//
// Les fonctions SQL du projet lèvent des messages FRANÇAIS faits pour l'écran (« Match
// introuvable. », « Connectez-vous pour participer. ») et les modules `lib/` aussi : ceux-là
// sont gardés. Un message reconnu comme technique ou anglais cède la place au repli.

const OFFLINE = 'Connexion impossible. Vérifiez votre connexion internet puis réessayez.';

// Mots d'un message technique en anglais. « invalide », « introuvable » ne matchent pas.
const ENGLISH = /\b(?:the|is|are|was|of|to|for|with|failed|failure|error|invalid|not|denied|violates|expired|aborted|timeout|timed|network|fetch|load|row|key|value|column|relation|function|request|unexpected|cannot|could|unable|unknown|missing|required|already)\b/i;

/** Vrai si le texte peut être montré tel quel : du français, pas un message technique. */
export function isUserFacing(message: string | null | undefined): message is string {
  const text = message?.trim();
  if (!text) return false;
  // Codes en capitales (« SECTION_FULL », « CLUB_UNAVAILABLE ») : à traduire par l'appelant.
  if (/^[A-Z0-9_]+$/.test(text)) return false;
  return !ENGLISH.test(text);
}

/** Texte à afficher pour une erreur quelconque, avec un repli français. */
export function uiMessage(error: unknown, fallback: string): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE;
  // fetch rejeté (« Failed to fetch », « Load failed ») ou délai dépassé : problème de réseau.
  if (error instanceof TypeError) return OFFLINE;
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) return OFFLINE;
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '';
  return isUserFacing(message) ? message : fallback;
}
