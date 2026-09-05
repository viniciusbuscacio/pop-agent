import {
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  type Component,
} from '@earendil-works/pi-tui';
import type {
  ChatModelState,
  ModelChoice,
  ModelPair,
  ModelPickerData,
} from '../../application/session.js';
import { paint } from './theme.js';

interface SelectorRow {
  pair: ModelPair;
  search: string;
  label: string;
}

/** Inline, keyboard-only model search used above the ordinary chat editor. */
export class ModelSelector implements Component {
  private query = '';
  private selectedIndex = 0;
  private state: ChatModelState;
  private rows: SelectorRow[];
  onSelect?: (pair: ModelPair) => void;
  onCancel?: () => void;
  onChange?: () => void;

  constructor(private readonly data: ModelPickerData) {
    this.state = data.state;
    this.rows = this.makeRows(data.choices);
    this.selectCurrent();
  }

  updateState(state: ChatModelState): void {
    this.state = state;
    this.rows = this.makeRows(this.data.choices);
    this.selectCurrent();
  }

  get filter(): string {
    return this.query;
  }

  get selected(): ModelPair | undefined {
    return this.filtered()[this.selectedIndex]?.pair;
  }

  invalidate(): void {
    // Rendering is derived directly from current rows and query.
  }

  render(width: number): string[] {
    const filtered = this.filtered();
    const lines = [truncateToWidth(`  Model filter: ${safeTerminalText(this.query)}`, width, '')];
    const selectedAvailable = isDefault(this.state.selected) || this.data.choices.some(
      (choice) => samePair(choice, this.state.selected),
    );
    if (!selectedAvailable) {
      lines.push(paint.yellow(truncateToWidth(
        `  Current (unavailable): ${safeTerminalText(this.state.selected.provider)} / ${safeTerminalText(this.state.selected.model)}`,
        width,
        '',
      )));
    }
    if (filtered.length === 0) {
      lines.push(paint.dim('  No matching models'));
    } else {
      const maxVisible = 8;
      const start = Math.max(0, Math.min(
        this.selectedIndex - Math.floor(maxVisible / 2),
        filtered.length - maxVisible,
      ));
      const end = Math.min(start + maxVisible, filtered.length);
      for (let index = start; index < end; index += 1) {
        const row = filtered[index];
        if (row === undefined) continue;
        const line = `${index === this.selectedIndex ? '> ' : '  '}${row.label}`;
        lines.push(index === this.selectedIndex
          ? paint.cyan(truncateToWidth(line, width, ''))
          : truncateToWidth(line, width, ''));
      }
      if (start > 0 || end < filtered.length) {
        lines.push(paint.dim(`  (${String(this.selectedIndex + 1)}/${String(filtered.length)})`));
      }
    }
    if (this.data.failedProviders.length > 0) {
      lines.push(paint.yellow(truncateToWidth(
        `  Catalog failed: ${this.data.failedProviders.map(safeTerminalText).join(', ')}. Close and run /model to retry.`,
        width,
        '',
      )));
    }
    lines.push(paint.dim('  Type to filter · arrows move · Enter applies · Esc closes'));
    return lines;
  }

  handleInput(data: string): void {
    const filtered = this.filtered();
    if (matchesKey(data, 'escape')) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, 'up')) {
      if (filtered.length > 0) {
        this.selectedIndex = this.selectedIndex === 0 ? filtered.length - 1 : this.selectedIndex - 1;
        this.onChange?.();
      }
      return;
    }
    if (matchesKey(data, 'down')) {
      if (filtered.length > 0) {
        this.selectedIndex = this.selectedIndex === filtered.length - 1 ? 0 : this.selectedIndex + 1;
        this.onChange?.();
      }
      return;
    }
    if (matchesKey(data, 'enter') || matchesKey(data, 'return')) {
      const row = filtered[this.selectedIndex];
      if (row !== undefined) this.onSelect?.(row.pair);
      return;
    }
    if (matchesKey(data, 'backspace')) {
      if (this.query.length > 0) {
        this.query = [...this.query].slice(0, -1).join('');
        this.selectedIndex = 0;
        this.onChange?.();
      }
      return;
    }

    const printable = decodeKittyPrintable(data) ?? (isPrintable(data) ? data : undefined);
    if (printable !== undefined) {
      this.query += printable;
      this.selectedIndex = 0;
      this.onChange?.();
    }
  }

  private filtered(): SelectorRow[] {
    const query = this.query.trim().toLocaleLowerCase();
    return query.length === 0
      ? this.rows
      : this.rows.filter((row) => row.search.includes(query));
  }

  private selectCurrent(): void {
    const index = this.filtered().findIndex((row) => samePair(row.pair, this.state.selected));
    this.selectedIndex = index < 0 ? 0 : index;
  }

  private makeRows(choices: ModelChoice[]): SelectorRow[] {
    const selected = this.state.selected;
    const effective = this.state.effectiveDefault;
    const defaultDetail = effective === undefined
      ? ''
      : ` (${safeTerminalText(effective.provider)} / ${safeTerminalText(effective.model)})`;
    const rows: SelectorRow[] = [{
      pair: { provider: '', model: '' },
      label: `${isDefault(selected) ? '[selected] ' : ''}Default${defaultDetail}`,
      search: `default ${effective?.provider ?? ''} ${effective?.model ?? ''}`.toLocaleLowerCase(),
    }];
    for (const choice of choices) {
      rows.push({
        pair: { provider: choice.provider, model: choice.model },
        label: `${samePair(choice, selected) ? '[selected] ' : ''}${safeTerminalText(choice.providerName)} / ${safeTerminalText(choice.model)}`,
        search: `${choice.provider} ${choice.providerName} ${choice.model} ${choice.modelName ?? ''}`.toLocaleLowerCase(),
      });
    }
    return rows;
  }
}

/** Prevents provider/catalog data from writing terminal control sequences. */
export function safeTerminalText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '');
}

function isPrintable(value: string): boolean {
  return value.length > 0 && [...value].every((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && point >= 32 && point !== 127;
  });
}

function isDefault(pair: ModelPair): boolean {
  return pair.provider.length === 0 && pair.model.length === 0;
}

function samePair(left: ModelPair, right: ModelPair): boolean {
  return left.provider === right.provider && left.model === right.model;
}
