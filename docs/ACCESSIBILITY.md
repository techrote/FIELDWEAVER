# Accessibility and keyboard operation

FIELDWEAVER is a dense creative instrument, but its ordinary controls must remain operable without a pointing device and must expose useful native semantics. This document records the FW-014 audit and the current keyboard contract.

## Audit findings and corrections

The existing shell already provided a first-focus skip link, visible `:focus-visible` outlines, explicit labels for inputs/selects/textareas, textual button labels, live status outputs, sufficient dark-theme foreground separation, native form controls, and no essential decorative animation.

Two serious semantic defects were corrected for 0.11.0:

1. The preview canvas used `role="application"`. FIELDWEAVER does not require a screen reader to enter a bespoke application-mode interaction model, so that role could create an avoidable navigation trap. The release layer normalizes the canvas to a labelled/described `region` while retaining focusability and keyboard shortcuts.
2. Field-layer controls were native buttons placed in a `listbox` and then overwritten with `role="option"`. That erased useful button semantics while retaining button behaviour. They are now normalized to ordinary buttons in a labelled `group`, with selected state exposed through `aria-pressed`.

FW-014 also adds an explicit focused-canvas keyboard authoring operation: with Paint or Erase selected, **Enter** paints/erases one brush sample at the current view centre. This complements the already keyboard-reachable field creation/reorder/enable/parameter controls and emitter **Add**-at-view-centre control.

## Keyboard map

| Key | Action |
|---|---|
| Tab / Shift+Tab | Move through native controls and the focusable preview region |
| P | Pan tool |
| B | Paint tool |
| E | Erase tool |
| V | Move-field tool selection |
| N | Place-emitter tool selection |
| M | Move-emitter tool selection |
| Space | Run/pause |
| `.` | Exactly one simulation tick |
| Shift+`.` | Configured exact multi-step count |
| R | Reset simulation to tick zero without changing the authored recipe |
| `+` / `-` | Zoom live noncanonical view |
| Arrow keys | Pan live noncanonical view |
| Enter while preview has focus and Paint/Erase is selected | Apply one brush stamp at view centre |
| Ctrl/Cmd+Z | Authoring undo |
| Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y | Authoring redo |

Native buttons remain activatable with browser-standard Enter/Space behaviour. Selects and numeric/text inputs retain platform-native keyboard editing.

## Core workflow without a pointer

A keyboard-only user can load any built-in preset; select/create/reorder/enable fields; edit field/material/emitter/LUT numeric controls; add an emitter at the current view centre; pan/zoom the view; apply paint/erase stamps at the current view centre; run/pause/step/reset; edit timeline events through native controls; Save/Load recipes; generate/restore mutation variants; frame/evaluate Infinite Plate crops through numeric inputs/buttons; and prepare/download canonical export artifacts.

Freehand multi-point painting and drag-to-position interactions remain substantially faster with a pointer. They are convenience paths rather than the only route to the core release workflow. Future richer spatial keyboard controls must not alter canonical model semantics.

## Focus, labels, and status

The first document control is **Skip to workspace**. Focus-visible state uses a high-contrast accent outline with offset. Controls created by the application use either wrapping `<label>` elements, explicit `aria-label`, or visible button text. Browser acceptance counts unlabeled interactive controls and fails if any are introduced.

Long-running Infinite Plate evaluation exposes textual progress and a Cancel button. Recipe/preset/export errors are placed in live textual status outputs rather than represented by colour alone. Selection states use text plus pressed/selected semantics, not colour alone.

## Motion and colour

FIELDWEAVER 0.11.0 has no essential CSS transition/animation sequence. The stylesheet already honors `prefers-reduced-motion` by preventing smooth-scrolling behaviour. Simulation artwork itself changes only while the deterministic transport runs; pause is always available and exact stepping is supported.

The release theme uses light text on near-black surfaces, explicit borders, and an accent that is never the sole carrier of state. Automated smoke verifies semantics/labels rather than attempting to substitute a machine-computed contrast score for visual review.

## Browser acceptance

Chrome and Firefox CI release smoke verifies that the normalized canvas is a described `region`, the field list is a labelled `group`, field buttons do not retain `role=option`, the preset controls are loaded, release diagnostics identify the canonical/noncanonical boundary, and a focused-canvas Enter stamp changes canonical authoring identity. The ordinary browser smoke independently rejects unlabeled controls.
