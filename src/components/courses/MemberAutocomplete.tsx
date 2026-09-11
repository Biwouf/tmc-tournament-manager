import { useEffect, useId, useRef, useState } from "react";
import { courseError, readCourses, type CourseMember } from "../../lib/courses";
const memberName = (member: CourseMember) =>
  `${member.prenom ?? ""} ${member.nom ?? ""}`.trim() || "Membre sans nom";

export default function MemberAutocomplete({
  clubId,
  value,
  onChange,
  label = "Rechercher un membre",
  disabled = false,
  required = false,
}: {
  clubId: string;
  value: CourseMember | null;
  onChange: (member: CourseMember | null) => void;
  label?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CourseMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  useEffect(() => {
    input.current?.setCustomValidity(
      required && !value ? "Sélectionnez un membre dans les suggestions." : "",
    );
  }, [required, value]);
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);
  const query = value ? memberName(value) : text;
  useEffect(() => {
    if (!open || disabled) return;
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      void readCourses<CourseMember>(clubId, "members", undefined, query.trim())
        .then((rows) => {
          if (current) {
            setItems(rows);
            setActive(-1);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (current) {
            setItems([]);
            setError(courseError(e));
            setLoading(false);
          }
        });
    }, 220);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [clubId, query, open, disabled]);
  const shown = items.slice(0, 10);
  function choose(member: CourseMember) {
    onChange(member);
    setText("");
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  }
  return (
    <div
      className="member-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className={`member-search ${value ? "has-selection" : ""}`}>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </svg>
        <input
          id={id}
          ref={input}
          role="combobox"
          required={required}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open && !disabled}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && active >= 0 && shown[active]
              ? `${id}-option-${active}`
              : undefined
          }
          disabled={disabled}
          value={query}
          placeholder="Saisir un prénom ou un nom…"
          onFocus={() => {
            setItems([]);
            setLoading(true);
            setOpen(true);
          }}
          onChange={(event) => {
            setText(event.target.value);
            onChange(null);
            setItems([]);
            setLoading(true);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.stopPropagation();
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((i) =>
                event.key === "ArrowDown"
                  ? Math.min(i + 1, shown.length - 1)
                  : Math.max(0, i - 1),
              );
            }
            if (event.key === "Enter" && open) {
              event.preventDefault();
              if (active >= 0 && shown[active]) choose(shown[active]);
            }
          }}
        />
        {(value || text) && (
          <button
            type="button"
            disabled={disabled}
            aria-label="Effacer le membre sélectionné"
            onClick={() => {
              onChange(null);
              setText("");
              setItems([]);
              setLoading(true);
              setOpen(true);
              input.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="member-suggestions">
          <ul role="listbox" id={`${id}-list`} aria-label="Membres du club">
            {!loading &&
              !error &&
              shown.map((member, index) => (
                <li
                  key={member.user_id}
                  role="option"
                  id={`${id}-option-${index}`}
                  aria-selected={active === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(member)}
                >
                  <span className="registration-avatar" aria-hidden="true">
                    {member.prenom?.[0]}
                    {member.nom?.[0]}
                  </span>
                  <span>
                    <strong>{memberName(member)}</strong>
                    <small>
                      {member.complete
                        ? `Profil complet · ${member.sex === "female" ? "Femmes" : "Hommes"}`
                        : "Profil à compléter avant inscription"}
                    </small>
                  </span>
                  <span aria-hidden="true">↵</span>
                </li>
              ))}
          </ul>
          <p role="status" className="member-search-hint">
            {loading
              ? "Recherche…"
              : error ||
                (shown.length === 0
                  ? "Aucun membre trouvé. Essayez un autre nom."
                  : items.length > 10
                    ? "Affinez votre recherche pour retrouver les autres membres."
                    : "Sélectionnez un membre · ↑ ↓ pour naviguer, Entrée pour choisir.")}
          </p>
        </div>
      )}
      {value && (
        <p className="member-selection-note">
          ✓ Membre sélectionné{!value.complete && " · Profil incomplet"}
        </p>
      )}
    </div>
  );
}
