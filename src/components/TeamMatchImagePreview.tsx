import type { TeamMatch, TeamMatchType } from '../types';

const POSTER_W = 1414;
const POSTER_H = 2000;
const CONTENT_TOP = 245;
const CONTENT_BOTTOM = 1780;
const CONTENT_PAD_X = 70;

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

function formatMatchDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${JOURS[dt.getDay()]} ${d} ${MOIS[m - 1]}`;
}

function formatMatchTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  return m === '00' ? `${parseInt(h, 10)}h` : `${parseInt(h, 10)}h${m}`;
}

function TeamMatchCell({ match, cellH }: { match: TeamMatch; cellH: number }) {
  return (
    <div style={{
      background: 'white',
      borderLeft: '14px solid #c8102e',
      display: 'grid',
      gridTemplateColumns: '160px 1fr 220px',
      alignItems: 'stretch',
      minHeight: cellH,
      fontFamily: "'Prompt', sans-serif",
      overflow: 'hidden',
      boxShadow: '0 8px 0 rgba(0,0,0,0.08)',
    }}>
      <div style={{
        background: '#fff5f6',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '14px 10px',
        borderRight: '1px dashed #f5c8cf',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: "'Prompt', sans-serif",
          fontSize: 32, fontWeight: 800, color: '#c8102e',
          lineHeight: 1.02, letterSpacing: -0.4,
          textTransform: 'uppercase',
        }}>
          {formatMatchDate(match.date)}
        </div>
        <div style={{
          marginTop: 8,
          fontFamily: "'Arial Black', Impact, sans-serif",
          fontSize: 22, fontWeight: 900, color: '#1a1416',
          lineHeight: 1, letterSpacing: -0.4,
        }}>
          {formatMatchTime(match.time)}
        </div>
      </div>

      <div style={{
        padding: '16px 28px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        minWidth: 0,
      }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: '#c8102e',
          letterSpacing: 2, textTransform: 'uppercase',
        }}>
          {match.gender} {SHORT_TYPE[match.matchType]} · Équipe {match.teamNumber}
        </div>
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 16, minWidth: 0 }}>
          <span style={{
            fontFamily: "'Arial Black', sans-serif",
            fontStyle: 'italic',
            fontSize: 30, fontWeight: 900, color: '#1a1416',
            opacity: 0.18, letterSpacing: -1,
          }}>VS</span>
          <span style={{
            fontSize: 32, fontWeight: 700, color: '#1a1416',
            letterSpacing: -0.4, lineHeight: 1.05,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1,
          }}>
            {match.opponent || '—'}
          </span>
        </div>
      </div>

      <div style={{
        background: match.location === 'home' ? '#c8102e' : '#1a1416',
        color: 'white',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '12px 16px',
      }}>
        <div style={{ fontSize: 38, lineHeight: 1 }}>
          {match.location === 'home' ? '🏠' : '✈'}
        </div>
        <div style={{
          marginTop: 6, fontSize: 14, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: 1.8,
        }}>
          {match.location === 'home' ? 'Au club' : 'Déplacement'}
        </div>
      </div>
    </div>
  );
}

function MatchList({ matches }: { matches: TeamMatch[] }) {
  const availH = CONTENT_BOTTOM - CONTENT_TOP - 40;
  const minH = 130;
  const maxH = 200;
  const gap = matches.length <= 3 ? 28 : matches.length <= 5 ? 22 : 18;
  const totalGaps = gap * Math.max(0, matches.length - 1);
  const cellH = Math.min(
    maxH,
    Math.max(minH, Math.floor((availH - totalGaps) / Math.max(1, matches.length)))
  );

  return (
    <div style={{
      position: 'absolute',
      top: CONTENT_TOP,
      bottom: POSTER_H - CONTENT_BOTTOM,
      left: CONTENT_PAD_X,
      right: CONTENT_PAD_X,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: matches.length <= 3 ? 'center' : 'flex-start',
      gap,
      zIndex: 2,
    }}>
      {matches.map((match) => (
        <TeamMatchCell key={match.id} match={match} cellH={cellH} />
      ))}
    </div>
  );
}

interface TeamMatchImagePreviewProps {
  matches: TeamMatch[];
}

export default function TeamMatchImagePreview({ matches }: TeamMatchImagePreviewProps) {
  return (
    <div style={{
      position: 'relative',
      width: POSTER_W,
      height: POSTER_H,
      background: '#c8102e',
      fontFamily: "'Prompt', sans-serif",
      overflow: 'hidden',
    }}>
      <img
        src="/template_event.png"
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      <MatchList matches={matches} />
    </div>
  );
}
