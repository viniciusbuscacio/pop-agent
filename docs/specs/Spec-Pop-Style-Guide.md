# Pop Agent — UI style guide index

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §14
**Canonical detailed guide:** [`../ui-style-guide.md`](../ui-style-guide.md)
**Primary code:** `web/src/ui/controls.tsx`, `web/src/styles/tokens.css`, `web/src/styles/index.css`

## Purpose

This focused spec places UI design in the internal architecture index. The complete primitive rules and examples live in `docs/ui-style-guide.md`; do not duplicate or fork that guide here.

## Core rules

- Pages compose typed primitives from `web/src/ui/controls.tsx`.
- Production pages do not render raw buttons, inputs, selects or textareas.
- Pages may pass layout classes, not a second visual skin.
- Semantic CSS variables own color, surface, radius and typography decisions.
- Literal production colors and duplicate focus treatments are forbidden.
- Icon-only actions have accessible names.
- Save flows have Cancel; forms do not move into side drawers.
- Emoji are not product icons.
- Specialized chat/files surfaces still use tokens and accessibility semantics.

## Responsive behavior

The PWA must work on phone, installed desktop windows and wide browsers. Responsive layout may change navigation and available width, but not create inconsistent controls. Font-size preferences must scale related controls consistently; avoid mixing fixed pixels and rem units for elements expected to stay visually aligned.

## Interaction states

Every control or surface must account for enabled, disabled, focus-visible, loading, empty, error and relevant selected/pressed states. Browser-native PWA installation and permission prompts remain browser-controlled and require honest fallback instructions.

## Enforcement

`npm run ui:check` runs `tools/check-ui-primitives.ts` and is part of typecheck/gate. It rejects forbidden native controls, duplicate focus classes, visual-skin utilities and literal colors. Component tests assert behavior and accessibility; visual/device checks cover layout cases that DOM tests cannot prove.

## Change checklist

Before introducing a new visual pattern:

1. check whether an existing primitive or variant fits;
2. add a typed primitive/variant if the need is reusable;
3. update `docs/ui-style-guide.md` when the design system changes;
4. use i18n strings;
5. test keyboard, screen-reader naming and narrow layouts;
6. run UI checks and the full gate.
