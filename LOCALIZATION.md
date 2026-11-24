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

`localizationPosterJoin.test.ts` compares the join screen with its reviewed
baseline, permitting only the listed presentation substitutions. Form validation
messages are checked by `posterJoin.test.ts`; dynamic server errors pass through.
`localizationBackToChurches.test.ts` protects the return link and its destination.
`localizationChatPanel.test.ts` protects reviewed chat copy, option values,
message data and action wiring against its source baseline; a mounted test
checks routing and preserves typed messages. `localizationChatDrawer.test.ts`
protects the adjacent drawer presentation and actions.
`localizationCrewPages.test.ts` checks the reviewed page composer, takeover and
tracking copy against their baseline; `pageReach.test.ts` checks reach wording.
`localizationCrewChannels.test.ts`, `localizationCrewChat.test.ts` and
`localizationCrewChecklist.test.ts` protect reviewed mobile copy against source
baselines while preserving identifiers, user text and action wiring.
`localization-CrewHome.test.ts`, `localization-fmt.test.ts` and
`localization-checklistStore.test.ts` protect reviewed home, time and recurring
task descriptions against baselines; dates and schedule values are unchanged.
`localizationCrewWalk.test.ts` protects the mobile routing help introduction;
`localizationRoutingWalk.test.ts` protects the shared routing picker and
walkthrough presentation. `localizationAskPanel.test.ts` and
`localizationStagePockets.test.ts` protect their reviewed copy. The assistant
requests Spanish answers while preserving tool contracts and citation syntax;
`assist.test.ts` checks this instruction and the fallback. Generated routing diagnostics use a Spanish display mode tested by
`routingSpanish.test.ts` and protected by `localizationRoutingSpanish.test.ts`;
the assistant retains its existing default output and map-provided data pass
through unchanged. Built-in routing steps and unchanged default rules are translated at display
time; edited rules and map steps remain verbatim. Tests cover both cases.
`localAddress.test.ts` checks localized address states and validation while the
worker retains its existing validation messages and rules.

`localizationGiftCredit.test.ts` compares GiftCredit against a checked-in
baseline with only its two reviewed visible strings replaced. It preserves the
remaining source exactly, including links and callbacks. The baseline requires
manual review when the component intentionally changes.

`localizationPlanningCenter.test.ts` protects the initial Planning Center copy
slice by comparing the full source against a checked-in baseline with explicitly
reviewed substitutions. The rest of the page is not yet translated; intentional
future changes require manual review of the baseline and the protected slots.

`localizationSetup.test.ts` protects the reviewed Setup page copy against a
checked-in baseline. Shared HealthStrip descriptions are covered separately by
`localizationHealthStrip.test.ts`; dynamic diagnostics require contextual review.

After the later terminology review, the widget catalog aligns the reviewed
stage-message, sound-console and task-list labels and descriptions. The
structural and mounted catalog checks cover those changes. This does not imply
that the contents of the widgets are localized.

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

