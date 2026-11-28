import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_COPY as T } from '../../../shared/accountCopy.mjs';
import type { Toast } from '../components/account/AccountToast';
import {
  clearAvatar, currentAvatar, emptyAvatarTrash, holdAvatar, isMinor, releaseAvatar, setAvatar, uploadAvatar, type AvatarFiles,
} from '../lib/avatar';
import type { CourseContext, Profile } from '../lib/courses';
import { courseContextKey } from './useCourses';

/** Photo recadrée, gardée en mémoire jusqu'à son enregistrement (« Réessayer » la reprend). */
type Upload = { path: string; files: AvatarFiles; url: string; previous: string | null; percent: number; failed: boolean };

/**
 * Photo de profil : envoi (progression, échec, reprise), retrait, « Annuler » du toast. Le fichier
 * remplacé ou retiré n'est supprimé qu'à la disparition du toast (corbeille de `lib/avatar.ts`).
 */
export function useProfilePhoto({ userId, clubId, profile, setToast }: {
  userId: string | undefined; clubId: string | null; profile: Profile | null; setToast: (toast: Toast | null) => void;
}) {
  const queryClient = useQueryClient();
  const [upload, setUpload] = useState<Upload | null>(null);
  // Photo envoyée d'ici : affichée sans attendre son URL signée.
  const [sent, setSent] = useState<{ path: string; url: string } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const pending = useRef<string | null>(null);
  const urls = useRef<string[]>([]);

  const contextKey = courseContextKey(clubId, userId);
  const patch = (avatar_path: string | null) => queryClient.setQueryData<CourseContext>(contextKey, old =>
    old?.profile ? { ...old, profile: { ...old.profile, avatar_path } } : old);
  const refresh = () => queryClient.invalidateQueries({ queryKey: contextKey });
  const emptyTrash = useCallback(async () => {
    if (userId && clubId) await emptyAvatarTrash(userId, clubId);
  }, [userId, clubId]);

  useEffect(() => {
    mounted.current = true;
    void emptyTrash();
    return () => {
      mounted.current = false;
      // Échec laissé en plan : plus rien ne peut reprendre cet envoi.
      if (pending.current) releaseAvatar(pending.current);
    };
  }, [emptyTrash]);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; }, []);

  function release(...paths: (string | null)[]) {
    paths.forEach(path => path && releaseAvatar(path));
    void emptyTrash();
  }

  /** Remet `target` (`null` : aucune photo) à la place de `from`. */
  async function restore(target: string | null, from: string | null) {
    busy.current = true;
    patch(target);
    try {
      await queryClient.cancelQueries({ queryKey: contextKey });
      await (target ? setAvatar(target) : clearAvatar());
      setToast({ text: T.saved });
    } catch {
      patch(from);
      setToast({ text: T.photoUndoFailed });
    } finally {
      busy.current = false;
      void refresh();
      release(target, from);
    }
  }

  /** Toast « Annuler » : sans lui, la version remplacée part à sa disparition. */
  function offerUndo(text: string, replaced: string | null, now: string | null) {
    let undone = false;
    if (!mounted.current) return release(replaced, now);
    setToast({
      text,
      undo: () => {
        if (busy.current) return;
        undone = true;
        setToast(null);
        void restore(replaced, now);
      },
      onEnd: () => { if (!undone) release(replaced, now); },
    });
  }

  async function run(job: Upload) {
    if (busy.current || !clubId) return;
    busy.current = true;
    pending.current = null;
    setToast(null);
    holdAvatar(job.path);
    if (job.previous) holdAvatar(job.previous);
    setUpload({ ...job, percent: 0, failed: false });
    try {
      await uploadAvatar(job.path, job.files, percent => setUpload(old => (old?.path === job.path ? { ...old, percent } : old)));
      await queryClient.cancelQueries({ queryKey: contextKey });
      await setAvatar(job.path);
    } catch {
      // La réponse a pu se perdre après l'enregistrement.
      if (await currentAvatar(clubId).catch(() => null) !== job.path) {
        busy.current = false;
        void refresh();
        if (!mounted.current) return release(job.path, job.previous);
        pending.current = job.path;
        return setUpload({ ...job, percent: 0, failed: true });
      }
    }
    busy.current = false;
    patch(job.path);
    setSent({ path: job.path, url: job.url });
    setUpload(null);
    void refresh();
    offerUndo(T.photoUpdated, job.previous, job.path);
  }

  function send(files: AvatarFiles) {
    if (!userId || busy.current) return;
    // Un envoi resté en échec est abandonné au profit du nouveau.
    if (upload) releaseAvatar(upload.path);
    const url = URL.createObjectURL(files[512]);
    urls.current.push(url);
    void run({ path: `${userId}/${crypto.randomUUID()}`, files, url, previous: profile?.avatar_path ?? null, percent: 0, failed: false });
  }

  /** Abandon après un échec ; si l'envoi a finalement abouti, l'ancienne photo est remise. */
  async function cancel() {
    if (!upload || !clubId || busy.current) return;
    const { path, previous } = upload;
    setUpload(null);
    pending.current = null;
    if (await currentAvatar(clubId).catch(() => null) === path) await restore(previous, path);
    else release(path, previous);
  }

  async function remove() {
    const path = profile?.avatar_path;
    if (!path || !clubId || busy.current) return;
    busy.current = true;
    setToast(null);
    holdAvatar(path);
    patch(null);
    try {
      await queryClient.cancelQueries({ queryKey: contextKey });
      await clearAvatar();
    } catch {
      if (await currentAvatar(clubId).catch(() => path) === path) {
        busy.current = false;
        patch(path);
        releaseAvatar(path);
        void refresh();
        return setToast({ text: T.photoRemoveFailed });
      }
    }
    busy.current = false;
    void refresh();
    // Une personne devenue mineure (année corrigée) ne pourrait pas la remettre : pas d'« Annuler ».
    if (isMinor(profile.birth_year) === false) return offerUndo(T.photoRemoved, path, null);
    setToast({ text: T.photoRemoved });
    release(path);
  }

  const path = profile?.avatar_path ?? null;
  return {
    upload,
    /** Photo à afficher avant (ou à la place de) l'URL signée. */
    localUrl: upload && !upload.failed ? upload.url : sent?.path === path ? sent?.url : undefined,
    send, cancel, remove,
    retry: () => { if (upload?.failed) void run(upload); },
  };
}
