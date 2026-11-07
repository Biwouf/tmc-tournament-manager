import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { id, coursesFixtureSQL } from "./helpers/courses-fixture.mjs";

// Utilisateurs du fixture : 101 admin club 1 ; 102..105 membres club 1 ; 106 admin club 2.
async function fixture() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL);
  await db.exec(`CREATE TABLE events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL REFERENCES clubs(id),
    titre text NOT NULL,date_debut timestamptz NOT NULL,date_fin timestamptz);
    GRANT SELECT ON events TO anon,authenticated;`);
  for (const name of ["2026110701_event_registrations.sql", "2026110702_event_admin_remove_booking.sql"])
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.exec(`UPDATE profiles SET prenom='P'||right(id::text,3),nom='N'||right(id::text,3);
    INSERT INTO events(id,club_id,titre,date_debut,registration_enabled,registration_max_per_member,registration_capacity) VALUES
    ('${id(40)}','${id(1)}','Soirée',now()+interval '2 days',true,3,5),
    ('${id(41)}','${id(1)}','Sans inscription',now()+interval '2 days',false,3,NULL),
    ('${id(42)}','${id(1)}','Clôturée',now()+interval '2 days',true,3,NULL),
    ('${id(43)}','${id(2)}','Autre club',now()+interval '2 days',true,3,NULL);
    UPDATE events SET registration_deadline=now()-interval '1 hour' WHERE id='${id(42)}';`);
  const as = async (user, sql, params = []) => {
    const role = user ? "authenticated" : "anon";
    await db.exec(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ""}',true);`);
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
    (await as(user, `SELECT ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`, args)).rows[0].result;
  const save = (user, event, members = [], guests = []) =>
    rpc(user, "event_member_save", [id(1), id(event), members.map(id), JSON.stringify(guests)]);
  const state = (user, event = 40) => rpc(user, "event_registration_state", [id(1), id(event)]);
  return { db, as, rpc, save, state };
}

test("Inscription membre : quota par réservation, co-membres, invités, jauge", async () => {
  const f = await fixture();
  try {
    const anon = await f.state(null);
    assert.deepEqual([anon.enabled, anon.open, anon.taken, anon.is_member, anon.is_admin, anon.booking], [true, true, 0, false, false, null]);
    assert.deepEqual([(await f.state(103)).is_admin, (await f.state(101)).is_admin, (await f.state(106)).is_admin], [false, true, false]);

    // 4 places > max 3.
    await assert.rejects(f.save(103, 40, [104, 105], [{ prenom: "Ana", nom: "Invitée" }]), /QUOTA_EXCEEDED/);
    await f.save(103, 40, [104], [{ prenom: "Ana", nom: "Invitée" }]);
    const mine = await f.state(103);
    assert.equal(mine.taken, 3);
    assert.equal(mine.booking.is_owner, true);
    assert.deepEqual(mine.booking.participants.map((p) => [p.prenom, p.is_guest]), [["P103", false], ["P104", false], ["Ana", true]]);

    // Le co-membre voit le titulaire, pas les autres places.
    const co = await f.state(104);
    assert.deepEqual([co.booking.is_owner, co.booking.owner_name, co.booking.participants], [false, "P103 N103", undefined]);

    // Déjà inscrit ailleurs : ni lui ni un autre ne peut le reprendre.
    await assert.rejects(f.save(104, 40), /ALREADY_REGISTERED/);
    await assert.rejects(f.save(105, 40, [104]), /ALREADY_REGISTERED/);

    // Jauge 5 : 3 prises, 105 + 2 invités = 3 → complet.
    await assert.rejects(f.save(105, 40, [], [{ prenom: "A", nom: "B" }, { prenom: "C", nom: "D" }]), /EVENT_FULL/);
    await f.save(105, 40, [], [{ prenom: "A", nom: "B" }]);
    assert.equal((await f.state(105)).taken, 5);

    // Modification : le titulaire retire un co-membre ; sa propre réservation ne compte pas contre la jauge.
    await f.save(103, 40, [], [{ prenom: "Ana", nom: "Invitée" }, { prenom: "Léo", nom: "Invité" }]);
    assert.equal((await f.state(104)).booking, null);
    assert.equal((await f.state(103)).taken, 5);

    // Validation et non-membres.
    await assert.rejects(f.save(103, 40, [], [{ prenom: " ", nom: "X" }]), /VALIDATION_ERROR/);
    await assert.rejects(f.save(106, 40), /NOT_MEMBER/);
    await assert.rejects(f.save(103, 40, [106]), /NOT_MEMBER/);
  } finally {
    await f.db.close();
  }
});

