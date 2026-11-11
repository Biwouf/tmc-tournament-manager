import { inSection, type EventSection, type SectionPick } from '../../lib/eventRegistrations';

/** Cases à cocher des sections ; toutes cochées = tout l'événement, au moins une reste cochée. */
export default function SectionChoice({
  sections,
  value,
  onChange,
}: {
  sections: EventSection[];
  value: SectionPick;
  onChange: (pick: SectionPick) => void;
}) {
  if (sections.length === 0) return null;
  const toggle = (sectionId: string) => {
    const current = sections.map((s) => s.id).filter((sid) => inSection(value, sid));
    const next = current.includes(sectionId) ? current.filter((sid) => sid !== sectionId) : [...current, sectionId];
    if (next.length === 0) return;
    onChange(next.length === sections.length ? null : next);
  };
  return (
    <div className="flex flex-wrap gap-x-4">
      {sections.map((s) => (
        <label key={s.id} className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={inSection(value, s.id)} onChange={() => toggle(s.id)} />
          {s.titre}
        </label>
      ))}
    </div>
  );
}
