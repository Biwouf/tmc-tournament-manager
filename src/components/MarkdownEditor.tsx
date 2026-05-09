import { useState, useRef, useEffect } from 'react';
import type { ReactNode, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { supabase } from '../lib/supabase';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}

const expandBlankLines = (md: string) =>
  md.replace(/\n{3,}/g, (m) => '\n\n' + '&nbsp;\n\n'.repeat(m.length - 2));

type InlineFormat = 'bold' | 'italic' | 'underline';
type HeadingLevel = 1 | 2 | 3;
type ImageMode = 'file' | 'url';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const CONTENT_IMAGES_BUCKET = 'content-images';

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/-+/g, '-');
}

const findLineStart = (text: string, pos: number): number => {
  const idx = text.lastIndexOf('\n', pos - 1);
  return idx === -1 ? 0 : idx + 1;
};

const findLineEnd = (text: string, pos: number): number => {
  const idx = text.indexOf('\n', pos);
  return idx === -1 ? text.length : idx;
};

interface ToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: ReactNode;
  active?: boolean;
}

function ToolbarButton({ onClick, disabled, title, children, active }: ToolbarButtonProps) {
  const handleMouseDown = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // Empêche la perte de focus / sélection sur le textarea.
    e.preventDefault();
  };
  return (
    <button
      type="button"
      onMouseDown={handleMouseDown}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-2 py-0.5 text-xs font-medium transition ${
        disabled
          ? 'opacity-40 cursor-not-allowed text-muted-foreground'
          : active
            ? 'bg-muted text-foreground'
            : 'text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

export default function MarkdownEditor({
  value,
  onChange,
  rows = 12,
  placeholder,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [hasSelection, setHasSelection] = useState(false);
  const [imageFormOpen, setImageFormOpen] = useState(false);
  const [imageMode, setImageMode] = useState<ImageMode>('file');
  const [imageAlt, setImageAlt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageFormRef = useRef<HTMLDivElement | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const insertionPosRef = useRef<number | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    const pending = pendingSelectionRef.current;
    if (!ta || !pending) return;
    ta.focus();
    ta.setSelectionRange(pending.start, pending.end);
    setHasSelection(pending.start !== pending.end);
    pendingSelectionRef.current = null;
  }, [value]);

  useEffect(() => {
    if (!imageFormOpen) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      const node = imageFormRef.current;
      if (node && !node.contains(e.target as Node)) {
        closeImageForm();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [imageFormOpen]);

  const refreshSelectionState = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    setHasSelection(ta.selectionStart !== ta.selectionEnd);
  };

  const applyInline = (format: InlineFormat) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const selected = value.substring(start, end);

    let replacement: string;
    if (format === 'bold') {
      if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
        replacement = selected.substring(2, selected.length - 2);
      } else {
        replacement = `**${selected}**`;
      }
    } else if (format === 'italic') {
      const isBold = selected.startsWith('**') && selected.endsWith('**');
      if (
        !isBold &&
        selected.startsWith('*') &&
        selected.endsWith('*') &&
        selected.length >= 2
      ) {
        replacement = selected.substring(1, selected.length - 1);
      } else {
        replacement = `*${selected}*`;
      }
    } else {
      if (selected.startsWith('<u>') && selected.endsWith('</u>') && selected.length >= 7) {
        replacement = selected.substring(3, selected.length - 4);
      } else {
        replacement = `<u>${selected}</u>`;
      }
    }

    const newValue = value.substring(0, start) + replacement + value.substring(end);
    pendingSelectionRef.current = { start, end: start + replacement.length };
    onChange(newValue);
  };

  const applyHeading = (level: HeadingLevel) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const lineStart = findLineStart(value, cursor);
    const lineEnd = findLineEnd(value, cursor);
    const line = value.substring(lineStart, lineEnd);
    const target = '#'.repeat(level) + ' ';

    const headingMatch = line.match(/^(#{1,6}) /);
    const bulletMatch = line.match(/^- /);
    let newLine: string;
    if (headingMatch && headingMatch[1].length === level) {
      newLine = line.substring(headingMatch[0].length);
    } else if (headingMatch) {
      newLine = target + line.substring(headingMatch[0].length);
    } else if (bulletMatch) {
      newLine = target + line.substring(bulletMatch[0].length);
    } else {
      newLine = target + line;
    }

    const newValue = value.substring(0, lineStart) + newLine + value.substring(lineEnd);
    const newCursor = lineStart + newLine.length;
    pendingSelectionRef.current = { start: newCursor, end: newCursor };
    onChange(newValue);
  };

  const applyBulletList = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const lineStart = findLineStart(value, cursor);
    const lineEnd = findLineEnd(value, cursor);
    const line = value.substring(lineStart, lineEnd);

    const bulletMatch = line.match(/^- /);
    const headingMatch = line.match(/^(#{1,6}) /);
    let newLine: string;
    if (bulletMatch) {
      newLine = line.substring(bulletMatch[0].length);
    } else if (headingMatch) {
      newLine = '- ' + line.substring(headingMatch[0].length);
    } else {
      newLine = '- ' + line;
    }

    const newValue = value.substring(0, lineStart) + newLine + value.substring(lineEnd);
    const newCursor = lineStart + newLine.length;
    pendingSelectionRef.current = { start: newCursor, end: newCursor };
    onChange(newValue);
  };

  const insertImageMarkdown = (url: string, alt: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = insertionPosRef.current ?? ta.selectionStart;
    const before = value.substring(0, pos);
    const after = value.substring(pos);
    const needsLeadingNewline = before.length > 0 && !before.endsWith('\n');
    const needsTrailingNewline = after.length > 0 && !after.startsWith('\n');
    const block =
      (needsLeadingNewline ? '\n' : '') +
      `![${alt}](${url})` +
      (needsTrailingNewline ? '\n' : '');
    const newValue = before + block + after;
    const newCursor = pos + block.length;
    pendingSelectionRef.current = { start: newCursor, end: newCursor };
    onChange(newValue);
  };

  const openImageForm = () => {
    const ta = textareaRef.current;
    insertionPosRef.current = ta ? ta.selectionStart : null;
    setImageMode('file');
    setImageAlt('');
    setImageUrl('');
    setImageError(null);
    setImageFormOpen(true);
  };

  const closeImageForm = () => {
    setImageFormOpen(false);
    setImageError(null);
    setUploading(false);
    insertionPosRef.current = null;
  };

  const handleFileUpload = async (file: File) => {
    setImageError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError('Format non supporté (JPEG ou PNG uniquement).');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError('Fichier trop lourd (max 5 Mo).');
      return;
    }

    setUploading(true);
    try {
      const path = `inline/${Date.now()}-${sanitizeFilename(file.name)}`;
      const { error } = await supabase.storage.from(CONTENT_IMAGES_BUCKET).upload(path, file, {
        contentType: file.type,
        cacheControl: '3600',
      });
      if (error) throw error;
      const { data } = supabase.storage.from(CONTENT_IMAGES_BUCKET).getPublicUrl(path);
      insertImageMarkdown(data.publicUrl, imageAlt.trim());
      closeImageForm();
    } catch (err) {
      console.error(err);
      setImageError(err instanceof Error ? err.message : "Erreur lors de l'upload");
      setUploading(false);
    }
  };

  const handleInsertUrl = () => {
    if (!imageUrl.trim()) return;
    insertImageMarkdown(imageUrl.trim(), imageAlt.trim());
    closeImageForm();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      applyInline('bold');
    } else if (key === 'i') {
      e.preventDefault();
      applyInline('italic');
    }
  };

  const inlineDisabled = !hasSelection;

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between gap-2 rounded-t-lg border border-border bg-muted/40 px-2 py-1">
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setTab('write')}
            className={`rounded px-2 py-0.5 transition ${
              tab === 'write'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Écrire
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`rounded px-2 py-0.5 transition ${
              tab === 'preview'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Aperçu
          </button>
        </div>
        {tab === 'write' && (
          <div className="flex items-center gap-0.5">
            <ToolbarButton
              onClick={() => applyInline('bold')}
              disabled={inlineDisabled}
              title="Gras (Ctrl+B)"
            >
              <span className="font-bold">B</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => applyInline('italic')}
              disabled={inlineDisabled}
              title="Italique (Ctrl+I)"
            >
              <span className="italic">I</span>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => applyInline('underline')}
              disabled={inlineDisabled}
              title="Souligné"
            >
              <span className="underline">U</span>
            </ToolbarButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolbarButton onClick={() => applyHeading(1)} title="Titre 1">
              H1
            </ToolbarButton>
            <ToolbarButton onClick={() => applyHeading(2)} title="Titre 2">
              H2
            </ToolbarButton>
            <ToolbarButton onClick={() => applyHeading(3)} title="Titre 3">
              H3
            </ToolbarButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolbarButton onClick={applyBulletList} title="Liste à puces">
              <span aria-hidden>•≡</span>
            </ToolbarButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolbarButton onClick={openImageForm} title="Insérer une image" active={imageFormOpen}>
              <span aria-hidden>🖼</span>
            </ToolbarButton>
          </div>
        )}
      </div>
      {tab === 'write' && imageFormOpen && (
        <div
          ref={imageFormRef}
          className="border-x border-b border-border bg-muted/20 px-3 py-2 text-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setImageMode('file')}
                className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                  imageMode === 'file'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Depuis ma machine
              </button>
              <button
                type="button"
                onClick={() => setImageMode('url')}
                className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                  imageMode === 'url'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Via une URL
              </button>
            </div>
            <button
              type="button"
              onClick={closeImageForm}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              title="Annuler"
            >
              ✕
            </button>
          </div>

          {imageMode === 'file' ? (
            <div className="space-y-2">
              <input
                type="file"
                accept="image/jpeg,image/png"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = '';
                }}
                className="block w-full text-xs"
              />
              {uploading && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  Upload en cours...
                </p>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={handleInsertUrl}
                disabled={!imageUrl.trim()}
                className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition hover:brightness-95 disabled:opacity-50"
              >
                Insérer
              </button>
            </div>
          )}

          <input
            type="text"
            value={imageAlt}
            onChange={(e) => setImageAlt(e.target.value)}
            placeholder="description"
            className="mt-2 block w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />

          {imageError && (
            <p className="mt-2 text-xs text-red-600">{imageError}</p>
          )}
        </div>
      )}
      {tab === 'write' ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={refreshSelectionState}
          onKeyUp={refreshSelectionState}
          onClick={refreshSelectionState}
          onBlur={refreshSelectionState}
          onKeyDown={handleKeyDown}
          rows={rows}
          placeholder={placeholder}
          className="block w-full rounded-b-lg border border-t-0 border-border bg-background px-3 py-2 font-mono text-sm"
        />
      ) : (
        <div
          className="prose prose-sm max-w-none rounded-b-lg border border-t-0 border-border bg-background px-3 py-2"
          style={{ minHeight: `${rows * 1.5}rem` }}
        >
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkBreaks]} rehypePlugins={[rehypeRaw]}>
              {expandBlankLines(value)}
            </ReactMarkdown>
          ) : (
            <p className="text-sm text-muted-foreground">Rien à prévisualiser.</p>
          )}
        </div>
      )}
    </div>
  );
}
