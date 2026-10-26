import { forwardRef } from 'react';
import type { TeamCalendar } from './teamCalendar';

/** `#e51828` → `rgba(229, 24, 40, a)` ; toute autre valeur est rendue telle quelle. */
function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const DATE_COL_W = 128;
const TEAM_COL_W = 156;
const GAP = 6;
const INK = '#1c1917';
const MUTED = '#78716c';
const LINE = '#e7e5e4';

export interface TeamCalendarImageProps {
  calendar: TeamCalendar;
  clubName: string;
  saisonLabel: string;
  logoUrl?: string;
  /** Couleur de marque du club ; « À domicile » en aplat, « À l'extérieur » en contour. */
  color?: string;
}

export const TeamCalendarImage = forwardRef<HTMLDivElement, TeamCalendarImageProps>(
  function TeamCalendarImage({ calendar, clubName, saisonLabel, logoUrl, color = '#e51828' }, ref) {
    const { columns, months } = calendar;
    const width = 2 * 48 + DATE_COL_W + columns.length * (TEAM_COL_W + GAP);
    const grid = `${DATE_COL_W}px repeat(${columns.length}, ${TEAM_COL_W}px)`;
    const updated = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

    return (
      <div
        ref={ref}
        style={{
          width: Math.max(width, 760),
          padding: 48,
          boxSizing: 'border-box',
          background: '#ffffff',
          color: INK,
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
          {logoUrl && (
            <img src={logoUrl} alt="" crossOrigin="anonymous"
              style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 999 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color }}>
              {clubName} · Saison {saisonLabel}
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Calendrier des rencontres par équipe
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, background: color }} />
              À domicile
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, boxSizing: 'border-box',
                border: `2px solid ${color}`, background: tint(color, 0.06) }} />
              À l'extérieur
            </span>
          </div>
        </div>

        {/* En-têtes d'équipe */}
        <div style={{ display: 'grid', gridTemplateColumns: grid, columnGap: GAP, alignItems: 'end',
          paddingBottom: 10, borderBottom: `2px solid ${INK}` }}>
          <div />
          {columns.map((c) => (
            <div key={c.key} style={{ padding: '0 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{c.title}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginTop: 2, lineHeight: 1.25 }}>
                {c.subtitle}
              </div>
            </div>
          ))}
        </div>

        {months.map((month) => (
          <div key={month.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 8px' }}>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color }}>
                {month.label}
              </span>
              <span style={{ flex: 1, height: 1, background: LINE }} />
            </div>
            {month.rows.map((row, i) => (
              <div key={row.dayKey} style={{ display: 'grid', gridTemplateColumns: grid, columnGap: GAP,
                alignItems: 'stretch', padding: '4px 0', background: i % 2 ? '#fafaf9' : 'transparent', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '8px 10px' }}>
                  <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {row.date.getDate()}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: 'capitalize' }}>
                    {row.date.toLocaleDateString('fr-FR', { weekday: 'long' })}
                  </span>
                </div>
                {columns.map((c) => (
                  <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(row.cells.get(c.key) ?? []).map((cell) => (
                      <div key={cell.id} style={{
                        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                        padding: '7px 10px', borderRadius: 9, boxSizing: 'border-box', textAlign: 'center',
                        ...(cell.domicile
                          ? { background: color, color: '#ffffff' }
                          : { border: `2px solid ${color}`, background: tint(color, 0.06), color: INK }),
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{cell.adversaire}</span>
                        {cell.heure && (
                          <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, marginTop: 1 }}>{cell.heure}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

        <div style={{ marginTop: 28, paddingTop: 12, borderTop: `1px solid ${LINE}`, fontSize: 11, color: MUTED }}>
          Mis à jour le {updated}
        </div>
      </div>
    );
  },
);
