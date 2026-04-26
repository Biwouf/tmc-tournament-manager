// Badge animé "LIVE" — affiché sur les matchs en cours.
// Animation pulse définie dans index.css (.badge-live).

export default function LiveBadge() {
  return (
    <span className="badge-live inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />
      Live
    </span>
  );
}
