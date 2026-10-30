// Vitrine — dérivation de l'accent depuis `brand.color` (web_site_brief.md §4).
//
// Le calcul vit dans `shared/brandTokens.mjs` (SaaS S3) : l'aperçu du tunnel d'inscription du
// BO l'importe aussi, pour montrer exactement les fonds et les textes que la vitrine posera.
// Ce module le réexpose sous ses noms d'origine et garde la pose sur `<html>`.
import { brandTokens } from '../../../shared/brandTokens.mjs';

export { BRAND_FALLBACK, brandTokens } from '../../../shared/brandTokens.mjs';

/** Pose les tokens de marque sur `<html>`. */
export function applyBrandTokens(root: HTMLElement, color: string | undefined): void {
  for (const [name, value] of Object.entries(brandTokens(color))) {
    root.style.setProperty(name, value);
  }
}
