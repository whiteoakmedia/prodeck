# Localization care

The initial presentation target is Latin American Spanish (`es-419`). This is an
incremental migration, not a claim that the whole application is translated.

## Run the protection

From the repository root:

```sh
npx vitest run src/__tests__/localization.test.tsx src/__tests__/localizationProtection.test.ts
npx tsc --noEmit
npx vitest run
npx vite build
```

The existing Vitest runner discovers these tests without a package change.

## Registered coverage

The manifest in `src/lib/localizationProtection.ts` covers **only**:

* `src/lib/dialogs.tsx`
* `src/components/wizard/WizardShell.tsx` (including unchanged `LevelBar`)

Checked-in source projections in `src/__tests__/fixtures/localization/` preserve
the original AST, omitting comments. The guard compares TypeScript AST structure,
not a global string replacement or DOM rewrite. Comments and ordinary code
indentation are ignored. Outside reviewed slots, all JSX text is preserved
conservatively, even indentation. Only multiline ASCII space/tab indentation
that React does not render is ignored when recognizing catalog children;
single-line spaces and non-ASCII whitespace are not discarded. All executable
nodes, identifiers, option values,
callbacks, types, API arguments, imports and unreviewed presentation remain fixed.
Only these reviewed slots may differ:

* Dialog default `OK` argument and text-dialog `OK`: a literal string or the exact
  `uiText.ok` reference. Caller-supplied `okLabel` is not a slot.
* Dialog Cancel button children: literal JSX text or exactly `uiText.cancel`.
* Wizard Close and Back button children: literal JSX text or exactly
  `uiText.close` and `uiText.back` respectively.
* Wizard step heading: literal text around the original `at + 1` and
  `steps.length` expressions, or exactly `uiText.step(at + 1, steps.length)`.
* One exact named `uiText` import from each file's reviewed relative path.

No arbitrary expressions are allowed inside copy slots. Added imports, routing,
option values and action/command arguments (including `page_ack`) are exercised by
negative mutation tests. Shared files contain no routing commands themselves;
those mutations demonstrate rejection, not coverage of the application's router.
Unknown files fail registration checks. There is no automatic baseline update
mode. Baseline changes are code changes requiring manual review against the
previous projection and intended behavior, not a way to make a failure green.

The catalog is static and typed in `src/lib/uiText.ts`. Its glossary and retention
list are pinned by tests, and mounted React DOM tests exercise shared returns,
callbacks, queueing, cancellation, supplied values and rendered controls.
The guard, tests, catalog and baseline fixtures themselves require ordinary code
review. This is bounded regression evidence, not proof of all platforms, pixels,
interaction paths or unregistered files. Native builds, layout and visual quality
need separate checks. The completed first slice migrated only the two components
listed above.

### Navigation and widget catalog slices

`src/__tests__/localizationNavigation.test.tsx` registers App navigation and
NeedsConnection with explicit copy slots and frozen AST hashes. Its 36 tests
passed in the writer and parent integration runs. After the human-authorized
preparation repair, isolated verification passed 36 project tests, 38 independent
public-boundary tests, four baseline-provenance checks and 19 negative mutations.
Earlier dependency-copy timeouts remain recorded in the feature log; they are
not counted as successful test runs.

`src/__tests__/localizationWidgets.test.ts` registers widget registry metadata,
previews, Dashboard picker presentation and the display-only widget group map;
the companion TSX file exercises the catalog and picker. Independent probes
found that reviewed Dashboard copy slots accepted surrounding nonbreaking
whitespace. The human-authorized continuation reproduced six failures and
corrected the projector without changing production or frozen hashes. It now
compares exact fixture spaces and ignores only nonrendered multiline ASCII
indentation. Parent checks passed: 26 structural tests, all 713 suite tests,
TypeScript and diff-check. The six companion interaction tests skipped by the
focused structural name filter all ran in the full suite.

After the human-authorized preparation repair, isolated widget verification
passed all 32 project tests and 15 independent assertions. The six previously
reported whitespace escapes reject; harmless multiline ASCII indentation passes;
original baseline and candidate hashes and exact inline fixture spaces match.
No remaining blocker was found in this bounded recheck.

