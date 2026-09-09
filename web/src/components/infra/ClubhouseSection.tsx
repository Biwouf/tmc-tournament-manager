import ConfigImage from '../ConfigImage';
import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Club house — `infra.clubhouse.*` (titre, texte, et une liste d'images). */
export default function ClubhouseSection() {
  const { config } = useSite();
  const { clubhouse } = config.infra;
  const images = clubhouse.images.map(configImageUrl).filter((url): url is string => url !== null);
  if (!clubhouse.title && !clubhouse.text && images.length === 0) return null;

  return (
    <section className="shell section [--sec-top:74px]">
      <div className="grid items-center gap-10 md:grid-cols-2">
        <div>
          {clubhouse.title && <h2 className="title">{clubhouse.title}</h2>}
          {clubhouse.text && (
            <p className="lede mt-4 whitespace-pre-line">{clubhouse.text}</p>
          )}
        </div>
        {images.length > 0 && (
          /* Maquette 1860-1862 : DANS la moitié droite, une seconde grille à deux colonnes.
             Les images sont donc des carrés d'un quart de la largeur du contenu, et non des
             visuels pleine largeur. Une seule image occupe sa colonne, pas toute la moitié. */
          <div className="grid grid-cols-2 gap-[14px]">
            {images.map((url, index) => (
              <ConfigImage loading="lazy" decoding="async"
                key={index}
                src={url}
                alt={clubhouse.title || 'Club house'}
                /* Décalage volontaire d'une colonne sur deux (maquette : `margin-top:24px`
                   sur la 2ᵉ image). L'alternance se poursuit au-delà de deux images. */
                className={`aspect-square w-full rounded-soft object-cover shadow-soft ${
                  index % 2 === 1 ? 'mt-6' : ''
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
