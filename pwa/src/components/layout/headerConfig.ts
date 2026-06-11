import { matchPath } from 'react-router-dom';

export type HeaderAction =
  | { kind: 'text'; label: string; onClick: () => void; accent?: boolean }
  | { kind: 'icon'; label: string; onClick: () => void };

export type HeaderConfig = {
  mode: 'root' | 'sub';
  title: string;
  backTo?: string;
  backLabel?: string;
};

const ROUTES: Array<[string, HeaderConfig]> = [
  ['/actu',               { mode: 'root', title: 'Actualités' }],
  ['/actus/:id',          { mode: 'sub',  title: 'Actualité',
                            backTo: '/actu?tab=actus',  backLabel: 'Actualités' }],
  ['/evenements/:id',     { mode: 'sub',  title: 'Événement',
                            backTo: '/actu?tab=events', backLabel: 'Actualités' }],
  ['/matches-equipes',    { mode: 'root', title: 'Matchs équipes' }],
  ['/matches',            { mode: 'root', title: 'Live' }],
  ['/matches/new',        { mode: 'sub',  title: 'Nouveau match',
                            backTo: '/matches', backLabel: 'Live' }],
  ['/matches/:id/score',  { mode: 'sub',  title: 'Live',
                            backTo: '/matches', backLabel: 'Live' }],
  ['/login',              { mode: 'sub',  title: 'Connexion',
                            backTo: '/matches', backLabel: 'Live' }],
];

export function resolveHeader(pathname: string): HeaderConfig {
  for (const [pattern, cfg] of ROUTES) {
    if (matchPath(pattern, pathname)) return cfg;
  }
  return { mode: 'root', title: 'CAC Tennis' };
}
