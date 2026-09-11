export const id = (n) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const coursesFixtureSQL = `
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE clubs(id uuid PRIMARY KEY,name text,status text);
 CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,prenom text NOT NULL DEFAULT '',nom text NOT NULL DEFAULT '',is_super_admin boolean DEFAULT false);
 CREATE TABLE club_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid REFERENCES clubs(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,role text,UNIQUE(club_id,user_id));
 CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce((SELECT is_super_admin FROM profiles WHERE id=auth.uid()),false) $$;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
 ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_update ON profiles FOR UPDATE TO authenticated USING(id=auth.uid());
 CREATE POLICY own_insert ON profiles FOR INSERT TO authenticated WITH CHECK(id=auth.uid());
 CREATE POLICY profile_read ON profiles FOR SELECT TO anon,authenticated USING(true);
 GRANT SELECT ON profiles TO anon,authenticated;
 GRANT INSERT(id,prenom,nom),UPDATE(id,prenom,nom) ON profiles TO authenticated;
 ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
 CREATE POLICY clubs_read ON clubs FOR SELECT TO anon,authenticated USING(true);
 GRANT SELECT ON clubs TO anon,authenticated;
 INSERT INTO clubs VALUES('${id(1)}','Club 1','active'),('${id(2)}','Club 2','active'),('${id(3)}','Club suspendu','suspended');
 INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(101,108) n;
 INSERT INTO profiles(id,prenom,nom,is_super_admin) SELECT id,'Prénom','Nom',id='${id(108)}' FROM auth.users;
 INSERT INTO club_members(club_id,user_id,role) VALUES
 ('${id(1)}','${id(101)}','admin'),('${id(1)}','${id(102)}','manager'),('${id(1)}','${id(103)}','member'),
 ('${id(1)}','${id(104)}','member'),('${id(1)}','${id(105)}','member'),('${id(2)}','${id(106)}','admin'),('${id(3)}','${id(107)}','admin');
 `;
