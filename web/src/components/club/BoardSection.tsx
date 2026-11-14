import ConfigImage from '../ConfigImage';
import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';
import { focalPointStyle } from '../../lib/focalPoint';
import { initials } from '../../lib/initials';

/**
 * Bureau du club — `club.board` (maquette 1813-1823).
 *
 * Chaque membre est un CARRÉ (`aspect-ratio:1`, `--radius`, bordure + ombre), pas un médaillon
 * rond : c'est la forme de la maquette. `photo` est optionnel au contrat, et une entrée sans
 * photo cassait la grille ; elle rend désormais ses initiales sur `--bg2`, seul placeholder
 * toléré de la vitrine et uniquement parce que le reste de l'entrée, lui, est renseigné.
 */
export default function BoardSection() {
  const { config } = useSite();
  const board = config.club.board;
  if (board.length === 0) return null;

  return (
    <section className="shell section [--sec-top:84px]">
      <h2 className="title">Le bureau du club</h2>
      <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[22px]">
        {board.map((member, index) => {
          const photo = configImageUrl(member.photo);
          const short = initials(member.name);
          return (
            <div key={index} className="card-lift text-center">
              {photo ? (
                <ConfigImage loading="lazy" decoding="async"
                  src={photo}
                  alt={member.name}
                  className="aspect-square w-full rounded-card border border-line object-cover shadow-soft"
                  style={focalPointStyle(member.photo_focal)}
                />
              ) : (
                short && (
                  <div
                    aria-hidden
                    className="flex aspect-square w-full items-center justify-center rounded-card border border-line bg-bg2 text-[clamp(24px,5vw,36px)] font-extrabold text-muted shadow-soft"
                  >
                    {short}
                  </div>
                )
              )}
              <div className="mt-[13px] text-[16px] font-extrabold">{member.name}</div>
              {member.role && (
                <div className="text-[13.5px] font-semibold text-muted">{member.role}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
