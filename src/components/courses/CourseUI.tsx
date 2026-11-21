import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import PageHeader from "../layout/PageHeader";

const COURSE_TABS = [
  { to: "/courses", label: "Cours" },
  { to: "/courses/types", label: "Types de cours" },
];

// PR-BO1 — l'en-tête passe par `PageHeader` : onglets Cours / Types de cours sur les deux
// pages racines, fil d'Ariane « Cours › … » sur les sous-pages. Adhérents (ex-« Membres ») n'est
// plus dans cette coquille : c'est une entrée à part de la barre latérale.
export function CourseShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const root = pathname === "/courses" || pathname === "/courses/types";
  const description =
    pathname === "/courses/types"
      ? "Définissez les activités et leurs illustrations pour le catalogue du club."
      : "Organisez les séances, désignez leurs responsables et suivez les inscriptions.";
  return (
    <>
      <PageHeader
        title={title}
        description={root ? description : undefined}
        breadcrumb={root ? undefined : [{ label: "Cours", to: "/courses" }]}
        tabs={root ? COURSE_TABS : undefined}
      />
      <main className="course-workspace mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
export function CourseError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm"
    >
      {message}
    </p>
  ) : null;
}
export function CoursePager({
  offset,
  count,
  onChange,
}: {
  offset: number;
  count: number;
  onChange: (offset: number) => void;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t border-border pt-5"
    >
      <button
        className="course-button"
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 50))}
      >
        ← Précédent
      </button>
      <span className="text-sm text-muted-foreground">
        Page {offset / 50 + 1}
      </span>
      <button
        className="course-button"
        disabled={count < 50}
        onClick={() => onChange(offset + 50)}
      >
        Suivant →
      </button>
    </nav>
  );
}
