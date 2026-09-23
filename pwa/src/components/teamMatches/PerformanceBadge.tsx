export default function PerformanceBadge() {
  return <span
    className="badge-performance inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
    title="Perf : victoire contre un adversaire mieux classé"
    aria-label="Perf : victoire contre un adversaire mieux classé"
  >
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="m8 1 1.7 4.8L14.5 8l-4.8 1.7L8 15l-1.7-5.3L1.5 8l4.8-2.2L8 1Z" />
    </svg>
    Perf
  </span>;
}
