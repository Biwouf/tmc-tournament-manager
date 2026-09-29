// Only reads rendered DOM. Kept dependency-free so the exact extractor runs in
// Chromium and in fixture tests. Selectors observed on Ten'Up, September 2026.
export function extractTenupPage(document) {
  const text = el => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const main = document.querySelector('main');
  const fail = () => { throw new Error('Feuille Ten’Up incomplète ou format non reconnu. Aucun résultat importé.'); };
  if (!main) return fail();
  const info = label => [...main.querySelectorAll('p')].find(p => text(p) === label)?.nextElementSibling;
  const date = text(info('Date de la rencontre'));
  const teams = [text(info('Équipe 1')), text(info('Équipe 2'))];
  const scores = [...main.querySelectorAll('[capitaine]')].filter(el => !el.querySelector('a')).map(el => text(el));
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date) || teams.some(t => !t) || teams[0] === teams[1] || scores.length !== 2 || scores.some(s => !/^\d+$/.test(s))) return fail();
  const lines = [...main.querySelectorAll('span')].filter(el => /^(Simple|Double) \d+$/.test(text(el))).map(label => {
    const match = /^(Simple|Double) (\d+)$/.exec(text(label));
    const block = label.parentElement?.parentElement?.nextElementSibling;
    const rows = block ? [...block.children].filter(el => el.classList.contains('rounded-t-md') || el.classList.contains('rounded-b-md')) : [];
    if (rows.length !== 2) return fail();
    const sides = rows.map((row, index) => {
      if (text(row.querySelector('a[href*="/equipe/"]')) !== teams[index]) return fail();
      // Unknown result markers (WO, abandonment, disqualification) are rejected,
      // never converted into an ordinary completed match.
      const marker = row.getAttribute('type-resultat');
      if (marker && marker !== 'S') return fail();
      const names = [...row.querySelectorAll('p')].map(text);
      const rankings = [...row.querySelectorAll('.ring-tu-primary-dark')].map(text);
      const cells = [...(row.lastElementChild?.children ?? [])];
      const sets = cells.map(cell => {
        const value = [...cell.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
        if (!/^\d+$/.test(value)) return fail();
        // A tie-break annotation is separate from games; don't merge 7 and 5 into 75.
        const annotation = text(cell.querySelector('sup'));
        const leftover = text(cell).replace(value, '').replace(annotation, '').trim();
        if (leftover || (annotation && !/^\d+$/.test(annotation))) return fail();
        return { games: Number(value), tb: annotation ? Number(annotation) : null };
      });
      if (names.length !== (match[1] === 'Double' ? 2 : 1) || rankings.length !== names.length || sets.length < 2 || sets.length > 3) return fail();
      const players = names.map((name, i) => {
        // FFT renders given names followed by uppercase surnames. Retain the
        // full display name when the split is ambiguous.
        const split = /^(.*?)\s+([\p{Lu}\p{M}'’ -]+)$/u.exec(name);
        return { prenom: split?.[1] || name, nom: split?.[2] || '', classement: rankings[i] };
      });
      return { players, sets };
    });
    if (sides[0].sets.length !== sides[1].sets.length) return fail();
    return { match_type: match[1].toLowerCase(), slot: Number(match[2]),
      players_a: sides[0].players, players_b: sides[1].players,
      sets: sides[0].sets.map((s, i) => ({ a: s.games, b: sides[1].sets[i].games,
        ...(s.tb !== null && sides[1].sets[i].tb !== null ? { tb_a: s.tb, tb_b: sides[1].sets[i].tb } : {}) })) };
  });
  if (lines.length < 1 || lines.length > 6 || new Set(lines.map(l => l.match_type + l.slot)).size !== lines.length) return fail();
  // Doubles show ranking weights. Recover actual rankings from the singles only
  // when identity is unambiguous; otherwise explicitly keep them unknown.
  for (const side of ['players_a', 'players_b']) {
    const rankings = new Map();
    for (const p of lines.filter(l => l.match_type === 'simple').flatMap(l => l[side])) {
      const key = p.prenom + ' ' + p.nom;
      rankings.set(key, rankings.has(key) ? null : p.classement);
    }
    for (const line of lines.filter(l => l.match_type === 'double')) {
      for (const p of line[side]) { p.poids_double = p.classement; p.classement = rankings.get(p.prenom + ' ' + p.nom) ?? 'Non renseigné'; }
    }
  }
  const [day, month, year] = date.split('/');
  return { date: `${year}-${month}-${day}`, teams, scores: scores.map(Number), lines };
}
