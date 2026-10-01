// Rendered championship DOM observed on Ten'Up in September 2026. A championship
// exposes name and scoring rules publicly; genre/category still require review.
export function extractTenupCompetition(document) {
  const text = el => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const main = document.querySelector('main');
  const nom = text(main?.querySelector('h2'));
  const paragraphs = [...(main?.querySelectorAll('p') ?? [])].map(text);
  const value = label => paragraphs.find(p => p.startsWith(`${label} : `))?.slice(label.length + 3) ?? '';
  const composition = /^([0-9]+) simples? \/ ([0-9]+) doubles?$/.exec(value('Rencontres'));
  const singlePoints = /^1 point$/.test(value('Nombre de points pour un simple'));
  const doublePoints = /^([12]) points?$/.exec(value('Nombre de points pour un double'));
  const headings = [...(main?.querySelectorAll('h3') ?? [])].map(text);
  if (!nom || nom.length > 160 || !headings.includes('Format') || !headings.includes('Points par match')) {
    throw new Error('Fiche de championnat Ten’Up incomplète ou non reconnue.');
  }
  const warnings = [];
  const singles = Number(composition?.[1]), doubles = Number(composition?.[2]), points = Number(doublePoints?.[1]);
  const formats = [[2,1,1,'2S1D'],[3,1,1,'3S1D'],[3,1,2,'3S1D2'],[4,1,2,'4S1D2'],[4,2,1,'4S2D']];
  let format = formats.find(([s,d,p]) => s === singles && d === doubles && p === points)?.[3] ?? null;
  const extraDouble = value("Double supplémentaire en cas d'égalité") || value('Double supplémentaire en cas d’égalité');
  if (!singlePoints || extraDouble !== 'Non' || value('Point de bonus pour les deux doubles gagnés') !== 'Non') format = null;
  if (!format) warnings.push('Le nombre de matchs ou les points Ten’Up ne correspondent pas à un format disponible. Choisissez le format adapté avant de créer.');
  const simple = value('Simple');
  let singles_set3_format = null;
  if (/^1 - 3 sets à 6 jeux$/.test(simple)) singles_set3_format = 'normal';
  else if (/2 sets à 6 jeux.*3(?:ème|e) set = SJD à 10 pts/.test(simple)) singles_set3_format = 'super_tiebreak';
  if (!singles_set3_format) warnings.push('La règle du troisième set des simples doit être renseignée manuellement.');
  if (!/^4 - 2 sets à 6 jeux ; pt décisif ; 3ème set = SJD à 10 pts$/.test(value('Double'))) {
    warnings.push('La règle des doubles Ten’Up diffère de celle de l’application (super tie-break). Vérifiez la compatibilité avant de créer.');
    format = null;
  }
  return { nom, format, singles_set3_format, warnings };
}
