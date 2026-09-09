import type { Runtime } from './tenant';
export function runtime(): Runtime {
  return {
    appEnv: import.meta.env.VITE_ENV || 'development',
    deploymentEnv: process.env.VERCEL_ENV,
    productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    devSlug: import.meta.env.VITE_DEV_CLUB_SLUG,
    previewHosts: [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter((x): x is string => Boolean(x)),
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}
