import { useNavigate } from 'react-router-dom';
import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Teaser école — `home.school_teaser_*`. Le bloc image disparaît seul si aucune image. */
export default function SchoolTeaserSection() {
  const { config } = useSite();
  const navigate = useNavigate();
  const { home } = config;
  const image = configImageUrl(home.school_teaser_image);

  const hasContent =
    home.school_teaser_eyebrow ||
    home.school_teaser_title ||
    home.school_teaser_text ||
    home.school_teaser_cta ||
    image;
  if (!hasContent) return null;

  return (
    <section className="shell section">
      <div className="grid overflow-hidden rounded-card border border-line shadow-soft md:grid-cols-2">
        <div className="bg-brand p-8 text-white sm:p-12">
          {home.school_teaser_eyebrow && (
            <span className="text-[13px] font-bold tracking-[0.14em] uppercase">
              {home.school_teaser_eyebrow}
            </span>
          )}
          {home.school_teaser_title && (
            <h2 className="mt-3 text-[clamp(24px,3.2vw,34px)] leading-tight font-extrabold">
              {home.school_teaser_title}
            </h2>
          )}
          {home.school_teaser_text && (
            <p className="mt-4 leading-relaxed text-white/85">{home.school_teaser_text}</p>
          )}
          {home.school_teaser_cta && (
            <button
              type="button"
              onClick={() => navigate('/tarifs')}
              className="btn btn-light mt-7"
            >
              {home.school_teaser_cta}
            </button>
          )}
        </div>
        {image && <img src={image} alt="" className="h-full min-h-64 w-full object-cover" />}
      </div>
    </section>
  );
}
