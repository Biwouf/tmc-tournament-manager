import {
  normalizeTenupPoolUrl,
  validateTenupPool,
  type TenupPool,
} from './tenupPool.mjs';
export type TenupPoolPreview = TenupPool & { id: string; url: string };
interface Client {
  functions: {
    invoke: (
      name: string,
      options: { body: Record<string, unknown> }
    ) => Promise<{ data: unknown; error: unknown }>;
  };
}
export async function previewTenupPool(
  client: Client,
  clubId: string,
  competitionId: string,
  value: string
): Promise<TenupPoolPreview> {
  const url = normalizeTenupPoolUrl(value);
  const { data, error } = await client.functions.invoke('tenup-sync', {
    body: { kind: 'pool', club_id: clubId, competition_id: competitionId, url },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body =
      context instanceof Response
        ? await context.json().catch(() => null)
        : null;
    throw new Error(body?.error ?? 'Impossible de lire le calendrier Ten’Up.');
  }
  const result = data as TenupPoolPreview;
  validateTenupPool(result, url);
  return result;
}
/** Prefer configured names, then the club record, then the configured city.
 * A single candidate may be preselected; multiple teams remain distinct. */
export function suggestedTeamIds(
  pool: TenupPool,
  clubNames: string | string[],
  city = ''
): string[] {
  const words = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[a-z]+/g)
      ?.filter(
        (w) =>
          ![
            'tennis',
            'club',
            'tc',
            'de',
            'du',
            'le',
            'la',
            'des',
            'les',
          ].includes(w)
      ) ?? [];
  const candidates = (wanted: string[]) =>
    wanted.length
      ? pool.teams
          .filter((t) => wanted.every((w) => words(t.name).includes(w)))
          .map((t) => t.id)
      : [];
  for (const name of typeof clubNames === 'string' ? [clubNames] : clubNames) {
    const matches = candidates(words(name));
    if (matches.length) return matches;
  }
  return candidates(words(city));
}