These are bounded functional and structural results, not native review approval
or visual/mobile/kiosk/native-platform evidence. Those platform checks remain
separate; passing tests does not claim complete application localization.

These tests use checked-in projections under `fixtures/localization/`, never
Git history at test runtime. Finish the bounded correction and missing
independent checks before closing the second slice.

## Approved glossary

Apply terms by context, never by replacing substrings in user or technical data.

| Source/context | Semantic key | es-419 |
| --- | --- | --- |
| Program or church Service | `program` / `service` | Evento |
| Auto Follow | `autoFollow` | Seguimiento automático |
| Confidence Banner | `confidenceBanner` | Aviso al escenario |
| Run Order (Now/Next) | `runOrderNowNext` | Ahora y siguiente |
| Run-of-Show Timing | `runOfShowTiming` | Tiempos del Crono |
| Show Flow | `showFlow` | Orden del evento |
| Rundown | `rundown` | Crono |
| Now, short heading | `nowHeading` | Ahora |
| Now, item state | `nowItemState` | En curso |
| Next | `next` | Siguiente |
| Automix Hold / Release only | `automixHold` / `automixRelease` | Pausar automatización / Reanudar automatización |
| Crew / Team | `crew` / `team` | Equipo |
| Booth | `booth` | Cabina |
| Stage | `stage` | Escenario |
| Page / Paging | `page` / `paging` | Aviso / Enviar aviso |
| Routing | `routing` | Ruteo |
| Wizard Setup | `setup` | Configuración inicial |
| Sound desk / Console | `soundDesk` / `console` | Consola de audio |
| Command Center | `commandCenter` | Centro de control |
| Dashboard | `dashboard` / `dashboardExpanded` | Panel / Panel de control (for clarity) |
| Settings | `settings` | Configuración |
| Devices | `devices` | Dispositivos |
| Equipment | `equipment` | Equipamiento |

Retain the distinct terms **Props**, **Clear**, **Automix**, **Home**,
**Checklist** and **Tally**. Use the app's spelling Automix, not the speech
transcription Auto Mix; Clear and Automix are not one combined label.
Tally may have explanatory text when its surface is migrated. Do not extend
context-specific Automix or church-event terminology to technical services or
unrelated uses.

The separate Now keys must not be merged: a short heading is Ahora, while an
item state is En curso. Run Order (Now/Next), Run-of-Show Timing and Show Flow
are distinct source terms, not generic timer or running-order substitutions.
The unused ambiguous `now`, `timerTimes` and `runningOrder` keys were replaced
by the explicit keys above. Unused generic `onAir`, `messages`, `pause` and
`resume` entries were removed rather than treating them as approved specialized
domain mappings. No component consumers are changed by this glossary correction.

## Boundaries

Translate only application-owned presentation. Keep internal/API/config/storage
identifiers, brands, protocols, diagnostics, imported paths, existing saved data,
integration content and user-entered content unchanged. Preserve clock and
timezone behavior. In this slice, titles, step labels/IDs, wizard content/actions,
confirm custom labels and text input values belong to callers and pass through
verbatim. No navigation, other components, dependency, release or config changes
are part of this migration. Do not use DOM-wide rewriting or persisted migrations.

## Contributor loop

1. Read this rule and the feature spec. Identify the precise owned presentation
   slots and preservation boundary before editing.
2. Write behavior tests first. Observe RED for requested visible changes and
   unsafe mutation cases before implementing. Mount interactive controls and
   assert exact dynamic values, return values and callbacks as well as copy.
3. Update registered coverage for each new slice with a manually reviewed
   baseline/projection and narrowly scoped slots. Never claim unregistered file
   coverage. Do not loosen the guard to swallow executable changes.
4. Implement the minimum presentation change. Reuse the glossary by context.
   Preserve existing behavior and compare shared consumers with the base when
   touching shared helpers. Review baseline changes manually and separately from
   copy changes; never regenerate them automatically.
5. Run focused tests, then TypeScript, the full suite and Vite build using the
   commands above. Report actual failures, timeouts and missing evidence.
6. Visually check desktop and browser surfaces, long labels, small screens,
   focus/keyboard behavior and accessibility. Native/generated surfaces need
   platform-specific evidence when they are migrated. Record checks not performed
   rather than asserting a guarantee.
