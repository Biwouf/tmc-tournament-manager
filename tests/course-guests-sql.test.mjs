import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { id, coursesFixtureSQL } from "./helpers/courses-fixture.mjs";

const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

async function fixture() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL);
  for (const name of [
    "2026091001_courses.sql",
    "2026091002_courses_pwa.sql",
    "2026091101_course_owner_identity.sql",
  ])
    await db.exec(await migration(name));
  await db.exec("ALTER TABLE profile_details ADD COLUMN classement text");
  await db.exec(await migration("2026092902_course_restore.sql"));
  await db.exec(await migration("2026100501_course_guests.sql"));
  await db.exec(`INSERT INTO course_types(id,club_id,name) VALUES('${id(20)}','${id(1)}','Tennis'),('${id(21)}','${id(2)}','Padel');
    INSERT INTO courses(id,club_id,type_id,name,starts_at,duration_minutes,capacity_female,capacity_male,owner_id) VALUES
    ('${id(30)}','${id(1)}','${id(20)}','Cours seniors',now()+interval '1 day',60,1,2,'${id(102)}'),
    ('${id(31)}','${id(1)}','${id(20)}','Cours suivant',now()+interval '2 days',60,2,2,'${id(102)}'),
    ('${id(32)}','${id(2)}','${id(21)}','Autre club',now()+interval '1 day',60,2,2,NULL);`);
  let serial = 1000;
  const as = async (user, sql, params = []) => {
    await db.exec(
      `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true);`,
    );
    try {
      const result = await db.query(sql, params);
      await db.exec("COMMIT");
      return result;
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  };
  const rpc = async (user, name, args) =>
    (
      await as(
        user,
        `SELECT ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  const admin = (op, data, { user = 101, club = 1 } = {}) =>
    rpc(user, "course_admin_command", [id(club), op, data, id(serial++)]);
  const read = (kind, target = null, { user = 101, search = "", filter = "" } = {}) =>
    rpc(user, "course_admin_read", [id(1), kind, target, search, 0, filter]);
  return { db, as, rpc, admin, read };
}

test("Invités : fiche réutilisable, inscription confirmée, quota et isolation", async () => {
  const f = await fixture();
  try {
    // Seul un admin crée une fiche ; les tables restent privées.
    await assert.rejects(
      f.admin("save_guest", { prenom: "Jeanne", nom: "Durand", sex: "female" }, { user: 102 }),
      /FORBIDDEN/,
    );
    await assert.rejects(f.as(103, "SELECT * FROM club_guests"), /permission denied/);
    await assert.rejects(
      f.admin("save_guest", { prenom: " ", nom: "Durand", sex: "female" }),
      /VALIDATION_ERROR/,
    );
    const jeanne = await f.admin("save_guest", { prenom: " Jeanne ", nom: "Durand", sex: "female" });
    const paul = await f.admin("save_guest", { prenom: "Paul", nom: "Martin", sex: "male" });
    const found = await f.read("guests", null, { search: "jean" });
    assert.deepEqual(
      found.map((g) => [g.guest_id, g.prenom, g.sex]),
      [[jeanne.id, "Jeanne", "female"]],
    );
    // Un invité est toujours confirmé, jamais en attente.
    await assert.rejects(
      f.admin("add_registration", { course_id: id(30), guest_id: jeanne.id, status: "pending" }),
      /INVALID_TRANSITION/,
    );
    await assert.rejects(
      f.admin("add_registration", { course_id: id(30), guest_id: jeanne.id, user_id: id(103), status: "approved" }),
      /VALIDATION_ERROR/,
    );
    const reg = await f.admin("add_registration", { course_id: id(30), guest_id: jeanne.id, status: "approved" });
    await assert.rejects(
      f.admin("add_registration", { course_id: id(30), guest_id: jeanne.id, status: "approved" }),
      /ALREADY_REGISTERED/,
    );
    // Le quota femmes (1) est occupé par l'invitée.
    const other = await f.admin("save_guest", { prenom: "Anne", nom: "Petit", sex: "female" });
    await assert.rejects(
      f.admin("add_registration", { course_id: id(30), guest_id: other.id, status: "approved" }),
      /QUOTA_FULL/,
    );
    await f.admin("add_registration", { course_id: id(30), guest_id: paul.id, status: "approved" });
    const rows = await f.read("registrations", id(30));
    assert.deepEqual(
      rows.map((r) => [r.prenom, r.nom, r.quota_sex, r.status, r.user_id, r.guest_id]),
      [
        ["Jeanne", "Durand", "female", "approved", null, jeanne.id],
        ["Paul", "Martin", "male", "approved", null, paul.id],
      ],
    );
    const [course] = await f.read("courses", id(30));
    assert.equal(course.approved_female, 1);
    assert.equal(course.approved_male, 1);
    // Fiche réutilisée sur un autre cours, historique par invité.
    await f.admin("add_registration", { course_id: id(31), guest_id: jeanne.id, status: "approved" });
    assert.equal((await f.read("history", jeanne.id)).length, 2);
    // Transitions : désinscrire puis réinscrire ; jamais refusé ni en attente.
    await assert.rejects(
      f.admin("set_status", { id: reg.id, revision: 0, status: "denied", denial_reason: "x" }),
      /INVALID_TRANSITION/,
    );
    await f.admin("set_status", { id: reg.id, revision: 0, status: "cancelled" });
    await assert.rejects(
      f.admin("set_status", { id: reg.id, revision: 1, status: "pending" }),
      /INVALID_TRANSITION/,
    );
    await f.admin("set_status", { id: reg.id, revision: 1, status: "approved" });
    // Le responsable voit l'invité dans les demandes traitées, sans action possible.
    const queue = await f.rpc(102, "course_manage_queue", [id(1), id(30), 0, "treated"]);
    assert.ok(queue.items.some((r) => r.prenom === "Jeanne" && r.is_guest === true));
    await assert.rejects(
      f.rpc(102, "course_manage_command", [id(1), "set_status", { id: reg.id, revision: 2, status: "denied", denial_reason: "x" }, id(9000)]),
      /INVALID_TRANSITION/,
    );
    // Modifier le sexe de la fiche ne reclasse pas, sauf correction explicite du quota.
    await assert.rejects(
      f.admin("save_guest", { id: jeanne.id, prenom: "Jeanne", nom: "Durand", sex: "male", revision: 5 }),
      /VERSION_CONFLICT/,
    );
    await f.admin("save_guest", { id: jeanne.id, prenom: "Jeanne", nom: "Durand", sex: "male", revision: 0 });
    const quota = async () =>
      (await f.read("registrations", id(30))).find((r) => r.id === reg.id).quota_sex;
    assert.equal(await quota(), "female");
    await f.admin("correct_quota", { id: reg.id, revision: 2 });
    assert.equal(await quota(), "male");
    // Isolation : une fiche d'un club n'est pas utilisable ailleurs.
    await assert.rejects(
      f.admin("add_registration", { course_id: id(32), guest_id: paul.id, status: "approved" }, { user: 106, club: 2 }),
      /NOT_FOUND|violates foreign key/,
    );
    await assert.rejects(
      f.admin("save_guest", { id: paul.id, prenom: "X", nom: "Y", sex: "male", revision: 0 }, { user: 106, club: 2 }),
      /NOT_FOUND/,
    );
  } finally {
    await f.db.close();
  }
});

test("Invités : annulation puis restauration du cours, retrait de membre sans effet", async () => {
  const f = await fixture();
  try {
    const guest = await f.admin("save_guest", { prenom: "Louis", nom: "Bernard", sex: "male" });
    const reg = await f.admin("add_registration", { course_id: id(30), guest_id: guest.id, status: "approved" });
    await f.db.exec(`DELETE FROM club_members WHERE club_id='${id(1)}' AND user_id='${id(103)}'`);
    assert.equal((await f.read("registrations", id(30)))[0].status, "approved");
    await f.admin("cancel_course", { id: id(30), revision: 0 });
    assert.equal((await f.read("registrations", id(30)))[0].status, "cancelled");
    const [course] = await f.read("courses", id(30));
    await f.admin("restore_course", { id: id(30), revision: course.revision });
    const [row] = await f.read("registrations", id(30));
    assert.equal(row.id, reg.id);
    assert.equal(row.status, "approved");
  } finally {
    await f.db.close();
  }
});
