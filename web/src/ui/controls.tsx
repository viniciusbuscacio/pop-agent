import { useEffect, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/**
 * The handful of primitives every screen is built from. Colours come from the
 * token variables only -- no literal hex anywhere in a component.
 */

type ButtonVariant = 'primary' | 'ghost' | 'danger';

// Not semibold: the app has exactly one heavy line, the Chat/Files/Agent
// navigation, and a New chat button in the same weight right under it read as
// a second title rather than an action (Vinicius, 03/08).
const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-default';

/**
 * Size is a prop, never a `text-`/`px-` handed in through `className`: two
 * competing Tailwind classes are resolved by the order the stylesheet happened
 * to emit them in, not by the order they were written -- the same reason the
 * field primitives take one.
 */
const BUTTON_SIZES = {
  /** The default: a button that is the point of its screen or its dialog. */
  md: 'px-4 py-2 text-sm',
  /** A toolbar of them above a list, where the list is the point. */
  sm: 'px-3 py-1.5 text-xs',
} as const;

export type ButtonSize = keyof typeof BUTTON_SIZES;

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Not the accent: the blue belongs to the selected segment of a group, and
  // nowhere else, so that colour always means "this is where you are" instead
  // of also meaning "press this" (Vinicius, 03/08). A primary action is the
  // raised surface -- panel over the screen background, in both themes -- and
  // a ghost stays flat on it.
  primary:
    'bg-[var(--panel-bg)] text-[var(--screen-fg)] border border-[var(--border)] hover:enabled:bg-[var(--panel-hover)]',
  ghost:
    'bg-transparent text-[var(--screen-fg)] border border-[var(--border)] hover:enabled:bg-[var(--hover-overlay)]',
  danger:
    'bg-transparent text-[var(--danger)] border border-[var(--border)] hover:enabled:bg-[var(--hover-overlay)]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={`${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/**
 * The one skin every typed-into or chosen-from control wears. Written once so
 * a change to the field look lands in a single place -- before this existed
 * the same string was hand-copied into eight selects and five textareas, and
 * they had already drifted apart.
 *
 * Size is a prop rather than something a caller overrides through
 * `className`: two competing `px-` classes are resolved by the order Tailwind
 * happened to emit them in, not by the order they were written.
 */
const FIELD_BASE =
  'rounded-md border border-[var(--border)] bg-[var(--input-bg)] outline-none focus:border-[var(--accent)] disabled:opacity-50';

const FIELD_SIZES = {
  /** A form field with a label above it. */
  md: 'px-3 py-2 text-[var(--screen-fg)]',
  /** A control that lives in a toolbar next to icons, so it reads quieter. */
  sm: 'px-2 py-1 text-xs text-[var(--key-fg-dim)]',
} as const;

export type FieldSize = keyof typeof FIELD_SIZES;

function fieldClass(size: FieldSize, extra: string): string {
  return `${FIELD_BASE} ${FIELD_SIZES[size]} ${extra}`.trim();
}

/**
 * Label above, control, then the error *or* the hint -- never both, because
 * two lines of small print under one field is how a form stops being read.
 * Shared by TextField, Select and TextArea so a labelled field is laid out
 * identically whatever is inside it.
 */
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-[var(--key-fg-dim)]">
        {label}
      </label>
      {children}
      {error !== undefined ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Which `aria-describedby` a control should carry, given what is under it. */
function describedBy(id: string, hint?: string, error?: string): string | undefined {
  if (error !== undefined) return `${id}-error`;
  if (hint !== undefined) return `${id}-hint`;
  return undefined;
}

/**
 * A labelled control is wrapped; an unlabelled one is handed back bare, so a
 * toolbar keeps the flex row it was built with instead of gaining a wrapper.
 * An unlabelled control still has to be named -- `aria-label` is not optional
 * in that case, it is the only name the accessibility tree will ever get.
 */
function wrap(
  control: ReactNode,
  id: string,
  label?: string | undefined,
  hint?: string | undefined,
  error?: string | undefined,
): ReactNode {
  if (label === undefined) return control;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {control}
    </Field>
  );
}

export function TextField({
  label,
  hint,
  error,
  id,
  size = 'md',
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  size?: FieldSize;
}) {
  return wrap(
    <input
      id={id}
      aria-describedby={describedBy(id, hint, error)}
      aria-invalid={error !== undefined}
      className={fieldClass(size, className)}
      {...props}
    />,
    id,
    label,
    hint,
    error,
  );
}

export function Select({
  label,
  hint,
  error,
  id,
  size = 'md',
  className = '',
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  size?: FieldSize;
}) {
  return wrap(
    <select
      id={id}
      aria-describedby={describedBy(id, hint, error)}
      className={fieldClass(size, className)}
      {...props}
    >
      {children}
    </select>,
    id,
    label,
    hint,
    error,
  );
}

export interface ModelPickerOption {
  value: string;
  label: string;
}

/** A compact, searchable model picker that keeps the full catalog out of AX until filtered. */
export function ModelPicker({
  id,
  label,
  value,
  options,
  placeholder = 'Search models…',
  noResults = 'No models found',
  onChange,
  className = '',
  compactLabel,
  layout = 'toolbar',
}: {
  id: string;
  label: string;
  value: string;
  options: ModelPickerOption[];
  placeholder?: string;
  noResults?: string;
  onChange: (value: string) => void;
  className?: string;
  compactLabel?: string;
  /**
   * Where the list opens and how wide the closed control is.
   *
   * 'toolbar' is the composer's geometry: a chip that opens upward, because
   * down there is the screen edge. In a form that same list floats up over
   * the page header, detached from the field it belongs to, and stops reading
   * as that field's dropdown at all -- so 'field' opens downward at the full
   * width of the row, like every other control beside it (Vinicius, 04/08).
   */
  layout?: 'toolbar' | 'field';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = options.find((option) => option.value === value)?.label ?? options[0]?.label ?? '';
  const filtered = options
    .filter((option) => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .slice(0, 50);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent): void {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    search.current?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  function choose(next: string): void {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={root} className={`min-w-0 ${className}`}>
      <span id={`${id}-label`} className="sr-only">{label}</span>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((shown) => !shown)}
        className={
          compactLabel !== undefined
            ? 'grid h-10 w-10 place-items-center rounded-full border border-[var(--border)] bg-[var(--input-bg)] p-0 text-sm font-semibold text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]'
            : layout === 'field'
              ? fieldClass('md', 'w-full truncate text-left')
              : fieldClass('sm', 'max-w-full truncate')
        }
      >
        {compactLabel ?? current}
      </button>
      {open ? (
        <div
          className={`absolute z-20 rounded-md border border-[var(--border)] bg-[var(--input-bg)] p-1 shadow-lg ${
            layout === 'field'
              ? 'top-full right-0 left-0 mt-1 w-full'
              : 'right-0 bottom-full mb-1 w-72 max-w-[min(85vw,18rem)]'
          }`}
        >
          <input
            ref={search}
            type="search"
            role="searchbox"
            aria-label={placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
              if (event.key === 'Enter' && filtered[0] !== undefined) choose(filtered[0].value);
            }}
            placeholder={placeholder}
            className={fieldClass('sm', 'mb-1 w-full')}
          />
          <div id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-xs text-[var(--muted)]">{noResults}</p>
            ) : filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => choose(option.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--screen-fg)] hover:bg-[var(--hover-overlay)]"
              >
                <span className="truncate">{option.label}</span>
                {option.value === value ? <span className="ml-auto shrink-0 text-[var(--accent)]">✓</span> : null}
              </button>
            ))}
          </div>
          {filtered.length === 50 ? <p className="px-2 pt-1 text-[10px] text-[var(--muted)]">Type to narrow results</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  error,
  id,
  size = 'md',
  className = '',
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> & {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  size?: FieldSize;
}) {
  return wrap(
    <textarea
      id={id}
      aria-describedby={describedBy(id, hint, error)}
      aria-invalid={error !== undefined}
      className={fieldClass(size, className)}
      {...props}
    />,
    id,
    label,
    hint,
    error,
  );
}

