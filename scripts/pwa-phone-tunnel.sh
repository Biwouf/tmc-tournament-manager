#!/usr/bin/env bash
# Expose la PWA buildée en local sur une URL HTTPS temporaire (Cloudflare quick tunnel),
# pour tester sur téléphone ce qui exige HTTPS : installation, service worker, Web Push.
# Utilise pwa/.env.local et refuse de démarrer s'il vise la base de production.
# Usage : npm run pwa:phone   (Ctrl+C pour tout arrêter ; l'URL change à chaque lancement)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/pwa/.env.local"
PROD_REF="ettausmxxxyfgmxxhvvx"
PORT="${PORT:-4173}"

[ -f "$ENV_FILE" ] || { echo "pwa/.env.local introuvable." >&2; exit 1; }
supabase_url="$(grep -E '^VITE_SUPABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"' ")"
if [ -z "$supabase_url" ] || [[ "$supabase_url" == *"$PROD_REF"* ]]; then
  echo "Refusé : pwa/.env.local doit viser un projet Supabase hors production." >&2
  exit 1
fi
command -v cloudflared >/dev/null || { echo "cloudflared manquant : brew install cloudflared" >&2; exit 1; }

log="$(mktemp)"
tunnel_pid=""
preview_pid=""
cleanup() {
  [ -n "$preview_pid" ] && kill "$preview_pid" 2>/dev/null || true
  [ -n "$tunnel_pid" ] && kill "$tunnel_pid" 2>/dev/null || true
  rm -f "$log"
}
trap cleanup EXIT INT TERM

cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$log" 2>&1 &
tunnel_pid=$!
url=""
for _ in $(seq 1 60); do
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)"
  [ -n "$url" ] && break
  kill -0 "$tunnel_pid" 2>/dev/null || { cat "$log" >&2; exit 1; }
  sleep 0.5
done
[ -n "$url" ] || { echo "Le tunnel n'a pas fourni d'URL." >&2; cat "$log" >&2; exit 1; }
host="${url#https://}"

# L'hôte du tunnel est accepté comme alias technique (resolveClubSlug + VITE_DEV_CLUB_SLUG).
VITE_ALLOWED_HOSTS="$host" npm --prefix "$ROOT/pwa" run build
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="$host" \
  npm --prefix "$ROOT/pwa" run preview -- --port "$PORT" --strictPort &
preview_pid=$!

echo
echo "PWA (base : $supabase_url) disponible sur le téléphone :"
echo "  $url"
echo "Ctrl+C pour arrêter."
wait "$preview_pid"