User terminology review (2026-11-19): use **Proponer una función** for the
action that opens the feature request form.
Use **Reportar un error** for the action that opens the bug report form.
Use **Actualizar y reiniciar** for the available-update action; the current
App copy has been aligned.
Use **Cerrar** for the action that dismisses an on-screen notice. App notice
controls have been aligned; review other surfaces by context.
Use **Modo demo** for the sample-data mode; App and ErrorBoundary are aligned.
Use **Control** for the technical team's physical booth, replacing the previous
approved term “Cabina”; existing translations need contextual review and alignment.
The user reconfirmed **Equipo** for the group working on the event.
The user reconfirmed **Crono** for the event running order and **Enviar aviso**
for paging a team member. Use **Panel de control** for the main dashboard;
existing “Panel” labels need alignment in a tested slice.
The user reconfirmed **Configuración** for Settings. For an interrupted
ProPresenter connection, use **Se perdió la conexión con ProPresenter**;
apply only where an established connection was actually lost.
Use **Primeros pasos** for the first-run setup guide, superseding the earlier
“Configuración inicial” choice in that context; review existing copy in a tested slice.
Use **Pantalla Retorno** for the display providing supporting information to
people on stage; apply by context rather than replacing technical identifiers.
Use **Aviso en Pantalla Retorno** for Confidence Banner, replacing the earlier
“Aviso al escenario” decision; align catalog, assertions and existing copy in a tested slice.
The user reconfirmed **Pausar automatización** for pausing Automix and chose
**Automático** for the automatic mode, and **En curso** for the state of the
currently running song or event item.
Use **Próximo** for the next item in the Crono, replacing the earlier
“Siguiente” choice in that context; review labels and tests before alignment.
Use **En curso y próximo** for the section showing the current and next Crono
items, replacing the earlier “Ahora y siguiente” decision in that context.
The user reconfirmed **Tiempos del Crono** and chose **Un momento…** for
general waiting states. Keep specific progress messages when they convey useful
information, and review affected copy and tests in a subsequent slice.
Use **Reintentar** for an action that attempts a failed operation again; App's
updater is aligned, and other controls remain to review.
Use **Guardar cambios** for saving edits made in Configuración.
Use **Salir sin guardar** to confirm leaving with unsaved settings and
**Cancelar** to cancel an action and return without applying changes.
Use **Finalizar** to confirm completion of a task; review existing “Listo”
controls by context in a tested slice.
Use **Agregar integrante** and **Quitar integrante** for adding/removing team
members. Use **Lista de tareas** for the team's checklist, superseding the
earlier decision to retain Checklist; review existing copy and tests by context.
For task lists, use **Completada**, **Pendiente**, and **Plantilla** for a
completed task, a pending task, and a reusable list template respectively.
Use **Dispositivo** for a person's access device, **Equipamiento** for connected
audio/video equipment, and **Conectado** for a connected device's status.
Use **Sin conexión** for a disconnected device, **Buscar dispositivos** for
discovery, and **Reconectar** for attempting to reconnect a device.
Use **Consola de sonido** for the sound desk (replacing “Consola de audio”),
**Canal** for an audio channel, and **Mutear** for muting it.
Use **Desmutear** to restore a muted channel, **Nivel** for sound level, and
**Escena** for a saved sound configuration that can be recalled.
Use **Cargar escena** to recall a saved scene, **Ruteo** for audio routing,
and **Prueba de sonido** for checking microphones before the event.
Use **Proyección** for content displayed during the event, **Diapositiva** for
an individual slide, and **Pausar proyección** for temporarily pausing it.
Use **Reanudar proyección**, **Siguiente diapositiva**, and **Diapositiva
anterior** for resuming projection and navigating slides. “Próximo” remains
the user's choice for the next Crono item, not necessarily for other contexts.
Use **Playlist** for the ProPresenter playlist, **Letra** for a song's lyrics,
and **Avance automático** for automatically advancing lyrics. Review its
relationship to the previous generic Auto Follow choice by context.
Use **Integrante** for a team member with access, **Administrador** for the
administrator role, and **Contraseña** for the password used to sign in.
Use **Ingresar** to sign in, **Salir** to sign out, and **Tu sesión expiró.
Volvé a ingresar.** for an expired session. Align current copy and tests in a
subsequent tested slice.
Use **Solo lectura** for view-only access, **Dar acceso** to grant access,
and **Quitar acceso** to remove access.
Terminology review: retain **Setlist**, **Multiview**, **Tally**, **Macro**,
**Patch List**, **Patch Set** and **Virtual Sound Check**; use **Pantalla pública**
for kiosk, **Zócalo** for lower third, **Mensaje a escenario** for stage message,
**Asistencia** for crew check-in, **Reproducción para prueba de sonido** for
soundcheck playback, and **Estadísticas** for Analytics. Retain **Look** for the ProPresenter feature, as confirmed by the user. Patch Set was supplied by the user for patch sheet;
preserve that choice while confirming the actual feature context during implementation.

| Source/context | Semantic key | es-419 |
| --- | --- | --- |
| Program or church Service | `program` / `service` | Evento |
| Auto Follow | `autoFollow` | Seguimiento automático |
| Confidence Banner | `confidenceBanner` | Aviso en Pantalla Retorno |
| Run Order (Now/Next) | `runOrderNowNext` | En curso y próximo |
| Run-of-Show Timing | `runOfShowTiming` | Tiempos del Crono |
| Show Flow | `showFlow` | Orden del evento |
| Rundown | `rundown` | Crono |
| Now, short heading | `nowHeading` | Ahora |
| Now, item state | `nowItemState` | En curso |
| Next | `next` | Próximo |
| Automix Hold / Release only | `automixHold` / `automixRelease` | Pausar automatización / Reanudar automatización |
| Crew / Team | `crew` / `team` | Equipo |
| Booth | `booth` | Control |
| Stage | `stage` | Escenario |
| Page / Paging | `page` / `paging` | Aviso / Enviar aviso |
| Routing | `routing` | Ruteo |
| Wizard Setup | `setup` | Configuración inicial |
| Sound desk / Console | `soundDesk` / `console` | Consola de sonido |
| Command Center | `commandCenter` | Centro de control |
| Dashboard | `dashboard` / `dashboardExpanded` | Panel de control |
| Settings | `settings` | Configuración |
| Devices | `devices` | Dispositivos |
| Equipment | `equipment` | Equipamiento |

Retain the distinct terms **Props**, **Clear**, **Automix**, **Home**,
and **Tally**. Use the app's spelling Automix, not the speech
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

Mobile joining, install and notification presentation is protected by the
`localization-CrewJoinJoin`, `localization-CrewOnboardJoin`,
`localization-CrewNotifyStepJoin` and `localization-notifyStepJoin` tests.
Notification actions and timing remain covered by `notifyStep.test.ts`.

`localization-CrewNavNav.test.ts` and `localization-MobileShellNav.test.ts`
protect mobile navigation, account and notification copy against reviewed
baselines without changing keys, permissions or actions.
`localizationCrewOffline.test.ts` protects reviewed offline presentation;
the cloud copy timestamp line is covered by `crewCloud.test.ts`.
`localization-intercomComms.test.ts` and `localization-crewCloudComms.test.ts`
protect the reviewed messages without changing communication or date logic.
