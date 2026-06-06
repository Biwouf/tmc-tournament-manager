import type { TeamMatch, TeamMatchType } from '../types';

const POSTER_W = 1414;
const POSTER_H = 2000;
const CONTENT_TOP = 245;
const CONTENT_BOTTOM = 1780;
const CONTENT_PAD_X = 60;

const SHORT_TYPE: Record<TeamMatchType, string> = {
  'Seniors':          'Seniors',
  'Seniors +35':      'Seniors +35',
  'Jeunes 15/16 ans': '15/16 ans',
  'Jeunes 13/14 ans': '13/14 ans',
  'Jeunes 11/12 ans': '11/12 ans',
};

const JOURS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const MOIS  = ['janvier','février','mars','avril','mai','juin',
               'juillet','août','septembre','octobre','novembre','décembre'];

function formatMatchDate(iso: string): { day: string; num: string; month: string } {
  if (!iso) return { day: '', num: '—', month: '' };
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return { day: JOURS[dt.getDay()], num: String(d), month: MOIS[m - 1] };
}

function formatMatchTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  return m === '00' ? `${parseInt(h, 10)}h` : `${parseInt(h, 10)}h${m}`;
}

type SizeClass = 'hero' | 'normal' | 'compact';

function sizeClassFor(count: number): SizeClass {
  if (count === 1) return 'hero';
  if (count >= 5) return 'compact';
  return 'normal';
}

const POSTER_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Prompt:wght@400;700;800&display=swap');

.tmc-poster .va-cell {
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 10px 0 rgba(0,0,0,0.08);
  display: grid;
  grid-template-columns: 240px 1fr 300px;
  align-items: stretch;
  font-family: 'Prompt', sans-serif;
}

/* Date */
.tmc-poster .va-date {
  background: #fff5f6;
  border-right: 2px dashed #f5c8cf;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 28px 22px;
  text-align: center;
  gap: 8px;
}
.tmc-poster .va-date .day   { font-size: 38px; font-weight: 800; color: #c8102e; line-height: 1;
                  letter-spacing: -0.5px; text-transform: uppercase; }