/**
 * A labelled switch for a plain on/off setting. The whole row is the label, so
 * the hit target on a phone is the sentence and not a 16-pixel box.
 */
export function CheckField({
  label,
  hint,
  id,
  checked,
  onChange,
  testId,
}: {
  label: string;
  hint?: string;
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          id={id}
          type="checkbox"
          data-testid={testId}
          checked={checked}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        <span className="text-[var(--screen-fg)]">{label}</span>
      </label>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="pl-[1.625rem] text-xs text-[var(--muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  testId: string;
}

/**
 * `self-start` is what makes the `inline-flex` below mean anything. Every
 * caller puts this inside a `flex flex-col`, where the default
 * `align-items: stretch` widens a child to the whole column -- so the border
 * ran to the far edge of the card with dead space after the last option.
 * `max-w-full` still keeps it inside a column narrower than the options.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  bold = false,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Heavier labels, for the one control that names the whole app's screens. */
  bold?: boolean;
}) {
  const weight = bold ? ' font-semibold' : '';
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex max-w-full flex-wrap self-start overflow-hidden rounded-md border border-[var(--border)]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-testid={option.testId}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={
            option.value === value
              ? `shrink-0 bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)]${weight}`
              : `shrink-0 px-4 py-1.5 text-sm text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]${weight}`
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One row of a popup menu. Lives here rather than beside any one screen: the
 * Files rows, the breadcrumb's overflow and anything else that opens a menu
 * have to look identical, and a second hand-written copy is how they stop
 * being identical.
 */
export function MenuItem({
  label,
  onClick,
  testId,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  testId: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      className={`px-4 py-1.5 text-left whitespace-nowrap hover:bg-[var(--hover-overlay)] ${
        danger ? 'text-[var(--danger)]' : ''
      }`}
    >
      {label}
    </button>
  );
}
