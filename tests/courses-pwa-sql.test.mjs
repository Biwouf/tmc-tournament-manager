import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { id, coursesFixtureSQL } from './helpers/courses-fixture.mjs';
const v1 = await readFile(
  new URL('../supabase/migrations/2026091001_courses.sql', import.meta.url),
  'utf8',
);
const v2 = await readFile(
  new URL('../supabase/migrations/2026091002_courses_pwa.sql', import.meta.url),
  'utf8',
);
let serial = 40000;
async function fixture() {
  const db = new PGlite();
  await db.exec(coursesFixtureSQL + v1);
  // Historical course and denied request with no reason must survive the upgrade.
  await db.exec(`INSERT INTO course_types(id,club_id,name) VALUES('${id(20)}','${id(1)}','Panier');
    INSERT INTO courses(id,club_id,type_id,name,coach_name,starts_at,duration_minutes,capacity_female,capacity_male) VALUES('${id(30)}','${id(1)}','${id(20)}','Historique','Alex',now()+interval '1 day',60,1,1);
    INSERT INTO course_registrations(id,club_id,course_id,user_id,status,quota_sex) VALUES('${id(40)}','${id(1)}','${id(30)}','${id(105)}','denied','male');`);
  await db.exec(v2);
  await db.exec(await readFile(new URL("../supabase/migrations/2026091101_course_owner_identity.sql", import.meta.url), "utf8"));
  async function as(
    user,
    sql,
    params = [],
    role = user ? 'authenticated' : 'anon',
  ) {
    await db.exec(
      `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true);`,
    );
    try {
      const result = await db.query(sql, params);
      await db.exec('COMMIT');
      return result;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  async function rpc(user, name, args) {
    return (
      await as(
        user,
        `SELECT ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`,
        args,
      )
    ).rows[0].result;
  }
  const admin = (op, data, user = 101, key = id(serial++)) =>
    rpc(user, 'course_admin_command', [id(1), op, data, key]);
  const manage = (op, data, user = 102, key = id(serial++)) =>
    rpc(user, 'course_manage_command', [id(1), op, data, key]);
  const member = (
    course,
    op = 'request',
    rev = null,
    user = 103,
    key = id(serial++),
  ) => rpc(user, 'course_member_command', [id(1), course, op, rev, key]);
  const profile = (user, sex = 'female', revision = 0, prenom = 'Léa') =>
    rpc(user, 'course_save_my_profile', [
      id(1),
      prenom,
      'Martin',
      sex,
      revision,
      id(serial++),
    ]);
  const page = (user = 103, view = 'all', offset = 0) =>
    rpc(user, 'course_my_page', [id(1), view, offset, null]);
  const context = (user = 103) => rpc(user, 'course_my_context', [id(1)]);
  const queue = (course, user = 102, offset = 0, filter = 'pending') =>
    rpc(user, 'course_manage_queue', [id(1), course, offset, filter]);
  const data = {
    type_id: id(20),
    name: 'Cours',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    duration_minutes: 60,
    capacity_female: 1,
    capacity_male: 1,
    owner_id: id(102),
  };
  const course = await admin('save_course', data);
  for (const user of [102, 103, 104]) await profile(user);
  return {
    db,
    as,
    rpc,
    admin,
    manage,
    member,
    profile,
    page,
    context,
    queue,
    course,
    data,
  };
}

test('PWA SQL: upgrade, public privacy, explicit RPC grants and tenant isolation', async () => {
  const f = await fixture();
  try {
    const catalog = await f.rpc(null, 'course_catalog', [id(1), 0, null]);
    assert.equal(catalog.items.length, 2);
    for (const c of catalog.items)
      for (const forbidden of [
        'registration',
        'owner_id',
        'can_manage',
        'pending_count',
        'revision',
        'user_id',
        'denial_reason',
      ])
        assert.equal(forbidden in c, false, forbidden);
    assert.equal(
      (await f.db.query('SELECT owner_id FROM courses WHERE id=$1', [id(30)]))
        .rows[0].owner_id,
      null,
    );
    assert.equal(
      (await f.page(105)).items.find((c) => c.id === id(30)).registration
        .denial_reason,
      null,
    );
    await assert.rejects(
      f.rpc(null, 'course_catalog', [id(3), 0, null]),
      /FORBIDDEN/,
    );
    await assert.rejects(f.queue(f.course.id, 103), /FORBIDDEN/);
    await assert.rejects(f.queue(f.course.id, 106), /FORBIDDEN/);
    for (const name of [
      'course_my_context',
      'course_manage_queue',
      'course_member_command',
    ]) {
      const privileges = await f.db.query(
        "SELECT has_function_privilege('anon',oid,'EXECUTE') allowed FROM pg_proc WHERE proname=$1",
        [name],
      );
      assert.equal(privileges.rows[0].allowed, false);
    }
    for (const name of [
      'course_command_internal',
      'course_command_allowed',
      'course_page_internal',
    ]) {
      const privileges = await f.db.query(
        "SELECT has_function_privilege('authenticated',oid,'EXECUTE') allowed FROM pg_proc WHERE proname=$1",
        [name],
      );
      assert.equal(privileges.rows[0].allowed, false);
    }
    for (const table of [
      'courses',
      'course_registrations',
      'course_registration_events',
      'course_commands',
    ])
      await assert.rejects(
        f.as(102, `SELECT * FROM ${table}`),
        /permission denied/,
      );
    await assert.rejects(
      f.admin('save_course', { ...f.data, owner_id: id(106) }),
      /OWNER_REQUIRED/,
    );
    await assert.rejects(
      f.admin('save_course', { ...f.data, owner_id: null }),
      /OWNER_REQUIRED/,
    );
    assert.equal(
      (await f.rpc(103, 'course_my_page', [id(2), 'manage', 0, null])).total,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test('PWA SQL: member requests, own identity, redemand, refusal, idempotence and immutable quota', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.member(f.course.id, 'request', null, 106),
      /NOT_MEMBER/,
    );
    await assert.rejects(
      f.member(f.course.id, 'request', null, 105),
      /PROFILE_INCOMPLETE/,
    );
    const key = id(serial++);
    const r = await f.member(f.course.id, 'request', null, 103, key);
    assert.deepEqual(await f.member(f.course.id, 'request', null, 103, key), r);
    await assert.rejects(
      f.member(f.course.id, 'cancel', 0, 103, key),
      /VALIDATION_ERROR/,
    );
    await assert.rejects(f.member(f.course.id), /VERSION_CONFLICT/);
    assert.equal(
      (await f.page(104)).items.find((c) => c.id === f.course.id).registration,
      null,
    );
    await f.profile(103, 'male', 1);
    assert.equal(
      (await f.page()).items.find((c) => c.id === f.course.id).registration
        .quota_sex,
      'female',
    );
    await f.member(f.course.id, 'cancel', 0);
    const again = await f.member(f.course.id, 'request', 1);
    assert.equal(again.id, r.id);
    assert.equal(
      (await f.page()).items.find((c) => c.id === f.course.id).registration
        .quota_sex,
      'male',
    );
    await assert.rejects(
      f.manage('set_status', {
        id: r.id,
        revision: 2,
        status: 'denied',
        denial_reason: '  ',
      }),
      /REASON_REQUIRED/,
    );
    await assert.rejects(
      f.admin('set_status', { id: r.id, revision: 2, status: 'denied' }),
      /REASON_REQUIRED/,
    );
    await f.manage('set_status', {
      id: r.id,
      revision: 2,
      status: 'denied',
      denial_reason: '  Niveau inadapté  ',
    });
    assert.equal(
      (await f.page()).items.find((c) => c.id === f.course.id).registration
        .denial_reason,
      'Niveau inadapté',
    );
    await assert.rejects(
      f.member(f.course.id, 'request', 3),
      /INVALID_TRANSITION/,
    );
    assert.equal(
      (
        await f.db.query(
          'SELECT count(*)::int n FROM course_registration_events WHERE registration_id=$1',
          [r.id],
        )
      ).rows[0].n,
      4,
    );
  } finally {
    await f.db.close();
  }
});

test('PWA SQL: owner scope, pending-only decisions, BO quota sharing and owner reassignment', async () => {
  const f = await fixture();
  try {
    const a = await f.member(f.course.id);
    const b = await f.member(f.course.id, 'request', null, 104);
    const key = id(serial++);
    const payload = { id: a.id, revision: 0, status: 'approved' };
    const approved = await f.manage('set_status', payload, 102, key);
    assert.deepEqual(await f.manage('set_status', payload, 102, key), approved);
    await assert.rejects(
      f.admin('set_status', { id: b.id, revision: 0, status: 'approved' }),
      /QUOTA_FULL/,
    );
    await assert.rejects(
      f.manage('set_status', {
        id: a.id,
        revision: 1,
        status: 'denied',
        denial_reason: 'Non',
      }),
      /INVALID_TRANSITION/,
    );
    await assert.rejects(
      f.manage('profile', {
        user_id: id(103),
        prenom: 'X',
        nom: 'Y',
        sex: 'male',
        revision: 1,
      }),
      /FORBIDDEN/,
    );
    const queue = await f.queue(f.course.id);
    assert.equal(queue.total, 1);
    for (const field of [
      'user_id',
      'email',
      'decided_by',
      'created_by',
      'club_id',
    ])
      assert.equal(field in queue.items[0], false, field);
    assert.equal((await f.queue(f.course.id, 101)).total, 1);
    await f.admin('save_course', {
      ...f.data,
      id: f.course.id,
      revision: 0,
      owner_id: id(104),
    });
    await assert.rejects(f.queue(f.course.id), /FORBIDDEN/);
    await assert.rejects(
      f.manage('set_status', payload, 102, key),
      /FORBIDDEN/,
      'no privileged replay after removal',
    );
    assert.equal((await f.queue(f.course.id, 104)).total, 1);
    // Old owner remains a normal member and can request another course.
    await f.member(id(30), 'request', null, 102);
    assert.equal((await f.context(102)).mine_count, 1);
  } finally {
    await f.db.close();
  }
});

test('PWA SQL: H−4, start, end and +24h have separate semantics', async () => {
  const f = await fixture();
  try {
    const r = await f.member(f.course.id);
    await f.db.query(
      "UPDATE courses SET starts_at=clock_timestamp()+interval '4 hours' WHERE id=$1",
      [f.course.id],
    );
    await assert.rejects(f.member(f.course.id, 'cancel', 0), /BOOKING_CLOSED/);
    await assert.rejects(
      f.member(f.course.id, 'request', null, 104),
      /BOOKING_CLOSED/,
    );
    await f.manage('set_status', { id: r.id, revision: 0, status: 'approved' });
    assert.equal((await f.page(103, 'mine')).total, 1);
    await f.db.query(
      "UPDATE courses SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [f.course.id],
    );
    assert.equal(
      (await f.page(103, 'mine')).items[0].registration.status,
      'approved',
    );
    assert.equal((await f.page(102, 'manage')).total, 1);
    assert.equal((await f.queue(f.course.id)).can_act, false);
    await assert.rejects(
      f.manage('cancel_course', { id: f.course.id, revision: 0 }),
      /COURSE_STARTED/,
    );
    await f.db.query(
      "UPDATE courses SET starts_at=clock_timestamp()-interval '2 hours' WHERE id=$1",
      [f.course.id],
    );
    assert.equal((await f.page(103, 'mine')).total, 0);
    assert.ok((await f.page()).items.some((c) => c.id === f.course.id));
    await f.db.query(
      "UPDATE courses SET starts_at=clock_timestamp()-interval '24 hours' WHERE id=$1",
      [f.course.id],
    );
    assert.ok(!(await f.page()).items.some((c) => c.id === f.course.id));
  } finally {
    await f.db.close();
  }
});

test('PWA SQL: profile editing is atomic, revision shared with BO, no privilege escalation', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.profile(103, 'female', 1, '   '),
      /VALIDATION_ERROR/,
    );
    await f.admin('profile', {
      user_id: id(103),
      prenom: 'Admin',
      nom: 'Modifié',
      sex: 'male',
      revision: 1,
    });
    await assert.rejects(f.profile(103, 'female', 1), /VERSION_CONFLICT/);
    assert.equal((await f.context()).profile.prenom, 'Admin');
    await f.profile(103, 'female', 2, '  Sophie  ');
    assert.equal((await f.context()).profile.prenom, 'Sophie');
    await assert.rejects(
      f.as(103, 'UPDATE profiles SET is_super_admin=true WHERE id=$1', [
        id(103),
      ]),
      /permission denied/,
    );
    await assert.rejects(
      f.as(103, "UPDATE profile_details SET sex='male' WHERE user_id=$1", [
        id(103),
      ]),
      /permission denied/,
    );
    await assert.rejects(
      f.rpc(106, 'course_save_my_profile', [
        id(1),
        'Autre',
        'Club',
        'male',
        0,
        id(serial++),
      ]),
      /FORBIDDEN/,
    );
    assert.equal(
      (
        await f.db.query('SELECT is_super_admin FROM profiles WHERE id=$1', [
          id(103),
        ])
      ).rows[0].is_super_admin,
      false,
    );
  } finally {
    await f.db.close();
  }
});

