import { useSite } from '../../contexts/SiteContext';

/** Bande des chiffres clés — `home.stats`, masquable par `settings.show_stats`. */
export default function StatsSection() {
  const { config } = useSite();
  const stats = config.home.stats;
  if (!config.settings.show_stats || stats.length === 0) return null;

  return (
    <section className="shell relative z-10 -mt-10">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line shadow-soft md:grid-cols-4">
        {stats.map((stat, index) => (
          <div key={index} className="bg-card px-5 py-8 text-center">
            <div className="text-[32px] font-extrabold tracking-tight text-brand">{stat.value}</div>
            <div className="mt-1 text-[13.5px] font-semibold text-muted">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
