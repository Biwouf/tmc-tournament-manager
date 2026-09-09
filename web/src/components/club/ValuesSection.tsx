import { useSite } from '../../contexts/SiteContext';

/**
 * Valeurs du club — `club.values`, une liste de scalaires rendue en pastilles (maquette
 * 1755-1762) : bloc CENTRÉ, pastilles sur fond `--card` avec bordure et ombre, et non sur
 * l'aplat `--brand-soft` de la première version. Le fond blanc n'a rien demandé de neuf :
 * `--card: #ffffff` existe déjà dans `index.css` et sort en `bg-card`.
 *
 * Pas d'élévation au survol ici : ce sont des étiquettes, pas des cartes (brief PR9-bis §3).
 */
export default function ValuesSection() {
  const { config } = useSite();
  const values = config.club.values;
  if (values.length === 0) return null;

  return (
    <section className="shell section [--sec-top:70px]">
      <h2 className="text-center text-[clamp(24px,3.4vw,34px)] font-extrabold tracking-tight">
        Nos valeurs
      </h2>
      <div className="mt-[30px] flex flex-wrap justify-center gap-3.5">
        {values.map((value, index) => (
          <span
            key={index}
            className="rounded-full border border-line bg-card px-[26px] py-[13px] text-[16px] font-bold shadow-soft"
          >
            {value}
          </span>
        ))}
      </div>
    </section>
  );
}
