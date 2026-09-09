import type { ReactNode } from "react";
import { Link } from "react-router-dom";
export function CourseShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <Link to="/" className="text-sm text-primary">
        ← Accueil
      </Link>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <nav
        aria-label="Administration des cours"
        className="flex flex-wrap gap-4 text-sm text-primary"
      >
        <Link to="/courses">Cours</Link>
        <Link to="/courses/types">Types de cours</Link>
        <Link to="/admin/members">Membres</Link>
      </nav>
      {children}
    </main>
  );
}
export function CourseError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
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
    <div className="flex items-center gap-3">
      <button
        className="course-button"
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 50))}
      >
        Précédent
      </button>
      <span className="text-sm">Page {offset / 50 + 1}</span>
      <button
        className="course-button"
        disabled={count < 50}
        onClick={() => onChange(offset + 50)}
      >
        Suivant
      </button>
    </div>
  );
}
