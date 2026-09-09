import ConfigImage from '../ConfigImage';
import { Link } from 'react-router-dom';
import { useSite } from '../../contexts/SiteContext';
import { useContactDrawer } from '../../contexts/ContactDrawerContext';
import { isPublished, PAGES } from '../../lib/site';
import { configImageUrl } from '../../lib/configImage';

/** Hero de l'accueil — titre réel, ou nom du club en l'absence de titre. */
export default function HeroSection() {
  const { config, clubName } = useSite();
  const { openDrawer } = useContactDrawer();
  const { home } = config;
  const image = configImageUrl(home.hero_image);

  // Sans image de fond, le hero reste lisible sur le fond secondaire : on ne pose pas un
  // voile sombre sur du vide, et le texte garde l'encre du thème.
  const onImage = Boolean(image);

  return (
    <section className={`home-hero relative ${onImage ? 'text-white' : 'bg-bg2 text-text'}`}>
      {image && (
        <>
          <ConfigImage sizes="100vw" fetchPriority="high" loading="eager" decoding="async" src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-black/20" />
        </>
      )}
      <div className="shell relative flex min-h-[62vh] flex-col justify-end py-16 sm:py-24">
        {home.hero_eyebrow && (
          <span className="mb-5 inline-flex w-fit items-center rounded-full bg-brand px-4 py-2 text-[13px] font-bold tracking-[0.14em] text-white uppercase">
            {home.hero_eyebrow}
          </span>
        )}
        <h1 className="max-w-3xl text-[clamp(32px,5.5vw,56px)] leading-[1.08] font-extrabold tracking-tight">
            {home.hero_title || clubName}
        </h1>
        {home.hero_subtitle && (
          <p
            className={`mt-5 max-w-2xl text-[17px] leading-relaxed ${onImage ? 'text-white/85' : 'text-muted'}`}
          >
            {home.hero_subtitle}
          </p>
        )}
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={openDrawer} className="btn btn-primary">
            Nous contacter
          </button>
          {isPublished(config, PAGES[1]) && <Link reloadDocument
            to="/club"
            className={`btn ${onImage ? 'btn-hero-secondary' : 'btn-outline'}`}
          >
            Découvrir le club
          </Link>}
        </div>
      </div>
    </section>
  );
}
