// Bandeau partenaires des affiches DOM (programmation TMC, rencontres à venir), posé en
// absolu dans le bas de l'affiche. Reçoit les logos déjà tirés (`drawPosterPartners`) :
// 2 rangées de 5 au plus. Le fond ne doit donc plus porter de logos.
// Les dimensions viennent de chaque affiche, qui n'a pas la même taille.
const PARTNERS_PER_ROW = 5;

interface PosterPartnersBandProps {
  logos: string[];
  left: number;
  right: number;
  bottom: number;
  rowHeight: number;
  rowGap: number;
  /** Marge horizontale de chaque case logo. */
  padX: number;
}

export default function PosterPartnersBand({ logos, left, right, bottom, rowHeight, rowGap, padX }: PosterPartnersBandProps) {
  // 6 logos → 3 + 3 plutôt que 5 + 1.
  const perRow = logos.length <= PARTNERS_PER_ROW ? logos.length : Math.ceil(logos.length / 2);
  const rows = [logos.slice(0, perRow), logos.slice(perRow)].filter((row) => row.length > 0);
  return (
    <div
      style={{
        position: 'absolute',
        left,
        right,
        bottom,
        display: 'flex',
        flexDirection: 'column',
        gap: rowGap,
      }}
    >
      {rows.map((row, r) => (
        <div key={r} style={{ display: 'flex', justifyContent: 'center', height: rowHeight }}>
          {row.map((logo, i) => (
            <div key={i} style={{ width: `${100 / PARTNERS_PER_ROW}%`, padding: `0 ${padX}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* `crossOrigin` : même raison que le fond — logo servi par le Storage. */}
              <img src={logo} alt="" crossOrigin="anonymous" style={{ maxWidth: '100%', maxHeight: rowHeight, objectFit: 'contain' }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
