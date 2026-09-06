import { useSite } from '../../contexts/SiteContext';
import { configImageUrl } from '../../lib/configImage';

/** Bureau du club — `club.board`. */
export default function BoardSection() {
  const { config } = useSite();
  const board = config.club.board;
  if (board.length === 0) return null;

  return (
    <section className="shell section">
      <h2 className="title">Le bureau du club</h2>
      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {board.map((member, index) => {
          const photo = configImageUrl(member.photo);
          return (
            <div key={index} className="text-center">
              {photo && (
                <img
                  src={photo}
                  alt={member.name}
                  className="mx-auto aspect-square w-full max-w-40 rounded-full object-cover"
                />
              )}
              <div className="mt-3 font-extrabold">{member.name}</div>
              {member.role && <div className="text-sm text-muted">{member.role}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
