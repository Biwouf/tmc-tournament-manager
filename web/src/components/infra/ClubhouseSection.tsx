import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Club house — `infra.clubhouse.*` (titre, texte, et une liste d'images). */
export default function ClubhouseSection() {
  const { config } = useSite();
  const { clubhouse } = config.infra;
  const images = clubhouse.images.map(configImageUrl).filter((url): url is string => url !== null);
  if (!clubhouse.title && !clubhouse.text && images.length === 0) return null;

  return (
    <section className="shell section">
      <div className="grid items-center gap-10 md:grid-cols-2">
        <div>
          {clubhouse.title && <h2 className="title">{clubhouse.title}</h2>}
          {clubhouse.text && (
            <p className="lede mt-4 whitespace-pre-line">{clubhouse.text}</p>
          )}
        </div>
        {images.length > 0 && (
          <div className="grid gap-4">
            {images.map((url, index) => (
              <img
                key={index}
                src={url}
                alt=""
                className="aspect-[16/9] w-full rounded-card object-cover shadow-soft"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
