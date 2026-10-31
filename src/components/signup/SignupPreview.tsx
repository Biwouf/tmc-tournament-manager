import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { brandTokens } from '../../../shared/brandTokens.mjs';
import { clubThemeTokens } from '../../lib/theme';

// SaaS S3 — aperçu en direct du tunnel : le site vitrine et l'écran « Matchs équipes » de la
// PWA, dans le STYLE RÉEL du produit (pas celui de feelike.pro).
//
// Reproduit ici plutôt qu'importé de `web/` et `pwa/` : les vrais composants dépendent de
// leurs contextes (`SiteContext`, `ContactDrawerContext`, `useClub`, `useAuth`, React Query),
// de leurs routeurs, et surtout de feuilles Tailwind dont les noms de tokens se contredisent
// (`bg-muted`, `bg-card` n'ont pas le même sens dans la vitrine et dans le BO). Les importer
// aurait tiré ces dépendances et ces feuilles dans le bundle du BO.
//
// Ce qui N'EST PAS reproduit, ce sont les couleurs : la vitrine reçoit `brandTokens()`
// (`shared/brandTokens.mjs`, la fonction de la vraie vitrine), l'app `clubThemeTokens()`
// (`src/lib/theme.ts`, copie synchronisée de celle de la PWA). Et l'aperçu ne montre que ce
// que le produit rendra pour un club tout juste créé : pas de menu (aucune page n'a encore de
// contenu), pas de sur-titre ni de « Découvrir le club », pas d'initiales sur le site.

export type PreviewData = {
  name: string;
  city: string;
  slug: string;
  color: string;
  logo: string | null;
  photo: string | null;
};

