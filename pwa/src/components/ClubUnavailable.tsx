export default function ClubUnavailable({ temporary = false }: { temporary?: boolean }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-slate-900">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Feelike</p>
      <h1 className="mt-4 text-2xl font-semibold">{temporary ? 'Connexion momentanément indisponible' : 'Club introuvable ou indisponible'}</h1>
      <p className="mt-4 break-all text-sm text-slate-500">{window.location.hostname}</p>
      <p className="mt-4 text-sm leading-6 text-slate-600">{temporary
        ? 'Impossible de charger le club. Vérifiez votre connexion et réessayez dans quelques instants.'
        : 'Cette adresse ne correspond pas à un club actif. Vérifiez le lien reçu ou contactez votre club.'}</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Réessayer</button>
    </section>
  </main>;
}
