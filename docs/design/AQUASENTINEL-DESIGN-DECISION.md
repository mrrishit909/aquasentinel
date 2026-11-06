# AquaSentinel landing: design decision

Date: 2026-11-06. Scope: root `index.html` and `app/landing.css` only. The workbench (`app/index.html`, `app/styles.css`, `app/app.js`, `app/ui.js`) is unchanged.

Inputs read: Atlas `AGENTS.md`, `DESIGN-STANDARDS.md`, `docs/design/VISUAL-DIRECTIONS.md`, `docs/specs/AQUASENTINEL-VERTICAL-SLICE.md`, `fixtures/index.js`, `src/rules.js`, `scripts/build.mjs`, `scripts/serve.mjs` (CSP `default-src 'self'`, no inline script), and the previous landing (generic text, two cards and a table). Website-playbook guidance and its rubric were applied by the orchestrator (Codex) and supplied in the brief.

## Three directions considered

1. **Midnight passive infrastructure console (chosen).** A dark engineering drawing sheet, "Sheet AS-01", with grid zones, a title block and numbered general notes. Its hero image is an original reconciliation schematic. The asset register sits on the left, path IDs on the right, and a linear UTC time scale runs through the middle. Approved paths are drawn in a register layer (cyan, solid). Imported observations are drawn in a separate imported layer (brass rings, dashed pairings). The two layers never share a line.
2. **Hydrologist's field ledger.** Paper ground, serif display face, ruled ledger rows and margin annotations. It is warm and readable, but it is already the workbench's visual system (`app/styles.css`). Reusing it for the landing would give the product no distinct front door. It also tells the story as a list rather than a picture.
3. **Audit specimen book.** A catalogue in which each observation is a specimen plate with a caption and rule tags. It is good for single-finding detail but weak at showing the relationship between approval windows and observation times, which is the whole point of the rule pack. It also drifts toward a card grid.

## Why direction 1

- The domain question is spatial and temporal: does this observation sit on an approved path, inside its window, before the stale threshold? A drawing that places every mark from fixture timestamps answers that at a glance. Direction 1 is the only one where the picture *is* the evidence.
- It keeps the two kinds of data visibly separate (register vs imported). This is the honest framing for a passive reconciliation tool.
- A drawing sheet is native to water-infrastructure work (schematics, title blocks, general notes) without borrowing the hacker-console or alarm-panel look. There are no red states, no severity colours, no radar sweeps and no "live" signals.

## Distinctness from other Atlas projects

| Product | Hero idea | This landing differs by |
|---|---|---|
| PayGuard | ivory document desk, registration lines | dark sheet; a time-scaled schematic, not a document fragment |
| OriginProof | cartographic route on paper | no geography; orthogonal lanes and terminals, with time as the x axis |
| DisputeRadar | obsidian signal desk, scenario delta | no metrics chart; marks are discrete, sourced from records |
| TraceChain / PharmaLedger | flow-led editorial narratives on cream | engineering sheet structure: zones, title block, numbered notes |

Typography also differs. It uses a condensed engineering grotesque from system fonts (DIN Alternate on macOS, Bahnschrift on Windows, falling back to Arial Narrow and then system-ui) with a monospace face for every identifier.

## System

