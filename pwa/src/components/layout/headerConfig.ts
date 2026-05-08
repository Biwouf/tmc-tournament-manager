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
  ['/actus',              { mode: 'root', title: 'Actualités' }],
  ['/actus/:id',          { mode: 'sub',  title: 'Actualité',
                            backTo: '/actus', backLabel: 'Actus' }],
  ['/evenements',         { mode: 'root', title: 'Événements' }],
  ['/evenements/:id',     { mode: 'sub',  title: 'Événement',
                            backTo: '/evenements', backLabel: 'Agenda' }],
  ['/matches',            { mode: 'root', title: 'Matches' }],
  ['/matches/new',        { mode: 'sub',  title: 'Nouveau match',
                            backTo: '/matches', backLabel: 'Matches' }],
  ['/matches/:id/score',  { mode: 'sub',  title: 'Live',
                            backTo: '/matches', backLabel: 'Matches' }],
  ['/login',              { mode: 'sub',  title: 'Connexion',
                            backTo: '/matches', backLabel: 'Matches' }],
];

export function resolveHeader(pathname: string): HeaderConfig {
  for (const [pattern, cfg] of ROUTES) {
    if (matchPath(pattern, pathname)) return cfg;
  }
  return { mode: 'root', title: 'CAC Tennis' };
}
