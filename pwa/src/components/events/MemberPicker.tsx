import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fullName, type Member } from '../../lib/eventRegistrations';

// Recherche d'un membre du club (RPC team_member_search, 2 lettres min.).
// Avec onPickNamed (admin), propose aussi d'ajouter le texte saisi comme personne sans compte.

// « Jean Dupont » → prénom Jean, nom Dupont (le nom reste modifiable ensuite).
const splitName = (text: string) => {
  const [prenom, ...rest] = text.trim().split(/\s+/);
  return { prenom, nom: rest.join(' ') };
};
export default function MemberPicker({
  clubId,
  exclude,
  onPick,
  onPickNamed,
  placeholder = 'Ajouter un membre du club',
}: {
  clubId: string;
  exclude: string[];
  onPick: (m: Member) => void;
  onPickNamed?: (name: { prenom: string; nom: string }) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Member[]>([]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) {
        setHits([]);
        return;
      }
      const { data } = await supabase.rpc('team_member_search', { p_club: clubId, p_search: query });
      if (active) setHits((data as Member[] | null) ?? []);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [clubId, query]);

  const visible = hits.filter((m) => !exclude.includes(m.id));
  const typed = query.trim();
  const named = onPickNamed && typed.length >= 2;
  const clear = () => {
    setQuery('');
    setHits([]);
  };
  return (
    <div>
      <input
        value={query}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
      />
      {(visible.length > 0 || named) && (
        <ul className="mt-1 rounded-lg border border-border bg-background">
          {visible.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="min-h-11 w-full px-3 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick(m);
                  clear();
                }}
              >
                {fullName(m)}
              </button>
            </li>
          ))}
          {named && (
            <li className="border-t border-border">
              <button
                type="button"
                className="min-h-11 w-full px-3 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPickNamed(splitName(typed));
                  clear();
                }}
              >
                + « {typed} » <span className="text-muted-foreground">sans compte</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