/** Rendu à une largeur « réelle » puis réduit à la place disponible : tailles du produit. */
function Scaled({ width, className, children }: { width: number; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 0, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const scale = outer.current.clientWidth / width;
      setBox({ scale, height: inner.current.offsetHeight * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div ref={outer} className={className} style={{ height: box.height, overflow: 'hidden', position: 'relative' }}>
      <div ref={inner} style={{ width, transform: `scale(${box.scale})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0 }}>
        {children}
      </div>
    </div>
  );
}

const displayName = (data: PreviewData) => data.name.trim() || 'Votre club';

/** Accueil de la vitrine (`web/src/components/layout/Header.tsx` + `home/HeroSection.tsx`). */
export function SitePreview({ data, mobile }: { data: PreviewData; mobile: boolean }) {
  const width = mobile ? 390 : 1200;
  // `min-h-[62vh]` et `clamp(32px, 5.5vw, 56px)` du hero, calculés pour la fenêtre simulée.
  const viewport = mobile ? 844 : 760;
  const name = displayName(data);
  const city = data.city.trim();
  const onImage = Boolean(data.photo);
  return (
    <div className="pv-browser">
      <div className="pv-browser-bar" aria-hidden="true">
        <span className="pv-dots"><span /><span /><span /></span>
        <span className="pv-url">{(data.slug || 'votreclub') + '.feelike.pro'}</span>
      </div>
      <Scaled width={width}>
        <div className="pv-site" style={brandTokens(data.color) as CSSProperties}>
          <header className="pv-site-header">
            <div className="pv-shell pv-site-header-row" style={{ paddingInline: mobile ? 22 : 40 }}>
              <span className="pv-site-identity">
                {data.logo && <img src={data.logo} alt="" className="pv-site-logo" />}
                <span className="pv-site-names">
                  <span className="pv-site-name">{name}</span>
                  {city && <span className="pv-site-city">{city}</span>}
                </span>
              </span>
              {mobile
                ? <span className="pv-site-burger">≡</span>
                : <span className="pv-btn pv-btn-primary" style={{ padding: '10px 20px' }}>Nous contacter</span>}
            </div>
          </header>
          <section className={`pv-site-hero${onImage ? ' on-image' : ''}`}>
            {data.photo && <>
              <img src={data.photo} alt="" className="pv-site-hero-img" />
              <span className="pv-site-hero-veil" />
            </>}
            <div className="pv-shell pv-site-hero-body" style={{
              minHeight: Math.round(viewport * 0.62), paddingInline: mobile ? 22 : 40,
              paddingBlock: mobile ? 64 : 96,
            }}>
              <h1 style={{ fontSize: Math.min(56, Math.max(32, width * 0.055)) }}>{name}</h1>
              <div className="pv-site-actions" style={{ flexDirection: mobile ? 'column' : 'row' }}>
                <span className="pv-btn pv-btn-primary">Nous contacter</span>
              </div>
            </div>
          </section>
        </div>
      </Scaled>
    </div>
  );
}

// Rencontres d'exemple : le week-end qui vient, puis le suivant.
const JOURS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const MOIS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
function sampleMatches(today: Date) {
  const saturday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((6 - today.getDay() + 7) % 7 || 7), 9);
  const at = (days: number) => new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate() + days, 9);
  return [
    { date: at(0), comp: 'Championnat · Messieurs Seniors', equipe: 1, journee: 2, vs: 'TC Saint-Aubin 2', home: true },
    { date: at(1), comp: 'Championnat · Dames +35 ans', equipe: 1, journee: 3, vs: 'AS Montvallon 1', home: false },
    { date: at(8), comp: 'Championnat · Messieurs +45 ans', equipe: 2, journee: 3, vs: 'Entente Val Fleuri 1', home: false },
  ];
}
function season(today: Date) {
  const start = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  return `${start}/${start + 1}`;
}

const Icon = ({ children, strokeWidth = 1.5 }: { children: ReactNode; strokeWidth?: number }) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const TABS = [
  { label: 'Actu', icon: <Icon><path d="M5 6.5a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-11Z" /><path d="M8 8.5h8M8 11h8M8 13.5h5M8 16h4" /></Icon> },
  { label: 'Matchs équipes', icon: <Icon><path d="M12 3 4.5 5.5v6c0 4.5 3.4 8 7.5 9 4.1-1 7.5-4.5 7.5-9v-6L12 3Z" /><path d="M9 12.5l2 2 4-4.5" /></Icon> },
  { label: 'Live', icon: <Icon><circle cx="8.2" cy="8.2" r="3.4" /><path d="M10.6 10.6 14.5 14.5" /><circle cx="15.8" cy="8.2" r="3.4" /><path d="M13.4 10.6 9.5 14.5" /><circle cx="12" cy="19" r="1.6" /></Icon> },
  { label: 'Cours', icon: <Icon strokeWidth={1.8}><path d="m2 8 10-5 10 5-10 5L2 8Z" /><path d="M6 10v6c4 3 8 3 12 0v-6M22 8v7" /></Icon> },
];

/** Écran « Matchs équipes » de la PWA (`AppHeader`, `MatchEquipeFilterBar`, `MatchEquipeCell`
 *  à l'état « à venir », `BottomNav`), avec les classes Tailwind de la PWA : le BO a les mêmes
 *  tokens, pilotés ici par `clubThemeTokens()`. */
export function AppPreview({ data }: { data: PreviewData }) {
  const name = displayName(data);
  const today = new Date();
  const matches = sampleMatches(today);
  return (
    <div className="pv-phone">
      <Scaled width={390}>
        <div className="pv-app flex flex-col bg-background text-foreground" style={clubThemeTokens({ primary: data.color }) as CSSProperties}>
          <div className="pv-app-status" aria-hidden="true" />
          <div className="flex h-14 items-center gap-2 border-b border-border/60 bg-card" style={{ paddingLeft: 12, paddingRight: 8 }}>
            {data.logo
              ? <img src={data.logo} alt="" className="h-8 w-8 shrink-0 rounded-full object-contain" />
              : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{name[0]}</span>}
            <span className="flex-1 truncate tracking-tight text-foreground" style={{ fontSize: 17, fontWeight: 800 }}>Matchs équipes</span>
            <span className="h-9 px-3 text-sm leading-9 font-bold text-primary">Connexion</span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex gap-2">
              <span className="flex h-[34px] items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm">
                <span className="text-muted-foreground">Saison</span><span className="font-bold text-foreground">{season(today)}</span><Chevron />
              </span>
              <span className="flex h-[34px] items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm">
                <span className="text-muted-foreground">Équipe</span><span className="font-bold text-foreground">Toutes</span><Chevron />
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1">
              <span className="flex items-center justify-center gap-2 rounded-lg bg-foreground py-2 text-sm font-bold text-background">
                À venir / En cours<span className="min-w-[20px] rounded-full bg-white/20 px-1.5 text-center text-xs font-bold text-background">{matches.length}</span>
              </span>
              <span className="flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold text-muted-foreground">
                Passés<span className="min-w-[20px] rounded-full bg-muted px-1.5 text-center text-xs font-bold text-muted-foreground">0</span>
              </span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
            {matches.map(m => (
              <div key={m.vs} className="grid overflow-hidden rounded-xl border border-border bg-card" style={{ gridTemplateColumns: '72px 1fr 58px', minHeight: 116 }}>
                <div className="flex flex-col items-center justify-center gap-0.5 bg-muted px-1 py-3">
                  <span className="text-[11px] font-bold tracking-wide text-primary">{JOURS[m.date.getDay()]}</span>
                  <span className="text-[30px] leading-none font-extrabold text-foreground">{m.date.getDate()}</span>
                  <span className="text-[11px] font-semibold text-foreground/70">{MOIS[m.date.getMonth()]}</span>
                  <span className="mt-1 rounded-full border border-accent px-1.5 py-0.5 text-[11px] font-bold text-primary">09:00</span>
                </div>
                <div className="flex min-w-0 flex-col justify-center gap-1.5 px-3 py-3">
                  <span className="truncate text-[11px] font-bold tracking-wide text-primary uppercase">{m.comp}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-muted-foreground">ÉQUIPE {m.equipe}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-muted-foreground uppercase">JOURNÉE {m.journee}</span>
                  </div>
                  <span className="text-base leading-tight font-extrabold text-foreground">vs {m.vs}</span>
                </div>
                <div className={`flex flex-col items-center justify-center gap-1 ${m.home ? 'bg-primary' : 'bg-foreground'} text-white`}>
                  <span className="text-2xl leading-none">{m.home ? '🏠' : '✈️'}</span>
                  <span className="text-[9px] font-bold tracking-widest">{m.home ? 'AU CLUB' : 'EXT.'}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex border-t border-border bg-card">
            {TABS.map(tab => (
              <span key={tab.label} className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${tab.label === 'Matchs équipes' ? 'text-primary' : 'text-muted-foreground'}`}>
                {tab.icon}<span>{tab.label}</span>
              </span>
            ))}
          </div>
        </div>
      </Scaled>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
