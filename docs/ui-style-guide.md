# Pop Agent UI design system

`web/src/ui/controls.tsx` is the only place that may render native form controls. Pages compose those primitives and may pass layout classes (width, flex, grid placement), but must not restyle borders, backgrounds, radii, typography, focus or disabled states.

`web/src/styles/tokens.css` owns theme values. Components consume semantic variables; literal colors in components are forbidden.

## Focus

The global `:focus-visible` ring identifies actions and choice/navigation
controls. Text-entry fields keep their neutral border with no focus outline;
their caret and selection show the active editing target. Do not add
`focus:border-[var(--accent)]`, a ring utility, or a second outline.

## Primitives

### Actions

- `Button`: normal primary, ghost and danger actions; `size="md" | "sm"`.
- `BackButton`: Settings-style arrow-only return action with an accessible name and minimum 40px touch target.
- `IconButton`: square icon-only toolbar action. It must have an accessible name.
- `Pressable`: foundation for bespoke interactive rows, disclosures and options when Button/IconButton do not fit. It centralizes button semantics and disabled behavior.
- `Segmented`: mutually exclusive navigation or view choices. Compact spacing is used for secondary Agent navigation on every device.

### Fields

- `TextField`: text, password, email, URL, telephone, number, date and time inputs through the native `type` prop.
- `SearchField`: search inputs in sidebars and toolbars.
- `TextArea`: multiline text, including the `composer` size/shape.
- `Select`: native select box.
- `Checkbox`: standalone row-selection checkbox.
- `CheckField`: labelled checkbox with optional hint.
- `SwitchField`: labelled on/off switch. Use `hideLabel` only when adjacent content already names it; the label remains available to assistive technology.
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

## Product language and hierarchy

Pop Agent is a quiet work surface. Accent color means selected location/state;
it is not the default action color. Hierarchy comes from spacing, type and
raised neutral surfaces. Emoji are content, not interface icons. Visible text
lives in i18n resources and errors describe an actionable next step without
exposing stacks, internal paths or secrets.

Primary actions use the neutral raised `Button`; ghost actions remain flat and
danger actions use the danger semantic. Primitive `size` props own density.
Callers must not compete with them using local padding or text-size utilities.

## Responsive and long-content rules

Every route must work at a narrow phone width, an installed PWA window and a
wide browser. Navigation may move, but controls do not acquire a second skin.
Long paths, tool/model names, code and URLs must wrap, truncate or scroll inside
their own bounded surface rather than widening the page. Touch controls and the
composer stay reachable around safe areas and mobile browser chrome.

Font-size preferences must scale related controls consistently. Do not mix
fixed pixels and rem dimensions for controls expected to remain aligned.

## Accessibility and state

Every interactive element is keyboard reachable and programmatically named.
Icon-only buttons require accessible names. Fields connect hint/error text with
`aria-describedby`; errors replace hints and set invalid state. Menus expose
appropriate expanded/selected state, return focus sensibly and close with
standard pointer/keyboard behavior.

Every feature covers its applicable loading, empty, error, disabled,
selected/pressed, offline/reconnecting and stale-cache states. Color is never
the only carrier of meaning. Streamed updates must not steal focus or flood an
assertive live region. Nonessential motion respects reduced-motion preferences.

Destructive owner actions confirm when permanent or broad and name the true
blast radius. Recoverable deletion prefers trash/undo. Save/edit flows retain a
Cancel path and stay in the page rather than moving to a side drawer.

## Review matrix

Automation catches structural drift, not layout truth. Before shipping a new
pattern, check keyboard and accessible naming, dark and light themes, narrow and
wide layouts, long real content, larger font preference and the complete set of
interaction states. Use component tests for behavior and a real browser/device
for overflow, safe areas and touch reachability.

### Contextual actions

Use `ActionSurface` around resource cards or list backgrounds with `{id, label, run, danger?}` actions. It provides both right-click and a visible overflow button, respects native text/media contexts and reports failed actions through the shared notification channel. Use `ContextMenu` with `anchor`, `onClose` and shared `MenuItem` children when the screen already owns menu state (Files, Chat and legacy explorer menus). `menuAnchor`, `menuKeyboard`, `nativeContext` and `selectionIn` centralize event policy; menus must never implement independent network calls or invent unsupported resource actions.
