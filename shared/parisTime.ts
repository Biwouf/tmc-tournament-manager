// Saisie datetime-local en Europe/Paris, partagée par le back-office et la PWA.
export function parisInput(value: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
// Deux candidats explicites : les heures inexistantes donnent [], les ambiguës deux choix.
export function parisCandidates(value: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const utc = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(utc)) return [];
  return [2, 1]
    .map((offset) => new Date(utc - offset * 3600000).toISOString())
    .filter((candidate) => parisInput(candidate) === value);
}
