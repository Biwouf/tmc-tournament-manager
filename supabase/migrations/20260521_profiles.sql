-- Table profiles : prénom/nom des users BO, affichés dans le warning
-- « Prendre le contrôle du live » (BO + PWA). Voir docs/specs/LIVE_SCORE.md.

CREATE TABLE profiles (
  id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prenom TEXT NOT NULL DEFAULT '',
  nom    TEXT NOT NULL DEFAULT ''
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Lecture libre pour authenticated et anon (noms affichés dans warnings BO et PWA publique)
CREATE POLICY "profiles_select_authenticated"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_select_anon"
  ON profiles FOR SELECT TO anon USING (true);

-- Écriture : uniquement son propre profil
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Trigger : crée un profil vide à chaque nouvel utilisateur Supabase Auth
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
