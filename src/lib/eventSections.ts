/** Sections choisies par une personne : null = tout l'événement. */
export type SectionPick = string[] | null;

export const inSection = (pick: SectionPick, sectionId: string) => pick === null || pick.includes(sectionId);
