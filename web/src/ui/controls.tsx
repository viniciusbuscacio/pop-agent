import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/**
 * The handful of primitives every screen is built from. Colours come from the
 * token variables only -- no literal hex anywhere in a component.
 */

type ButtonVariant = 'primary' | 'ghost' | 'danger';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-default';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-fg)] hover:enabled:bg-[var(--accent-hover)] border border-transparent',
  ghost:
    'bg-transparent text-[var(--screen-fg)] border border-[var(--border)] hover:enabled:bg-[var(--hover-overlay)]',
  danger:
    'bg-transparent text-[var(--danger)] border border-[var(--border)] hover:enabled:bg-[var(--hover-overlay)]',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`} {...props} />;
}

export function TextField({
  label,
  hint,
  error,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const describedBy = error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-[var(--key-fg-dim)]">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined}
        className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--screen-fg)] outline-none focus:border-[var(--accent)]"
        {...props}
      />
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
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
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
              ? 'shrink-0 bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)]'
              : 'shrink-0 px-4 py-1.5 text-sm text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]'
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
