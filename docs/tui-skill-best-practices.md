# TUI Skill Best Practices (Clerc + Inquirer)

This is a living document for future TUI skill development.

How to maintain this file:
- Add new findings in the `Refinement Log` section when UX behavior is improved or corrected.
- Keep entries concrete: root cause, user impact, fix, and reusable rule.
- Prefer patterns that work in real TTY sessions and automated tests.

## Core TUI Principles

- Keep navigation predictable:
  - Top-level menu includes `Exit`.
  - Child menus include `Back`.
  - `Esc` should map to the same intent as `Exit` or `Back`.
- Make cancellation explicit and safe:
  - Cancelled prompts should not perform writes or destructive actions.
- Keep prompt ownership local:
  - The component/actor opening a prompt should print its own header/context text.
  - Avoid parent-level logging around child prompt startup (prevents output ordering races).
- Prefer consistency over novelty:
  - Same key behaviors, labels, and status messages across all feature menus.

## Clerc Best Practices

- Use Clerc as the command-router, not as business-logic storage:
  - Keep command handlers thin.
  - Delegate behavior to feature modules or state-machine actors.
- Define a stable command hierarchy early:
  - Root command for app-wide actions.
  - Subcommands for feature flows (for example: `location`, `timezone`, `debug`).
- Support both interactive and scripted modes:
  - Interactive default (TTY).
  - Non-interactive flags/options for automation and CI.
- Validate input at command boundaries:
  - Fail fast with clear error messages.
  - Normalize options before passing to feature logic.
- Exit codes must be meaningful:
  - `0` for success.
  - Non-zero for validation failures, runtime failures, or aborted required flows.
- Keep stdout/stderr discipline:
  - User-facing results on stdout.
  - Diagnostics and errors on stderr.
- Build for extensibility:
  - Command registration should make adding new feature modules low friction.

## Inquirer Best Practices

- Always provide semantic exits in choices:
  - Include explicit `Exit` and `Back` options in menus.
- Always support `Esc` abort:
  - Wire prompt `AbortSignal` and map abort to safe fallback values.
  - `Esc` in checkbox/multi-select should abort the operation and return to prior menu.
- Customize key legends so behavior is discoverable:
  - Append `esc exit`, `esc back`, or `esc abort` to inquirer key help tips.
- Use prompt-specific fallbacks:
  - App menu abort -> `exit`.
  - Child menu abort -> `back`.
  - Selection prompt abort -> null/empty selection.
- For multi-select deletion flows:
  - Abort should preserve all data.
  - Empty selection should be treated as a no-op with a clear message.
- Keep large lists usable:
  - Set page size intentionally.
  - Add concise descriptions (coordinates, IDs, or metadata) for disambiguation.

## XState + TUI Integration Patterns

- Use separate machines for app orchestration and feature workflows.
- Keep statechart design artifacts in-repo before implementation.
- Let the machine actor that invokes a prompt own pre-prompt text rendering.
- Convert prompt output into explicit event-driven transitions.
- Map abort/cancel outputs to explicit states (`back`, `done`, no-op) rather than exceptions.

## Testing Guidance

- Add actor tests for each important navigation outcome:
  - top-level exit
  - child back
  - bypass argument routing
  - aborted multi-select
- Test write safety on cancellation:
  - aborted operations should not persist changes.
- Run both unit tests and at least one PTY/manual smoke check for prompt behavior.

## Refinement Log

### 2026-02-20

- Issue: prompt headers appeared after interactive menus.
  - Root cause: parent-level logs interleaved with child prompt rendering/repaint.
  - Fix: moved pre-prompt headers and context text into the same actor that invokes each prompt.
  - Reusable rule: prompt-owning actor prints prompt context immediately before invoking prompt.

- Issue: Back in location workflow exited the app instead of returning to feature selection.
  - Fix: changed main machine transition from child `done -> featureMenu` (not `done`).
  - Reusable rule: child feature `Back` should move up exactly one navigation level.

- Issue: Esc behavior was implied but not discoverable in legend text.
  - Fix: customized inquirer key help tips to include `esc exit/back/abort`.
  - Reusable rule: if a key is meaningful, show it in the prompt legend.
