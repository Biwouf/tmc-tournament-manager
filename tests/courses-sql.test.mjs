import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const migration = await readFile(
  new URL("../supabase/migrations/2026091001_courses.sql", import.meta.url),
  "utf8",
);
import { id, coursesFixtureSQL } from "./helpers/courses-fixture.mjs";
let commandId = 10000;
async function fixture() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL);
  await db.exec(migration);
  const as = async (user, sql, params = [], role = "authenticated") => {
    await db.exec(
      `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ""}',true);`,
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
  const command = async (
    operation,
    data,
    { user = 101, club = 1, key = id(commandId++) } = {},
  ) =>
    (
      await as(user, "SELECT course_admin_command($1,$2,$3,$4) result", [
        id(club),
        operation,
        JSON.stringify(data),
        key,
      ])
    ).rows[0].result;
  const read = async (kind, target = null, user = 101, club = 1, offset = 0) =>
    (
      await as(user, "SELECT course_admin_read($1,$2,$3,'',$4) result", [
        id(club),
        kind,
        target,
        offset,
      ])
    ).rows[0].result;
  const type = await command("save_type", { name: "Séance panier" });
  const courseData = {
    type_id: type.id,
    name: "Cours du club",
    coach_name: "Alex",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    duration_minutes: 60,
    capacity_female: 1,
    capacity_male: 1,
  };
  const course = await command("save_course", courseData);
  for (const user of [103, 104])
    await command("profile", {
      user_id: id(user),
      prenom: "Prénom",
      nom: "Nom",
      sex: "female",
      revision: 0,
    });
  return { db, as, command, read, type, course, courseData };
}

test("Cours: admin-only RPC, cross-club isolation and private tables/profile", async () => {
  const f = await fixture();
  try {
    for (const user of [102, 103, 106, 107]) {
      await assert.rejects(f.read("courses", null, user), /FORBIDDEN/);
      await assert.rejects(
        f.command("save_type", { name: "Interdit" }, { user }),
        /FORBIDDEN/,
      );
    }
    await assert.rejects(
      f.as(null, "SELECT course_admin_read($1,'courses')", [id(1)], "anon"),
      /permission denied/,
    );
    for (const table of [
      "courses",
      "course_types",
      "course_registrations",
      "course_registration_events",
      "course_commands",
    ]) {
      await assert.rejects(
        f.as(101, `SELECT * FROM ${table}`),
        /permission denied/,
      );
      await assert.rejects(
        f.as(101, `DELETE FROM ${table}`),
        /permission denied/,
      );
    }
    assert.equal((await f.read("courses", null, 108)).length, 1);
    await assert.rejects(
      f.command("save_type", { name: "Non" }, { user: 108, club: 3 }),
      /FORBIDDEN/,
    );
    await assert.rejects(
      f.command("profile", {
        user_id: id(106),
        prenom: "A",
        nom: "B",
        sex: "male",
        revision: 0,
      }),
      /NOT_MEMBER/,
    );
    await assert.rejects(
      f.command("profile", {
        user_id: id(103),
        prenom: "A",
        nom: "B",
        sex: "male",
        revision: 1,
        is_super_admin: true,
      }),
      /VALIDATION_ERROR/,
    );
    await assert.rejects(
      f.as(103, `UPDATE profiles SET prenom='X' WHERE id='${id(103)}'`),
      /permission denied/,
    );
    await assert.rejects(
      f.as(
        103,
        `INSERT INTO profiles(id,prenom,nom,is_super_admin) VALUES('${id(103)}','X','Y',true)`,
      ),
      /permission denied/,
    );
    assert.equal(
      (await f.as(103, "SELECT * FROM profile_details")).rows.length,
      1,
    );
    await assert.rejects(
      f.as(null, "SELECT * FROM profile_details", [], "anon"),
      /permission denied/,
    );
    assert.equal(
      (await f.as(null, "SELECT prenom,nom FROM profiles", [], "anon")).rows
        .length,
      8,
    );
    await assert.rejects(
      f.command(
        "cancel_course",
        { id: f.course.id, revision: 0 },
        { user: 106, club: 2 },
      ),
      /NOT_FOUND/,
    );
  } finally {
    await f.db.close();
  }
});

test("Cours: quotas, replays, transitions, schedule lock and capacity changes", async () => {
  const f = await fixture();
  try {
    const payload = {
      course_id: f.course.id,
      user_id: id(103),
      status: "approved",
    };
    const key = id(20000);
    const r = await f.command("add_registration", payload, { key });
    assert.deepEqual(await f.command("add_registration", payload, { key }), r);
    await assert.rejects(
      f.command("add_registration", { ...payload, status: "pending" }, { key }),
      /VALIDATION_ERROR/,
    );
    await assert.rejects(
      f.command("add_registration", payload),
      /ALREADY_REGISTERED/,
    );
    const pending = await f.command("add_registration", {
      course_id: f.course.id,
      user_id: id(104),
      status: "pending",
    });
    await assert.rejects(
      f.command("set_status", {
        id: pending.id,
        status: "approved",
        revision: 0,
      }),
      /QUOTA_FULL/,
    );
    await assert.rejects(
      f.command("save_course", {
        ...f.courseData,
        id: f.course.id,
        revision: 0,
        capacity_female: 0,
      }),
      /QUOTA_FULL/,
    );
    await assert.rejects(
      f.command("save_course", {
        ...f.courseData,
        id: f.course.id,
        revision: 0,
        duration_minutes: 90,
      }),
      /SCHEDULE_LOCKED/,
    );
    await assert.rejects(
      f.command("delete_course", { id: f.course.id, revision: 0 }),
      /COURSE_HAS_HISTORY/,
    );
    await f.command("set_status", {
      id: r.id,
      status: "denied",
      denial_reason: "Indisponibilité",
      revision: 0,
    });
    await assert.rejects(
      f.command("set_status", { id: r.id, status: "approved", revision: 1 }),
      /INVALID_TRANSITION/,
    );
    await f.command("set_status", {
      id: pending.id,
      status: "approved",
      revision: 0,
    });
    await assert.rejects(
      f.command("set_status", {
        id: pending.id,
        status: "cancelled",
        revision: 0,
      }),
      /VERSION_CONFLICT/,
    );
    const rows = await f.read("registrations", f.course.id);
    assert.equal(
      rows.find((x) => x.id === r.id).denial_reason,
      "Indisponibilité",
    );
    await f.command("set_status", { id: r.id, status: "pending", revision: 1 });
    assert.equal(
      (await f.read("registrations", f.course.id)).find((x) => x.id === r.id)
        .denial_reason,
      null,
    );
    assert.equal((await f.read("events", r.id)).length, 3);
    const counts = (await f.read("courses"))[0];
    assert.equal(counts.approved_female, 1);
    assert.equal(counts.pending_count, 1);
    await f.command("cancel_course", { id: f.course.id, revision: 0 });
    assert.ok(
      (await f.read("registrations", f.course.id)).every(
        (x) => x.status === "cancelled",
      ),
    );
    await assert.rejects(
      f.command("set_status", { id: r.id, status: "approved", revision: 3 }),
      /COURSE_CANCELLED/,
    );
  } finally {
    await f.db.close();
  }
});

test("Cours: incomplete profiles, corrections, member removal and account deletion", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.command("add_registration", {
        course_id: f.course.id,
        user_id: id(105),
        status: "approved",
      }),
      /PROFILE_INCOMPLETE/,
    );
    const r = await f.command("add_registration", {
      course_id: f.course.id,
      user_id: id(103),
      status: "approved",
    });
    await f.command("profile", {
      user_id: id(103),
      prenom: "Nouveau",
      nom: "Nom",
      sex: "male",
      revision: 1,
    });
    await assert.rejects(
      f.command("profile", {
        user_id: id(103),
        prenom: "Ancien",
        nom: "Nom",
        sex: "female",
        revision: 1,
      }),
      /VERSION_CONFLICT/,
    );
    assert.equal(
      (await f.read("registrations", f.course.id))[0].quota_sex,
      "female",
    );
    await f.command("correct_quota", { id: r.id, revision: 0 });
    assert.equal(
      (await f.read("registrations", f.course.id))[0].quota_sex,
      "male",
    );
    await f.db.exec(
      `DELETE FROM club_members WHERE user_id='${id(103)}' AND club_id='${id(1)}'`,
    );
    assert.equal(
      (await f.read("registrations", f.course.id))[0].status,
      "cancelled",
    );
    assert.equal((await f.read("courses"))[0].approved_male, 0);
    await assert.rejects(
      f.command("set_status", { id: r.id, status: "approved", revision: 2 }),
      /NOT_MEMBER/,
    );
    await f.db.exec(`DELETE FROM auth.users WHERE id='${id(103)}'`);
    assert.equal((await f.read("registrations", f.course.id)).length, 0);
    assert.equal((await f.read("events", r.id)).length, 0);
    assert.equal(
      (await f.read("courses"))[0].has_registrations,
      true,
      "schedule stays locked despite account deletion",
    );
  } finally {
    await f.db.close();
  }
});

