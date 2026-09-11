// Opt-in : PostgreSQL jetable uniquement, jamais une base Supabase existante.
// COURSES_TEST_DATABASE_URL doit nommer une DB vide locale courses_test*.
// Client pg installé séparément : COURSES_PG_CLIENT=/chemin/node_modules/pg/lib/index.js.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { id, coursesFixtureSQL } from "./helpers/courses-fixture.mjs";
const url = process.env.COURSES_TEST_DATABASE_URL;
test(
  "PostgreSQL réel : BO et PWA : approbations concurrentes pour la dernière place",
  { skip: !url },
  async () => {
    const address = new URL(url);
    assert.ok(["127.0.0.1", "localhost"].includes(address.hostname));
    assert.match(address.pathname, /^\/courses_test[a-z0-9_]*$/);
    const require = createRequire(import.meta.url);
    const { Client } = require(process.env.COURSES_PG_CLIENT || "pg");
    const setup = new Client({ connectionString: url });
    const first = new Client({
      connectionString: url,
      application_name: "courses-race-first",
    });
    const second = new Client({
      connectionString: url,
      application_name: "courses-race-second",
    });
    await Promise.all([setup.connect(), first.connect(), second.connect()]);
    try {
      assert.equal(
        (
          await setup.query(
            "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'",
          )
        ).rows[0].n,
        0,
        "database must be empty",
      );
      await setup.query(coursesFixtureSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated;', () => `DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`));
      await setup.query(
        await readFile(
          new URL(
            "../supabase/migrations/2026091001_courses.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await setup.query(await readFile(new URL('../supabase/migrations/2026091002_courses_pwa.sql',import.meta.url),'utf8'));
      await setup.query(await readFile(new URL('../supabase/migrations/2026091101_course_owner_identity.sql',import.meta.url),'utf8'));
      async function begin(client, user = 101) {
        await client.query(
          `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(user)}',true)`,
        );
      }
      async function command(client, operation, data, rpc = 'course_admin_command') {
        return (
          await client.query(
            `SELECT ${rpc}($1,$2,$3,$4) result`,
            [id(1), operation, JSON.stringify(data), randomUUID()],
          )
        ).rows[0].result;
      }
      await begin(first);
      const type = await command(first, "save_type", { name: "Panier" });
      const course = await command(first, "save_course", {
        type_id: type.id,
        name: "Test concurrence",
        owner_id: id(102),
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        duration_minutes: 60,
        capacity_female: 1,
        capacity_male: 1,
      });
      for (const user of [103, 104])
        await command(first, "profile", {
          user_id: id(user),
          prenom: "Test",
          nom: "Membre",
          sex: "female",
          revision: 0,
        });
      const one = await command(first, "add_registration", {
        course_id: course.id,
        user_id: id(103),
        status: "pending",
      });
      const two = await command(first, "add_registration", {
        course_id: course.id,
        user_id: id(104),
        status: "pending",
      });
      await first.query("COMMIT");
      await begin(first);
      await begin(second,102);
      await command(first, "set_status", {
        id: one.id,
        status: "approved",
        revision: 0,
      });
      const waiting = command(second, "set_status", {
        id: two.id,
        status: "approved",
        revision: 0,
      }, "course_manage_command").then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      // Attendre la preuve d'un vrai verrou inter-connexions, pas une promesse JS sérialisée.
      let locked = false;
      for (let i = 0; i < 100; i++) {
        const state = await setup.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE application_name='courses-race-second'",
        );
        if (state.rows[0]?.wait_event_type === "Lock") {
          locked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(
        locked,
        "second transaction waits on the first transaction lock",
      );
      await first.query("COMMIT");
      const outcome = await waiting;
      assert.match(outcome.error?.message ?? "", /QUOTA_FULL/);
      await second.query("ROLLBACK");
      const counts = await setup.query(
        "SELECT status,count(*)::int n FROM course_registrations GROUP BY status ORDER BY status",
      );
      assert.deepEqual(counts.rows, [
        { status: "approved", n: 1 },
        { status: "pending", n: 1 },
      ]);
    } finally {
      await first.query("ROLLBACK").catch(() => {});
      await second.query("ROLLBACK").catch(() => {});
      await Promise.all([first.end(), second.end(), setup.end()]);
    }
  },
);
