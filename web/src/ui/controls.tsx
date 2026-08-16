import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * The handful of primitives every screen is built from. Colours come from the
 * token variables only -- no literal hex anywhere in a component.
 */

type ButtonVariant = 'primary' | 'ghost' | 'danger';
type IconButtonSize = 'sm' | 'md';

// Not semibold: the app has exactly one heavy line, the Chat/Files/Agent
// navigation, and a New chat button in the same weight right under it read as
// a second title rather than an action (Vinicius, 03/08).
const BUTTON_BASE =
  'inline-flex max-w-full items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors disabled:opacity-50 disabled:cursor-default';

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

/**
 * Semantic button foundation for bespoke controls (rows, disclosure headers,
 * list options). It deliberately owns only interaction states; use Button or
 * IconButton whenever their visual shape fits.
 */
export function Pressable({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`disabled:cursor-default disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

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
  'min-w-0 max-w-full border border-[var(--border)] bg-[var(--input-bg)] outline-none disabled:cursor-default disabled:opacity-50';

const FIELD_SIZES = {
  /** A form field with a label above it. */
  md: 'px-3 py-2 text-[var(--screen-fg)]',
  /** A control that lives in a dense picker, so it reads quieter. */
  sm: 'px-2 py-1 text-xs text-[var(--key-fg-dim)]',
  /** Search in a sidebar or toolbar: compact without shrinking its label. */
  search: 'px-3 py-1.5 text-sm text-[var(--screen-fg)]',
  /** In-place editing inside a list row. */
  compact: 'px-2 py-1 text-sm text-[var(--screen-fg)]',
  /** The chat composer keeps a larger touch target and grows vertically. */
  composer: 'px-4 py-2.5 text-[var(--screen-fg)]',
} as const;

export type FieldSize = keyof typeof FIELD_SIZES;

function fieldClass(size: FieldSize, extra: string, shape: 'control' | 'composer' = 'control'): string {
  const radius = shape === 'composer'
    ? 'rounded-[var(--radius-composer)]'
    : 'rounded-[var(--radius-control)]';
  return `${FIELD_BASE} ${FIELD_SIZES[size]} ${radius} ${extra}`.trim();
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

export function SearchField({
  id,
  size = 'search',
  inputRef,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> & {
  id: string;
  size?: FieldSize;
  inputRef?: Ref<HTMLInputElement> | undefined;
}) {
  return <TextField id={id} type="search" size={size} inputRef={inputRef} {...props} />;
}

export function TextField({
  label,
  hint,
  error,
  id,
  size = 'md',
  inputRef,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  size?: FieldSize;
  inputRef?: Ref<HTMLInputElement> | undefined;
}) {
  return wrap(
    <input
      ref={inputRef}
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
  /** Options with the same group are reached through one first-level row. */
  group?: string;
  groupLabel?: string;
  groupOrder?: number;
}

interface ModelPickerGroup {
  value: string;
  label: string;
  order: number;
}

/** A compact model picker: providers first in the composer, searchable models second. */
export function ModelPicker({
  id,
  label,
  value,
  options,
  placeholder = 'Search models…',
  noResults = 'No models found',
  groupsLabel = 'Providers',
  backToGroupsLabel = 'Back to providers',
  onChange,
  className = '',
  compactLabel,
  layout = 'toolbar',
  openRequest = 0,
}: {
  id: string;
  label: string;
  value: string;
  options: ModelPickerOption[];
  placeholder?: string;
  noResults?: string;
  groupsLabel?: string;
  backToGroupsLabel?: string;
  onChange: (value: string) => void;
  className?: string;
  compactLabel?: string;
  /** Increment to open the picker from an action elsewhere on the page. */
  openRequest?: number;
  /** Toolbar menus escape the composer through a portal; form fields open in place. */
  layout?: 'toolbar' | 'field';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | undefined>(undefined);
  const [toolbarStyle, setToolbarStyle] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = options.find((option) => option.value === value)?.label ?? options[0]?.label ?? '';
  const grouped = layout === 'toolbar' && options.some((option) => option.group !== undefined);
  const groups = Array.from(
    options.reduce((found, option) => {
      if (option.group !== undefined && !found.has(option.group)) {
        found.set(option.group, {
          value: option.group,
          label: option.groupLabel ?? option.group,
          order: option.groupOrder ?? Number.MAX_SAFE_INTEGER,
        });
      }
      return found;
    }, new Map<string, ModelPickerGroup>()).values(),
  ).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  const visibleOptions = grouped
    ? options.filter((option) =>
        activeGroup === undefined ? option.group === undefined : option.group === activeGroup,
      )
    : options;
  const normalizedQuery = query.toLocaleLowerCase();
  const filtered = visibleOptions.filter((option) =>
    `${option.label}\n${option.value}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  // Form fields retain the bounded catalogue. The composer shows every model
  // from the one chosen provider, as requested; its own scroll area contains it.
  const shownOptions = grouped ? filtered : filtered.slice(0, 50);

  useEffect(() => {
    if (openRequest <= 0) return;
    setActiveGroup(undefined);
    setQuery('');
    setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent): void {
      const target = event.target as Node;
      if (
        root.current !== null &&
        !root.current.contains(target) &&
        (popup.current === null || !popup.current.contains(target))
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (open && (!grouped || activeGroup !== undefined)) search.current?.focus();
  }, [activeGroup, grouped, open]);

  useLayoutEffect(() => {
    if (!open || layout !== 'toolbar') return;
    function position(): void {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const width = Math.min(288, window.innerWidth - 16);
      setToolbarStyle({
        bottom: window.innerHeight - rect.top + 4,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        width,
      });
    }
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [layout, open]);

  function choose(next: string): void {
    onChange(next);
    setOpen(false);
    setActiveGroup(undefined);
    setQuery('');
  }

  function toggle(): void {
    if (!open) {
      setActiveGroup(undefined);
      setQuery('');
    }
    setOpen(!open);
  }

  const menu = open ? (
    <div
      ref={popup}
      style={layout === 'toolbar' ? toolbarStyle : undefined}
      className={`${
        layout === 'toolbar'
          ? 'fixed z-50'
          : 'absolute top-full right-0 left-0 z-20 mt-1 w-full'
      } rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--input-bg)] p-1 shadow-[var(--shadow-menu)]`}
    >
      {grouped ? activeGroup === undefined ? (
        <p className="px-2 py-1.5 text-xs font-semibold text-[var(--screen-fg)]">{groupsLabel}</p>
      ) : (
        <div className="flex items-center gap-1 px-1 pb-1">
          <button
            type="button"
            aria-label={backToGroupsLabel}
            onClick={() => {
              setActiveGroup(undefined);
              setQuery('');
            }}
            className="rounded px-2 py-1 text-sm text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
          >
            ←
          </button>
          <span className="min-w-0 truncate text-xs font-semibold text-[var(--screen-fg)]">
            {groups.find((group) => group.value === activeGroup)?.label ?? activeGroup}
          </span>
        </div>
      ) : null}
      {!grouped || activeGroup !== undefined ? (
        <input
          ref={search}
          type="search"
          role="searchbox"
          aria-label={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (grouped) {
                setActiveGroup(undefined);
                setQuery('');
              } else {
                setOpen(false);
              }
            }
            if (event.key === 'Enter' && shownOptions[0] !== undefined) choose(shownOptions[0].value);
          }}
          placeholder={placeholder}
          className={fieldClass('sm', 'mb-1 w-full')}
        />
      ) : null}
      <div id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
        {shownOptions.map((option) => (
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
        {grouped && activeGroup === undefined ? groups.map((group) => {
          const selected = options.some((option) => option.group === group.value && option.value === value);
          return (
            <button
              key={group.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => setActiveGroup(group.value)}
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[var(--screen-fg)] hover:bg-[var(--hover-overlay)]"
            >
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              {selected ? <span className="text-[var(--accent)]">✓</span> : null}
              <span className="text-[var(--muted)]">›</span>
            </button>
          );
        }) : null}
        {shownOptions.length === 0 && (!grouped || activeGroup !== undefined) ? (
          <p className="px-2 py-2 text-xs text-[var(--muted)]">{noResults}</p>
        ) : null}
      </div>
      {!grouped && filtered.length >= 50 ? (
        <p className="px-2 pt-1 text-[10px] text-[var(--muted)]">Type to narrow results</p>
      ) : null}
    </div>
  ) : null;

  return (
    <div ref={root} className={`min-w-0 ${className}`}>
      <span id={`${id}-label`} className="sr-only">{label}</span>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={toggle}
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
      {menu !== null && layout === 'toolbar' ? createPortal(menu, document.body) : menu}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  error,
  id,
  size = 'md',
  shape = 'control',
  inputRef,
  className = '',
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> & {
  id: string;
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  size?: FieldSize;
  shape?: 'control' | 'composer';
  inputRef?: Ref<HTMLTextAreaElement> | undefined;
}) {
  return wrap(
    <textarea
      ref={inputRef}
      id={id}
      aria-describedby={describedBy(id, hint, error)}
      aria-invalid={error !== undefined}
      className={fieldClass(size, className, shape)}
      {...props}
    />,
    id,
    label,
    hint,
    error,
  );
}

/** A standalone checkbox for selection rows whose visible text is elsewhere. */
export function Checkbox({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 shrink-0 accent-[var(--accent)] ${className}`}
      {...props}
    />
  );
}

/** A hidden native file picker, activated by a styled Button or IconButton. */
export function FileInput({
  inputRef,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { inputRef?: Ref<HTMLInputElement> | undefined }) {
  return <input ref={inputRef} type="file" {...props} />;
}

export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm text-[var(--key-fg-dim)]">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span>
            <span className="block text-[var(--screen-fg)]">{option.label}</span>
            {option.hint === undefined ? null : (
              <span className="block text-xs text-[var(--muted)]">{option.hint}</span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function RangeField({
  id,
  label,
  value,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  id: string;
  label: string;
  value: number;
}) {
  return (
    <Field id={id} label={label}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          value={value}
          className={`min-w-0 flex-1 accent-[var(--accent)] ${className}`}
          {...props}
        />
        <output htmlFor={id} className="min-w-10 text-right text-sm text-[var(--key-fg-dim)]">
          {value}
        </output>
      </div>
    </Field>
  );
}

export function SwitchField({
  id,
  label,
  hint,
  checked,
  onChange,
  testId,
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className={`flex items-center justify-between gap-4 text-sm ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-[var(--screen-fg)]">{label}</span>
        {hint === undefined ? null : <span id={`${id}-hint`} className="block text-xs text-[var(--muted)]">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full border border-[var(--border)] ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--input-bg)]'}`}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          data-testid={testId}
          checked={checked}
          disabled={disabled}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[transform,background-color] ${checked ? 'translate-x-[1.125rem] bg-[var(--switch-thumb-on)]' : 'translate-x-0.5 bg-[var(--switch-thumb-off)]'}`} />
      </span>
    </label>
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

const ICON_BUTTON_SIZES: Record<IconButtonSize, string> = {
  sm: 'min-h-8 min-w-8 p-1',
  md: 'min-h-10 min-w-10 p-2',
};

/** A square, accessible toolbar action. Its caller supplies the icon and name. */
export function IconButton({
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: IconButtonSize }) {
  return (
    <button
      type="button"
      className={`inline-grid place-items-center rounded-[var(--radius-control)] text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)] disabled:cursor-default disabled:opacity-50 ${ICON_BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

/** The shared visual shell for action menus; positioning remains the caller's layout concern. */
export function Menu({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="menu"
      className={`flex flex-col rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-[var(--shadow-menu)] ${className}`}
      {...props}
    />
  );
}

export function Card({
  children,
  variant = 'default',
  padding = 'default',
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  variant?: 'default' | 'danger';
  padding?: 'default' | 'compact';
}) {
  const border = variant === 'danger' ? 'border-[var(--danger)]' : 'border-[var(--border)]';
  const spacing = padding === 'compact' ? 'p-4' : 'p-6';
  return (
    <div
      className={`min-w-0 max-w-full rounded-[var(--radius-panel)] border ${border} bg-[var(--panel-bg)] shadow-[var(--shadow-panel)] ${spacing} ${className}`}
      {...props}
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
      className="inline-flex max-w-full flex-wrap self-start overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]"
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