test("Cours: validation, archived types, started courses and Storage tenant policies", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.command("save_type", { name: " séance PANIER " }),
      /duplicate key/,
    );
    await assert.rejects(
      f.command("save_course", {
        ...f.courseData,
        capacity_female: 0,
        capacity_male: 0,
      }),
      /check constraint/,
    );
    await assert.rejects(
      f.command("save_course", { ...f.courseData, duration_minutes: 0 }),
      /check constraint/,
    );
    await assert.rejects(
      f.command("save_type", {
        name: "Image",
        image_path: `${id(2)}/course-types/x.png`,
      }),
      /VALIDATION_ERROR/,
    );
    await assert.rejects(
      f.command("delete_type", { id: f.type.id, revision: 0 }),
      /TYPE_IN_USE/,
    );
    await f.command("archive_type", { id: f.type.id, revision: 0 });
    await assert.rejects(
      f.command("save_course", f.courseData),
      /VALIDATION_ERROR/,
    );
    await f.command("save_course", {
      ...f.courseData,
      id: f.course.id,
      revision: 0,
      name: "Conservé",
    });
    await f.db.exec(
      `UPDATE courses SET starts_at=clock_timestamp() WHERE id='${f.course.id}'`,
    );
    await assert.rejects(
      f.command("add_registration", {
        course_id: f.course.id,
        user_id: id(103),
        status: "pending",
      }),
      /COURSE_STARTED/,
    );
    for (const user of [102, 103, 106])
      await assert.rejects(
        f.as(
          user,
          "INSERT INTO storage.objects(bucket_id,name) VALUES('course-type-images',$1)",
          [`${id(1)}/course-types/x.png`],
        ),
        /row-level security/,
      );
    const path = `${id(1)}/course-types/x.png`;
    await f.as(
      101,
      "INSERT INTO storage.objects(bucket_id,name) VALUES('course-type-images',$1)",
      [path],
    );
    await f.command("save_type", { name: "Image", image_path: path });
    assert.equal(
      (
        await f.as(
          101,
          "DELETE FROM storage.objects WHERE name=$1 RETURNING id",
          [path],
        )
      ).rows.length,
      0,
      "referenced image retained",
    );
    await f.as(
      101,
      "INSERT INTO storage.objects(bucket_id,name) VALUES('course-type-images',$1)",
      [`${id(1)}/course-types/orphan.png`],
    );
    assert.equal(
      (
        await f.as(
          101,
          "DELETE FROM storage.objects WHERE name=$1 RETURNING id",
          [`${id(1)}/course-types/orphan.png`],
        )
      ).rows.length,
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("Cours: deleting a club cascades safely; quota correction preserves a refusal", async () => {
  const f = await fixture();
  try {
    const r = await f.command("add_registration", {
      course_id: f.course.id,
      user_id: id(103),
      status: "pending",
    });
    await f.command("set_status", {
      id: r.id,
      status: "denied",
      denial_reason: "Pas cette semaine",
      revision: 0,
    });
    await f.command("profile", {
      user_id: id(103),
      prenom: "Prénom",
      nom: "Nom",
      sex: "male",
      revision: 1,
    });
    await f.command("correct_quota", { id: r.id, revision: 1 });
    const row = (await f.read("registrations", f.course.id))[0];
    assert.equal(row.denial_reason, "Pas cette semaine");
    assert.equal(row.status, "denied");
    assert.equal(row.quota_sex, "male");
    await f.db.exec(`DELETE FROM clubs WHERE id='${id(1)}'`);
    assert.equal(
      (await f.db.query("SELECT count(*)::int n FROM courses")).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