test("Désinscription : titulaire annule tout, co-membre se retire seul", async () => {
  const f = await fixture();
  try {
    await f.save(103, 40, [104, 105]);
    assert.deepEqual(await f.rpc(105, "event_member_cancel", [id(1), id(40)]), { cancelled: "self" });
    assert.equal((await f.state(103)).booking.participants.length, 2);
    assert.deepEqual(await f.rpc(103, "event_member_cancel", [id(1), id(40)]), { cancelled: "booking" });
    assert.equal((await f.state(104)).taken, 0);
    await assert.rejects(f.rpc(103, "event_member_cancel", [id(1), id(40)]), /NOT_REGISTERED/);
  } finally {
    await f.db.close();
  }
});

test("Inscription fermée, clôture, isolation et tables privées", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.save(103, 41), /REGISTRATION_CLOSED/);
    await assert.rejects(f.save(103, 42), /REGISTRATION_CLOSED/);
    assert.equal((await f.state(103, 42)).open, false);
    await assert.rejects(f.rpc(103, "event_member_save", [id(1), id(43), [], "[]"]), /NOT_FOUND/);
    await assert.rejects(f.as(103, "SELECT * FROM event_participants"), /permission denied/);
    await assert.rejects(f.as(null, `SELECT event_member_save('${id(1)}','${id(40)}','{}','[]')`), /permission denied/);
  } finally {
    await f.db.close();
  }
});

test("Admin BO : liste, ajout hors clôture et hors quota, retrait", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.rpc(103, "event_admin_bookings", [id(1), id(42)]), /FORBIDDEN/);
    await assert.rejects(f.rpc(106, "event_admin_bookings", [id(1), id(42)]), /FORBIDDEN/);
    const add = (owner, members, guests) =>
      f.rpc(101, "event_admin_add", [id(1), id(42), id(owner), members.map(id), JSON.stringify(guests)]);
    // Clôturée et 4 places > max 3 : l'admin passe outre.
    await add(103, [104, 105], [{ prenom: "Ana", nom: "Invitée" }]);
    // Un second ajout complète la réservation existante sans rien perdre.
    await add(103, [], [{ prenom: "Léo", nom: "Invité" }]);
    let list = await f.rpc(101, "event_admin_bookings", [id(1), id(42)]);
    assert.equal(list.length, 1);
    assert.equal(list[0].participants.length, 5);
    const leo = list[0].participants.find((p) => p.prenom === "Léo");
    assert.deepEqual(await f.rpc(101, "event_admin_remove", [id(1), leo.id]), { removed: "participant" });
    const owner = list[0].participants.find((p) => p.user_id === id(103));
    assert.deepEqual(await f.rpc(101, "event_admin_remove", [id(1), owner.id]), { removed: "booking" });
    list = await f.rpc(101, "event_admin_bookings", [id(1), id(42)]);
    assert.deepEqual(list, []);
    // Suppression d'une réservation entière, réservée aux admins du club.
    await add(104, [105], [{ prenom: "Ana", nom: "Invitée" }]);
    const [group] = await f.rpc(101, "event_admin_bookings", [id(1), id(42)]);
    await assert.rejects(f.rpc(104, "event_admin_remove_booking", [id(1), group.id]), /FORBIDDEN/);
    await assert.rejects(f.rpc(106, "event_admin_remove_booking", [id(2), group.id]), /NOT_FOUND/);
    assert.deepEqual(await f.rpc(101, "event_admin_remove_booking", [id(1), group.id]), { removed: "booking", places: 3 });
    assert.deepEqual(await f.rpc(101, "event_admin_bookings", [id(1), id(42)]), []);
    // La jauge s'impose aussi à l'admin.
    await f.db.exec(`UPDATE events SET registration_capacity=1 WHERE id='${id(42)}'`);
    await assert.rejects(add(103, [104], []), /EVENT_FULL/);
  } finally {
    await f.db.close();
  }
});
