# Pop Agent UI design system

`web/src/ui/controls.tsx` is the only place that may render native form controls. Pages compose those primitives and may pass layout classes (width, flex, grid placement), but must not restyle borders, backgrounds, radii, typography, focus or disabled states.

`web/src/styles/tokens.css` owns theme values. Components consume semantic variables; literal colors in components are forbidden.

## Focus

The single focus treatment is the global `:focus-visible` ring in `styles/index.css`. A field keeps its neutral border while focused. Do not add `focus:border-[var(--accent)]`, a ring utility, or a second outline.

## Primitives

### Actions

- `Button`: normal primary, ghost and danger actions; `size="md" | "sm"`.
- `IconButton`: square icon-only toolbar action. It must have an accessible name.
- `Pressable`: foundation for bespoke interactive rows, disclosures and options when Button/IconButton do not fit. It centralizes button semantics and disabled behavior.
- `Segmented`: mutually exclusive navigation or view choices.

### Fields

- `TextField`: text, password, email, URL, telephone, number, date and time inputs through the native `type` prop.
- `SearchField`: search inputs in sidebars and toolbars.
- `TextArea`: multiline text, including the `composer` size/shape.
- `Select`: native select box.
- `Checkbox`: standalone row-selection checkbox.
- `CheckField`: labelled checkbox with optional hint.
- `SwitchField`: labelled on/off switch.
- `RadioGroup`: exclusive radio choices.
- `RangeField`: range input with its current value.
- `FileInput`: native file/folder picker, normally hidden and activated by a Button.
- `ModelPicker`: searchable listbox for large model catalogs.

Labelled fields share the same label, hint, error and `aria-describedby` structure. An unlabelled field must receive `aria-label`.

### Surfaces

- `Card`: persistent grouped content.
- `Menu` and `MenuItem`: transient action menus. The caller owns only absolute positioning.
- `CenteredScreen`: narrow setup/login/recovery shell.

Specialized surfaces such as the chat composer, file viewer and streamed tool cards may compose these primitives, but must still use tokens.

## Allowed page-level classes

```tsx
<SearchField id="files-filter" className="w-full sm:flex-1" />
<Button className="self-start" />
<Menu className="absolute top-full right-0 z-20" />
```

These classes describe layout. The following is forbidden because it creates a second skin:

```tsx
<input className="rounded-md border ..." />
<SearchField className="rounded-xl border-blue-500 ..." />
```

## Enforcement

`npm run ui:check` executes `tools/check-ui-primitives.ts`. It parses production TSX and fails when it finds:

- native `button`, `input`, `select` or `textarea` outside `ui/controls.tsx`;
- a hand-written `role="menu"` shell;
- the duplicate accent focus-border utility;
- visual skin utilities passed through a primitive’s `className`;
- literal colors in production TSX instead of semantic theme tokens.

The root TypeScript lifecycle runs this validator before `tsc`, and the repository gate runs it through `npm run typecheck`. Tests may use native controls in small mocks; production code may not.

When a new visual control is needed, add a typed primitive or variant first, document it here, and then consume it from the feature.
