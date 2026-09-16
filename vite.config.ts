import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = [env.VITE_ALLOWED_HOSTS, env.VERCEL_URL, env.VERCEL_BRANCH_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).join(',');
  return {
  define: { 'import.meta.env.VITE_ALLOWED_HOSTS': JSON.stringify(allowedHosts) },
  plugins: [react()],
};
})
