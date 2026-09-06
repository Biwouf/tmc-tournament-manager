import { useNavigate } from 'react-router-dom';
import { useSite } from '../../contexts/SiteContext';
import { useContactDrawer } from '../../contexts/ContactDrawerContext';
import { configImageUrl } from '../../lib/configImage';

/** Hero de l'accueil — `home.hero_*`. Absent en entier si rien n'est saisi. */
export default function HeroSection() {
  const { config } = useSite();
  const { openDrawer } = useContactDrawer();
  const navigate = useNavigate();
  const { home } = config;
  const image = configImageUrl(home.hero_image);

  const hasContent =
    image ||
    home.hero_eyebrow ||
    home.hero_title ||
    home.hero_subtitle ||
    home.hero_cta_primary ||
    home.hero_cta_secondary;
  if (!hasContent) return null;

  // Sans image de fond, le hero reste lisible sur le fond secondaire : on ne pose pas un
  // voile sombre sur du vide, et le texte garde l'encre du thème.
  const onImage = Boolean(image);

  return (
    <section className={`relative ${onImage ? 'text-white' : 'bg-bg2 text-text'}`}>
      {image && (
        <>
          <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-black/20" />
        </>
      )}
      <div className="shell relative flex min-h-[62vh] flex-col justify-end py-16 sm:py-24">
        {home.hero_eyebrow && (
          <span className="mb-5 inline-flex w-fit items-center rounded-full bg-brand px-4 py-2 text-[13px] font-bold tracking-[0.14em] text-white uppercase">
            {home.hero_eyebrow}
          </span>
        )}
        {home.hero_title && (
          <h1 className="max-w-3xl text-[clamp(32px,5.5vw,56px)] leading-[1.08] font-extrabold tracking-tight">
            {home.hero_title}
          </h1>
        )}
        {home.hero_subtitle && (
          <p
            className={`mt-5 max-w-2xl text-[17px] leading-relaxed ${onImage ? 'text-white/85' : 'text-muted'}`}
          >
            {home.hero_subtitle}
          </p>
        )}
        {(home.hero_cta_primary || home.hero_cta_secondary) && (
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {home.hero_cta_primary && (
              <button type="button" onClick={openDrawer} className="btn btn-primary">
                {home.hero_cta_primary}
              </button>
            )}
            {home.hero_cta_secondary && (
              <button
                type="button"
                onClick={() => navigate('/club')}
                className={`btn ${onImage ? 'btn-light' : 'btn-outline'}`}
              >
                {home.hero_cta_secondary}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
