// Multi-tenant — PR11 (lot A) : réception des messages du formulaire de contact.
// Spec : docs/specs/MULTI_TENANT.md §7 + docs/briefs/web_site_brief.md §5.6.
//
// Écran EN LECTURE SEULE, et rien de plus. Pas de marquage lu/non-lu, pas de recherche,
// pas de réponse depuis le BO : on répond depuis son client mail, en cliquant sur
// l'adresse — le `replyTo` posé par l'Edge Function fait déjà que « Répondre » depuis la
// notification atterrit chez le visiteur. Le marqueur lu/non-lu est une dette assumée.
//
// Lecture directe sur `contact_messages` (pas d'Edge Function) : il n'y a ici ni secret ni
// écriture, la RLS `contact_messages_select_tenant` suffit. Le `.eq('club_id', clubId)`
// reste posé comme partout dans le BO — la RLS est la barrière, le filtre applicatif est
// ce qui évite d'aller chercher des lignes qu'on n'a de toute façon pas le droit de voir.
//
// `ip_hash` n'est jamais demandé au serveur, donc jamais affiché : c'est une donnée
// anti-spam, elle n'a rien à faire sous les yeux d'un administrateur de club.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';

// Généreux et fixe (brief §6) : une pagination pour un volume qu'on n'a pas encore mesuré
// serait de la complexité spéculative. À revoir le jour où un club l'atteint.
const MAX_MESSAGES = 200;

interface ContactMessage {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  message: string;
  created_at: string;
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function ContactMessagesPage() {
  const { clubId, club } = useClub();

  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    setError(null);
    try {
      // Colonnes explicites plutôt que `*` : `ip_hash` ne doit pas transiter jusqu'au
      // navigateur, même sans être affiché (patron `lib/socialCredentials.ts`).
      const { data, error: queryErr } = await supabase
        .from('contact_messages')
        .select('id, first_name, last_name, email, phone, message, created_at')
        .eq('club_id', clubId)
        .order('created_at', { ascending: false })
        .limit(MAX_MESSAGES);
      if (queryErr) throw queryErr;
      setMessages((data ?? []) as ContactMessage[]);
    } catch (e) {
      setError(
        'Chargement des messages impossible. ' +
          (e instanceof Error ? e.message : String(e)),
      );
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Messages</h1>
            <p className="mt-2 text-muted-foreground">
              Les messages envoyés depuis le formulaire de contact du site de{' '}
              <span className="font-medium text-foreground">{club?.name ?? 'ce club'}</span>.
            </p>
          </div>
          <Link
            to="/"
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            ← Accueil
          </Link>
        </div>
      </header>

      <main className="container mx-auto flex flex-col gap-9 px-4 py-12">
        <section>
          <h2 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
            Boîte de réception
          </h2>

          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : messages.length === 0 ? (
            <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
              <p className="text-sm text-muted-foreground">
                Aucun message pour le moment. Les messages envoyés depuis la page Contact du
                site apparaîtront ici.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {messages.map((msg) => (
                <MessageCard key={msg.id} message={msg} clubName={club?.name ?? null} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function MessageCard({
  message,
  clubName,
}: {
  message: ContactMessage;
  clubName: string | null;
}) {
  const fullName = `${message.first_name} ${message.last_name}`.trim();
  // Sujet pré-rempli : l'administrateur répond depuis son client mail sans avoir à
  // reconstituer le contexte, et le visiteur reconnaît de quoi on lui parle.
  const subject = encodeURIComponent(
    `Re : votre message${clubName ? ` — ${clubName}` : ''}`,
  );

  return (
    <li className="rounded-2xl border bg-card/90 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-card-foreground">{fullName}</h3>
          <p className="mt-1.5 text-sm">
            <a
              href={`mailto:${message.email}?subject=${subject}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {message.email}
            </a>
            {message.phone && (
              <span className="text-muted-foreground"> · {message.phone}</span>
            )}
          </p>
        </div>
        <time
          dateTime={message.created_at}
          className="text-sm text-muted-foreground"
        >
          {dateFormatter.format(new Date(message.created_at))}
        </time>
      </div>

      {/* `whitespace-pre-wrap` : le message est du texte brut saisi par un visiteur, il
          garde ses retours à la ligne et n'est JAMAIS interprété comme du markdown ou du
          HTML — contrairement aux contenus éditoriaux du club, celui-ci vient du dehors. */}
      <p className="mt-4 whitespace-pre-wrap border-t border-border/70 pt-4 text-sm text-card-foreground">
        {message.message}
      </p>
    </li>
  );
}