- **Colour roles (5 + neutrals).** Night ground `#0B1D22` and deck `#10272D`. Ink `#E4EEEB` and muted `#93ABA9`. Register cyan `#6CC5CE`: approved paths and windows. Imported brass `#E2B45C`: observations and the primary action. Paper `#E3EBE7`: pale instrument plates (title block, totals readout, hand-off band), always with night text and a night focus ring. There is no red, and brass means "imported", never "bad". O1 (structurally consistent) is drawn in ink, not brass, so the one clean observation reads apart from the four flagged ones. Computed contrast on night: ink ≈ 15:1, muted ≈ 7.2:1, cyan ≈ 8.8:1, brass ≈ 9.3:1. Night text on brass is the CTA at ≈ 9.3:1. These are computed values, not yet measured in a browser.
- **Non-colour encoding.** Register is solid (lines, node outlines, the solid underline on "approved"). Imported is dashed (pairings, A9/V9 outlines, the dashed underline on "observed"). Layers stay distinguishable without colour.
- **Type scale.** h1 `clamp(2.6rem, 1.3rem + 5.4vw, 6.25rem)` at line-height 0.95. h2 `clamp(1.75rem, 1.1rem + 2.2vw, 2.9rem)`. Body 1.0625rem/1.6. Eyebrows in mono 0.75rem with 0.16em tracking. Numerals use tabular figures.
- **Schematic accuracy.** Landscape scale is 5 units = 1 h, with x = 340 at 2026-11-01T00:00Z. Snapshot 11-03 12:00Z sits at 640. The stale edge (snapshot minus 86,400 s) sits at 520. O5 sits at 515 (1 h older than the edge, 90,000 s). O1, O2 and O3 sit at 635, and O4 at 630. P1's window spans 340-700 and P2's 340-460, so O4 sits clearly after P2 ends. Portrait scale is 4 units = 1 h, x = 40 at 11-01. Every mark and count comes from `fixtures/index.js` and the spec oracle: 5 observations, 4 flagged, 1 structurally consistent, 6 evidence gaps (NO_APPROVAL 2, UNKNOWN_ASSET 1, OUTSIDE_APPROVAL_WINDOW 1, OWNER_MISSING 1, STALE_OBSERVATION 1, AMBIGUOUS_APPROVAL 0).
- **Phone.** At 640px and below, a separate portrait drawing replaces the landscape one. It has four stacked lanes on a shared time scale, readable at 390px without zoom. The observation schedule stacks each observation as its own block. Only one drawing is ever displayed, and the hidden one is `display:none`.
- **Motion (CSS only, three moments).**
  - The sheet assembles once on load: time frame, then register layer, then imported layer. This uses opacity plus a 6px lift.
  - Each later section rises once on entering view, via `animation-timeline: view()` where supported.
  - Hovering an observation in the schedule enlarges its marker on the sheet (`:has()`).
  - All start-hidden states live inside `prefers-reduced-motion: no-preference`, and the scroll reveal also sits inside `@supports`. Without motion, everything is simply visible.
  - Only transform and opacity are animated, and dimensions are reserved by the SVG viewBox.
- **Accessibility.**
  - There is a skip link, plus visible `:focus-visible` rings in brass.
  - Each drawing is a `role="img"` with a title and a full text description. The same facts appear in the HTML schedule.
  - Headings follow document order, and the static synthetic banner carries no live-region role.
- **Constraints honoured.** No scripts, fonts, images, dependencies or external links on the landing. All links are relative (`./app/`, in-page anchors), so the page works under a GitHub Pages project path.

## Known seam

The workbench keeps its paper "field ledger" styling (direction 2). This pass was barred from changing app styles. The landing ends on a pale hand-off band that previews that change of material before the CTA. Unifying the two is a later, separate decision.

## Browser evidence and rubric status (honest)

`npm run build` passed. Inspected Chrome screenshots at 1440×1000, 768×1024 and 390×844; the desktop frame and dedicated phone plate were also inspected scrolled into view. Document/body width measurements were 1425/1425 (desktop, scrollbar), 768/768 (tablet) and 390/390 (phone). The separate portrait plate visibly includes all four lanes and five observations. All workbench CTAs resolve to `/aquasentinel/app/` in the local project-path preview. No tests were run.

| Criterion | Status | Evidence inspected / remaining correction |
|---|---|---|
| Point of view | Strong | The instrument drawing sheet, time axis and separated evidence layers are visible in the desktop and phone renders; Codex visual review. |
| Typography | Mixed | Engineering sans and monospace labels render distinctly. Small SVG labels at phone size need a dedicated legibility pass. |
| Colour | Mixed | Night/cyan/brass roles are coherent in renders; contrast figures were computed from tokens but not instrumentally measured. |
| Hierarchy | Strong | Hero, primary CTA and evidence drawing form a clear first read on desktop and phone. |
| Imagery | Strong | Original landscape and portrait schematics render; the text description and equivalent observation schedule are present. |
| Motion | Unverified | CSS-only entrance and hover treatments plus reduced-motion rules exist, but actual motion and reduced-motion states were not recorded. |
| Mobile | Mixed | 390px no-overflow measurement, full phone plate and top-of-page screenshot inspected; lower-page phone flow and touch targets need further review. |
| Invisible quality | Mixed | Production build and relative links verified; keyboard-only navigation, measured contrast, axe, console, performance, Safari/Firefox and live Pages remain unchecked. |