.tmc-poster .va-date .num   { font-family: 'Anton', 'Arial Black', sans-serif;
                  font-size: 86px; line-height: 0.95; color: #1a1416; letter-spacing: -1px; }
.tmc-poster .va-date .month { font-size: 26px; font-weight: 700; color: #1a1416;
                  text-transform: uppercase; letter-spacing: 1px; line-height: 1; }
.tmc-poster .va-date .time  { margin-top: 10px; font-size: 24px; font-weight: 700; color: #c8102e;
                  background: #fff; border: 2px solid #c8102e;
                  padding: 4px 14px; border-radius: 999px; letter-spacing: 0.5px; }

/* Corps */
.tmc-poster .va-body {
  padding: 28px 36px;
  display: flex; flex-direction: column; justify-content: center;
  gap: 10px; min-width: 0;
}
.tmc-poster .va-body .category {
  font-size: 38px; font-weight: 800; color: #1a1416;
  letter-spacing: -0.4px; line-height: 1;
}
.tmc-poster .va-body .team-no {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 18px; font-weight: 700; color: #c8102e;
  letter-spacing: 2.5px; text-transform: uppercase;
}
.tmc-poster .va-body .team-no::before {
  content: ''; width: 28px; height: 3px;
  background: #c8102e; border-radius: 2px;
}
.tmc-poster .va-body .vs-line {
  display: flex; align-items: baseline; gap: 20px;
  min-width: 0; margin-top: 6px;
}
.tmc-poster .va-body .vs-line .vs {
  font-family: 'Anton', 'Arial Black', sans-serif; font-style: italic;
  font-size: 50px; color: #1a1416; opacity: 0.18;
  letter-spacing: -1px; line-height: 1;
}
.tmc-poster .va-body .vs-line .opp {
  font-size: 42px; font-weight: 700; color: #1a1416;
  letter-spacing: -0.5px; line-height: 1.05; flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Lieu */
.tmc-poster .va-loc {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 18px; color: #fff; text-align: center; gap: 14px;
}
.tmc-poster .va-loc.home { background: #c8102e; }
.tmc-poster .va-loc.away { background: #1a1416; }
.tmc-poster .va-loc .icon  { font-size: 90px; line-height: 1; }
.tmc-poster .va-loc .label { font-size: 34px; font-weight: 800;
                 text-transform: uppercase; letter-spacing: 3px; line-height: 1; }

/* Mode hero */
.tmc-poster .va-cell.hero {
  grid-template-columns: 280px 1fr 340px;
  min-height: 520px;
  align-self: center;
  width: 100%;
}
.tmc-poster .va-cell.hero .va-date  { padding: 36px 22px; gap: 12px; }
.tmc-poster .va-cell.hero .va-date .num   { font-size: 120px; }
.tmc-poster .va-cell.hero .va-date .day   { font-size: 44px; }
.tmc-poster .va-cell.hero .va-date .month { font-size: 32px; }
.tmc-poster .va-cell.hero .va-date .time  { font-size: 32px; padding: 6px 22px; margin-top: 14px; }

.tmc-poster .va-cell.hero .va-body { padding: 40px 48px; gap: 16px; justify-content: center; }
.tmc-poster .va-cell.hero .va-body .category { font-size: 52px; line-height: 1; }
.tmc-poster .va-cell.hero .va-body .team-no  { font-size: 24px; letter-spacing: 3px; }
.tmc-poster .va-cell.hero .va-body .team-no::before { width: 40px; height: 4px; }
.tmc-poster .va-cell.hero .va-body .vs-line { margin-top: 14px; align-items: baseline; }
.tmc-poster .va-cell.hero .va-body .vs-line .vs  { font-size: 80px; line-height: 0.9; }
.tmc-poster .va-cell.hero .va-body .vs-line .opp {
  font-size: 60px; white-space: normal; line-height: 1; text-wrap: balance;
}

.tmc-poster .va-cell.hero .va-loc        { padding: 28px 18px; gap: 20px; }
.tmc-poster .va-cell.hero .va-loc .icon  { font-size: 130px; }
.tmc-poster .va-cell.hero .va-loc .label { font-size: 48px; letter-spacing: 4px; }

/* Mode compact */
.tmc-poster .va-cell.compact { grid-template-columns: 200px 1fr 240px; }
.tmc-poster .va-cell.compact .va-date { padding: 16px; }
.tmc-poster .va-cell.compact .va-date .num   { font-size: 64px; }
.tmc-poster .va-cell.compact .va-date .day   { font-size: 28px; }
.tmc-poster .va-cell.compact .va-date .month { font-size: 20px; }
.tmc-poster .va-cell.compact .va-date .time  { font-size: 18px; padding: 3px 12px; }

.tmc-poster .va-cell.compact .va-body { padding: 16px 24px; gap: 6px; }
.tmc-poster .va-cell.compact .va-body .category { font-size: 28px; }
.tmc-poster .va-cell.compact .va-body .team-no  { font-size: 14px; letter-spacing: 2px; }
.tmc-poster .va-cell.compact .va-body .team-no::before { width: 20px; height: 2px; }
.tmc-poster .va-cell.compact .va-body .vs-line  { gap: 12px; margin-top: 2px; }
.tmc-poster .va-cell.compact .va-body .vs-line .vs  { font-size: 36px; }
.tmc-poster .va-cell.compact .va-body .vs-line .opp { font-size: 30px; }

.tmc-poster .va-cell.compact .va-loc       { gap: 8px; }
.tmc-poster .va-cell.compact .va-loc .icon  { font-size: 56px; }
.tmc-poster .va-cell.compact .va-loc .label { font-size: 22px; letter-spacing: 2px; }

/* Placeholder */
.tmc-poster .va-empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; text-align: center;
  font-family: 'Prompt', sans-serif;
  font-size: 40px; font-weight: 700; color: #fff;
}
`;

function MatchCell({ match, size }: { match: TeamMatch; size: SizeClass }) {
  const isHome = match.location === 'home';
  const { day, num, month } = formatMatchDate(match.date);
  return (
    <div className={`va-cell ${size === 'normal' ? '' : size}`}
         style={size !== 'hero' ? { flex: 1 } : undefined}>
      <div className="va-date">
        <div className="day">{day}</div>
        <div className="num">{num}</div>
        <div className="month">{month}</div>
        <div className="time">{formatMatchTime(match.time)}</div>
      </div>
      <div className="va-body">
        <div className="category">{match.gender} · {SHORT_TYPE[match.matchType]}</div>
        <div className="team-no">Équipe {match.teamNumber}</div>
        <div className="vs-line">
          <span className="vs">vs</span>
          <span className="opp">{match.opponent || '—'}</span>
        </div>
      </div>
      <div className={`va-loc ${isHome ? 'home' : 'away'}`}>
        <div className="icon">{isHome ? '🏠' : '✈️'}</div>
        <div className="label">{isHome ? 'Au club' : 'Déplacement'}</div>
      </div>
    </div>
  );
}

interface TeamMatchImagePreviewProps {
  matches: TeamMatch[];
}

export default function TeamMatchImagePreview({ matches }: TeamMatchImagePreviewProps) {
  const size = sizeClassFor(matches.length);
  const gap = size === 'hero' ? 0 : size === 'compact' ? 22 : 32;
  const justify =
    size === 'hero' ? 'center'
    : size === 'compact' ? 'space-between' : 'space-around';

  return (
    <div className="tmc-poster" style={{
      position: 'relative',
      width: POSTER_W, height: POSTER_H,
      background: '#c8102e', overflow: 'hidden',
      fontFamily: "'Prompt', sans-serif",
    }}>
      <style>{POSTER_STYLES}</style>
      <img src="/template_event.png" alt=""
           style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div style={{
        position: 'absolute',
        top: CONTENT_TOP, bottom: POSTER_H - CONTENT_BOTTOM,
        left: CONTENT_PAD_X, right: CONTENT_PAD_X,
        display: 'flex', flexDirection: 'column',
        justifyContent: justify, gap, zIndex: 2,
      }}>
        {matches.length === 0
          ? <div className="va-empty">Ajoutez une rencontre…</div>
          : matches.map(m => <MatchCell key={m.id} match={m} size={size} />)}
      </div>
    </div>
  );
}
