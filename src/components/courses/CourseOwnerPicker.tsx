import { useEffect, useState } from "react";
import { readCourses, courseError, type CourseMember } from "../../lib/courses";
import MemberAutocomplete from "./MemberAutocomplete";

export default function CourseOwnerPicker({
  clubId,
  value,
  required,
  onChange,
}: {
  clubId: string;
  value: string;
  required: boolean;
  onChange: (value: string) => void;
}) {
  const [selected, setSelected] = useState<CourseMember | null>(null);
  const [error, setError] = useState("");
  const selectedId = selected?.user_id;
  useEffect(() => {
    if (!value || value === selectedId) return;
    let active = true;
    void readCourses<CourseMember>(clubId, "members", value)
      .then((rows) => {
        if (active) {
          setSelected(rows[0] ?? null);
          setError(
            rows[0]
              ? ""
              : "Ce responsable ne fait plus partie du club. Choisissez un membre.",
          );
        }
      })
      .catch((e) => {
        if (active) setError(courseError(e));
      });
    return () => {
      active = false;
    };
  }, [clubId, value, selectedId]);
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="font-semibold">Responsable du cours</legend>
      <p className="text-sm text-muted-foreground">
        Son prénom sera affiché comme encadrant. Ce membre pourra traiter les
        demandes et annuler ce cours depuis la PWA.
      </p>
      {!required && !value && (
        <p className="text-sm text-muted-foreground">
          Responsable à désigner — gestion par les admins.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <MemberAutocomplete
        clubId={clubId}
        value={selected?.user_id === value ? selected : null}
        required={required}
        label="Rechercher un responsable"
        onChange={(member) => {
          setSelected(member);
          setError("");
          onChange(member?.user_id ?? "");
        }}
      />
    </fieldset>
  );
}
