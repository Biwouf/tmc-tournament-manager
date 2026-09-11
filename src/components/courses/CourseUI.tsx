import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useClub } from "../../contexts/ClubContext";

const sections = [
  {
    to: "/courses",
    label: "Cours",
    detail: "Planning et inscriptions",
    icon: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
  },
  {
    to: "/courses/types",
    label: "Types de cours",
    detail: "Activités et illustrations",
    icon: "m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  },
  {
    to: "/admin/members",
    label: "Membres",
    detail: "Comptes et profils",
    icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a4 4 0 0 1 0 8",
  },
];
export function CourseShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const { club } = useClub();
  const active = pathname.startsWith("/courses/types")
    ? "/courses/types"
    : pathname.startsWith("/admin/members")
      ? "/admin/members"
      : "/courses";
  const description =
    active === "/admin/members"
      ? "Invitez les membres du club, complétez leurs profils et gérez leurs accès."
      : active === "/courses/types"
        ? "Définissez les activités et leurs illustrations pour le catalogue du club."
        : "Organisez les séances, désignez leurs responsables et suivez les inscriptions.";
  return (
    <main className="course-workspace mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="course-back">
          ← Accueil du club
        </Link>
        <span className="text-sm font-medium text-muted-foreground">
          {club?.name ?? "Administration du club"}
        </span>
      </div>
      <nav aria-label="Administration du club" className="course-navigation">
        {sections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            aria-current={active === section.to ? "page" : undefined}
            className="course-nav-item"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={section.icon} />
            </svg>
            <span>
              <strong>{section.label}</strong>
              <small>{section.detail}</small>
            </span>
          </Link>
        ))}
      </nav>
      <header className="course-page-heading">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Gestion du club
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </header>
      {children}
    </main>
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
