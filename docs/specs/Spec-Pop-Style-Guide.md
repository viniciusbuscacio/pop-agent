# Pop Agent — UI style guide

**Status:** normative
**Canonical detailed guide:** [`../ui-style-guide.md`](../ui-style-guide.md)
**Primary implementation:** `web/src/ui/controls.tsx`, `web/src/styles/tokens.css`, `web/src/styles/index.css`
**Related:** [`Spec-Pop-Frontend.md`](Spec-Pop-Frontend.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md)

## Product character

Pop Agent is a focused personal work surface, not a marketing dashboard. The UI
is quiet, dense enough for real work and legible on a phone. Visual hierarchy
comes from spacing, typography and surfaces—not decorative color, gradients or
competing card styles.

The same design system serves installed PWA windows, ordinary mobile browsers
and wide desktop layouts. Responsive navigation may move; the meaning and
appearance of controls must not fork by screen.

## Design-system authority

`tokens.css` owns themes and semantic values. `controls.tsx` is the only
production file that may render native form controls. Pages compose typed
primitives and may pass layout classes only. A page must not create a second
visual skin through border, background, radius, shadow, focus or typography
classes.

Dark and light themes provide the same token keys. Components use semantic
variables (`--bg`, `--panel-bg`, `--screen-fg`, `--muted`, `--danger`, etc.),
never literal production colors. Radius and shadows are tokens, not local
choices.

## Interaction vocabulary

- Accent indicates selected location/state, not every primary action.
- Primary buttons are raised neutral surfaces; ghost actions are flat; danger
  is text-semantic and does not turn whole screens red.
- There is one global `:focus-visible` treatment. Fields retain neutral borders.
- Disabled controls remain readable and non-interactive.
- Loading prevents duplicate submission and uses honest action text/status.
- Success/error messages use semantic status, not color alone.
- Emoji are content, not product icons.

## Primitive requirement

Pages use `Button`, `IconButton`, `Pressable`, `Segmented`, `TextField`,
`SearchField`, `TextArea`, `Select`, `Checkbox`, `CheckField`, `SwitchField`,
`RadioGroup`, `RangeField`, `FileInput`, `ModelPicker`, `Card`, `Menu`,
`MenuItem` and `CenteredScreen` as applicable.

A missing reusable shape is added as a typed primitive/variant first. Primitive
size is a prop, not competing Tailwind padding/text classes. Specialized chat,
files, markdown and streamed-tool surfaces may compose lower-level semantics
but still use tokens, focus rules and accessible interaction.

## Forms and actions

Labels, hints, errors and `aria-describedby` follow the shared field structure.
A field shows error instead of hint when invalid. Unlabelled toolbar fields need
an accessible name. Icon-only actions always have `aria-label` or equivalent.

Save/edit flows retain a visible Cancel path and keep forms in the page rather
than moving into side drawers. Destructive owner actions confirm when permanent
or broad; confirmation states the actual subtree/count and whether undo exists.
Recoverable actions prefer immediate feedback and undo/trash over excessive
modal prompts.

Menus are transient action surfaces with keyboard/focus behavior and accessible
names. Segmented controls represent one selected view, not unrelated actions.
Model catalogs use the searchable `ModelPicker`, with provider grouping where
catalog size requires it.

## Layout and responsive behavior

The minimum target is a narrow phone viewport without horizontal page scroll.
Touch targets, composer actions and menus must remain reachable above browser
chrome/safe areas. Long paths, model/tool names, code and URLs wrap or truncate
inside bounded containers rather than widening the page.

Wide screens may add sidebars and content width, but forms remain readable and
do not stretch into full-window text lines. Installed-window, BFCache and
viewport resize behavior must preserve the current task.

Font-size preferences scale related controls consistently. Do not mix fixed px
and rem dimensions for elements expected to remain aligned under text scaling.

## Content and language

All visible product strings use i18n resources. Labels state what will happen;
errors state what failed and the actionable next step without exposing internal
paths, stacks or secrets. Empty states explain how content appears. Technical
identifiers use monospaced treatment only when they are genuinely identifiers.

Dates, money, usage and byte quantities are formatted through shared helpers.
Raw provider/backend codes are mapped to stable user-facing language.

## Accessibility

Every interactive element is keyboard reachable and has a programmatic name.
Focus is visible and returns sensibly when menus/dialog-like surfaces close.
Pressed, selected, expanded, busy, invalid and live-status state use the
relevant ARIA semantics. Color never carries the only distinction.

Semantic headings preserve hierarchy. Lists/tables expose structure. Streamed
updates avoid continuously stealing focus or flooding assertive live regions.
Reduced-motion preferences are respected for nonessential animation.

## State completeness

Every surface accounts for applicable loading, empty, success, error,
disabled, selected/pressed, offline/reconnecting and stale-cache states. Server
snapshots remain authoritative; optimistic UI must converge or roll back.
Browser-owned PWA installation/update/permission prompts use honest fallback
instructions instead of simulated native state.

## Automated enforcement

`npm run ui:check` parses production TSX and rejects:

- raw `button`, `input`, `select` and `textarea` outside `controls.tsx`;
- hand-written `role="menu"` shells;
- duplicate accent focus-border/focus skins;
- visual skin utilities passed through protected primitive `className`;
- literal hex colors in production TSX.

The check runs before TypeScript and in the full gate. Primitive behavior and
accessibility need component tests. Responsive overflow, touch reachability,
safe-area behavior and real assistive technology require browser/device review;
DOM tests alone do not prove them.

## Change checklist

Before shipping a visual change:

1. reuse an existing primitive/variant or add a typed reusable one;
2. use semantic tokens in both themes;
3. put visible text in i18n;
4. cover loading/empty/error/disabled/selected states;
5. verify keyboard, accessible naming and focus lifecycle;
6. check narrow phone, installed-window and wide layouts;
7. check long real content and larger font preference;
8. update `docs/ui-style-guide.md` when the system changes;
9. run UI checks, focused tests and the full gate.
