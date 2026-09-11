// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  CheckField,
  Checkbox,
  FileInput,
  IconButton,
  LinkButton,
  Menu,
  MenuItem,
  RadioGroup,
  RangeField,
  SearchField,
  Select,
  SwitchField,
  TextArea,
  TextField,
} from './controls';

afterEach(cleanup);

describe('UI design-system primitives', () => {
  it('uses the same explicit typography for standard form values and labels', () => {
    render(<>
      <TextField id="title" label="Title" />
      <TextArea id="instructions" label="Instructions" />
      <Select id="priority" label="Priority"><option>First choice</option></Select>
    </>);
    for (const name of ['Title', 'Instructions', 'Priority']) {
      const control = screen.getByLabelText(name);
      expect(control.classList.contains('text-base')).toBe(true);
      expect(control.classList.contains('font-normal')).toBe(true);
      expect(control.classList.contains('font-mono')).toBe(false);
      const label = screen.getByText(name);
      expect(label.classList.contains('text-sm')).toBe(true);
      expect(label.classList.contains('font-normal')).toBe(true);
    }
  });

  it('owns the neutral field skin and leaves focus to the global ring', () => {
    render(
      <>
        <TextField id="name" label="Name" />
        <SearchField id="search" aria-label="Search" />
        <TextArea id="notes" label="Notes" />
        <Select id="kind" label="Kind"><option>One</option></Select>
      </>,
    );
    const controls = [
      ...screen.getAllByRole('textbox'),
      screen.getByRole('searchbox'),
      screen.getByRole('combobox'),
    ];
    for (const control of controls) {
      expect(control.className).toContain('border-[var(--border)]');
      expect(control.className).not.toContain('focus:border-[var(--accent)]');
    }
    for (const control of [...screen.getAllByRole('textbox'), screen.getByRole('searchbox')]) {
      expect(control.className).toContain('outline-none');
    }
  });

  it('provides the standard choice, file and action families', () => {
    render(
      <>
        <Checkbox aria-label="Select row" />
        <CheckField id="check" label="Checkbox" checked={false} onChange={vi.fn()} />
        <SwitchField id="switch" label="Switch" checked={false} onChange={vi.fn()} />
        <RadioGroup legend="Radio" name="radio" value="a" options={[{ value: 'a', label: 'A' }]} onChange={vi.fn()} />
        <RangeField id="range" label="Range" value={5} onChange={vi.fn()} />
        <FileInput data-testid="file" hidden />
        <Button>Button</Button>
        <LinkButton href="/download">Download</LinkButton>
        <IconButton aria-label="Icon">+</IconButton>
        <Menu><MenuItem testId="menu-item" label="Menu item" onClick={vi.fn()} /></Menu>
      </>,
    );
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(screen.getByRole('radio')).toBeTruthy();
    expect(screen.getByRole('slider')).toBeTruthy();
    expect(screen.getByTestId('file').getAttribute('type')).toBe('file');
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe('/download');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('uses distinct switch thumbs for off and on', () => {
    render(
      <>
        <SwitchField id="switch-off" label="Off" checked={false} onChange={vi.fn()} />
        <SwitchField id="switch-on" label="On" checked onChange={vi.fn()} />
      </>,
    );

    const [off, on] = screen.getAllByRole('switch');
    expect(off?.nextElementSibling?.className).toContain('bg-[var(--switch-thumb-off)]');
    expect(on?.nextElementSibling?.className).toContain('bg-[var(--switch-thumb-on)]');
  });
});
