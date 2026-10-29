// `require` des modules `shared/` pour les Edge Functions chargées dans un contexte vm.
import * as clubSlug from '../../shared/clubSlug.mjs';
export function sharedRequire(name) {
  if (name.endsWith('/shared/clubSlug.mjs')) return clubSlug;
  throw new Error(`Unexpected import: ${name}`);
}
