import { useState, useRef, useEffect } from 'react';
import type { ReactNode, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';

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
}

function ToolbarButton({ onClick, disabled, title, children }: ToolbarButtonProps) {
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    const pending = pendingSelectionRef.current;
    if (!ta || !pending) return;
    ta.focus();
    ta.setSelectionRange(pending.start, pending.end);
    setHasSelection(pending.start !== pending.end);
    pendingSelectionRef.current = null;
  }, [value]);

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

    const match = line.match(/^(#{1,6}) /);
    let newLine: string;
    if (match && match[1].length === level) {
      newLine = line.substring(match[0].length);
    } else if (match) {
      newLine = target + line.substring(match[0].length);
    } else {
      newLine = target + line;
    }

    const newValue = value.substring(0, lineStart) + newLine + value.substring(lineEnd);
    const newCursor = lineStart + newLine.length;
    pendingSelectionRef.current = { start: newCursor, end: newCursor };
    onChange(newValue);
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
          </div>
        )}
      </div>
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