test('PWA SQL: removal clears ownership, cancels own future requests and preserves others', async () => {
  const f = await fixture();
  try {
    await f.member(f.course.id, 'request', null, 102);
    await f.member(f.course.id, 'request', null, 103);
    await f.db.query(
      'DELETE FROM club_members WHERE club_id=$1 AND user_id=$2',
      [id(1), id(102)],
    );
    assert.equal(
      (
        await f.db.query('SELECT owner_id FROM courses WHERE id=$1', [
          f.course.id,
        ])
      ).rows[0].owner_id,
      null,
    );
    await assert.rejects(f.queue(f.course.id), /FORBIDDEN/);
    assert.equal(
      (await f.page(102)).items.find((c) => c.id === f.course.id).registration
        .status,
      'cancelled',
    );
    assert.equal(
      (await f.page(103)).items.find((c) => c.id === f.course.id).registration
        .status,
      'pending',
    );
    assert.equal((await f.queue(f.course.id, 101)).total, 1);
    await f.manage('cancel_course', { id: f.course.id, revision: 1 }, 101);
    assert.equal((await f.context(103)).mine_count, 0);
    assert.equal(
      (await f.page(103)).items.find((c) => c.id === f.course.id).registration
        .status,
      'cancelled',
    );
    await f.db.query('DELETE FROM clubs WHERE id=$1', [id(1)]);
    assert.equal(
      (await f.db.query('SELECT count(*)::int n FROM courses')).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test('PWA SQL: global counters and bounded pagination over 20 courses / 50 requests', async () => {
  const f = await fixture();
  try {
    await f.db
      .exec(`INSERT INTO courses(club_id,type_id,name,owner_id,starts_at,duration_minutes,capacity_female,capacity_male)
      SELECT '${id(1)}','${id(20)}','Cours '||n,'${id(102)}',now()+interval '1 day'+n*interval '1 minute',60,100,100 FROM generate_series(1,25)n;
      INSERT INTO course_registrations(club_id,course_id,user_id,status,quota_sex) SELECT club_id,id,'${id(103)}','pending','female' FROM courses WHERE owner_id='${id(102)}';
      INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(201,260)n;
      INSERT INTO course_registrations(club_id,course_id,user_id,status,quota_sex) SELECT '${id(1)}','${f.course.id}',id,'pending','male' FROM auth.users WHERE id>='${id(201)}';`);
    const mine = await f.page(103, 'mine');
    assert.equal(mine.items.length, 20);
    assert.equal(mine.total, 26);
    assert.equal((await f.page(103, 'mine', 20)).items.length, 6);
    assert.equal((await f.context()).mine_count, 26);
    assert.equal((await f.context(102)).attention_count, 86);
    assert.equal((await f.queue(f.course.id)).items.length, 50);
    assert.equal((await f.queue(f.course.id)).total, 61);
    assert.equal((await f.queue(f.course.id, 102, 50)).items.length, 11);
  } finally {
    await f.db.close();
  }
});


test('Owner identity: current first name in public and BO reads, legacy names preserved but not exposed', async () => {
 const f = await fixture();
 try {
  const catalog = () => f.rpc(null, 'course_catalog', [id(1), 0, null]);
  let rows = (await catalog()).items;
  assert.equal(rows.find(c => c.id === f.course.id).owner_first_name, 'Léa');
  assert.equal(rows.find(c => c.id === id(30)).owner_first_name, null);
  assert.ok(rows.every(c => !('coach_name' in c)));
  assert.equal((await f.db.query('SELECT coach_name FROM courses WHERE id=$1', [id(30)])).rows[0].coach_name, 'Alex');
  await f.profile(102, 'female', 1, '  Camille  ');
  assert.equal((await catalog()).items.find(c => c.id === f.course.id).owner_first_name, 'Camille');
  const adminRows = await f.rpc(101, 'course_admin_read', [id(1), 'courses', f.course.id, '', 0, '']);
  assert.equal(adminRows[0].owner_first_name, 'Camille');
  assert.equal('coach_name' in adminRows[0], false);
  await assert.rejects(f.admin('save_course', {...f.data, coach_name: 'Texte libre'}), /VALIDATION_ERROR/);
  await f.admin('save_course', {...f.data, id: f.course.id, revision: 0, owner_id: id(103)});
  assert.equal((await catalog()).items.find(c => c.id === f.course.id).owner_first_name, 'Léa');
 } finally { await f.db.close(); }
});
