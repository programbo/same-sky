# TUI Statechart Design Artifacts

## Boundary and Decomposition Decision Record

- Split into two machines:
  - `mainTuiMachine`: app-level feature selection and orchestration.
  - `locationManagementMachine`: location persistence workflow.
- Reasoning:
  - Different responsibilities and lifecycles.
  - Main app flow should remain thin as new test features are added.
  - Location workflow owns domain-specific prompts and persistence operations.
- Orchestration rule:
  - Main machine invokes location machine as a child actor and waits for completion.

## Machine 1: mainTuiMachine

### State Inventory

- `entry`: decides whether CLI args bypass menu.
- `featureMenu`: prompts user to choose a feature to test.
- `locationFeature`: runs the location workflow machine.
- `done`: final.
- `failed`: final error state.

### Event Catalog

- External:
  - `{ type: 'FEATURE.LOCATION' }`
  - `{ type: 'FEATURE.EXIT' }`
- Internal done/error:
  - `xstate.done.actor.featureMenuPrompt`
  - `xstate.done.actor.locationWorkflow`
  - `xstate.error.actor.featureMenuPrompt`
  - `xstate.error.actor.locationWorkflow`

### Transition Table

| From | Event | Guard | Actions | To |
|---|---|---|---|---|
| `entry` | (always) | `bypassLocationFromArg` | `printBypassNotice` | `locationFeature` |
| `entry` | (always) | - | `printMainIntro` | `featureMenu` |
| `featureMenu` | done(prompt) | `selectedExit` | `printExitSelected` | `done` |
| `featureMenu` | done(prompt) | `selectedLocation` | `printFeatureLaunch` | `locationFeature` |
| `featureMenu` | error(prompt) | - | `setFatalError` | `failed` |
| `locationFeature` | done(child) | - | - | `featureMenu` |
| `locationFeature` | error(child) | - | `setFatalError` | `failed` |

### Async/Actor Map

- `featureMenuPrompt`: `fromPromise` using `@inquirer/prompts.select`.
- `locationWorkflow`: child actor from `locationManagementMachine`.

### Acceptance Scenarios

1. Start with no args -> shows feature menu -> choose Location persistence -> runs location flow -> Back returns to feature menu.
2. Start with arg `location` -> bypasses menu -> runs location flow -> Back returns to feature menu.
3. Selecting Exit (or pressing Esc in menu) completes the app.
4. Menu prompt error -> machine reaches `failed` with message.

## Machine 2: locationManagementMachine

### State Inventory

- `menu`: prints feature banner + prompt for location actions.
- `lookupQuery`: prompt search query.
- `lookupRun`: invoke location lookup.
- `chooseResult`: auto-select one result or prompt if many.
- `nicknamePrompt`: prompt nickname with default query.
- `persistRun`: save selected location.
- `viewRun`: list persisted locations.
- `removeLoad`: load persisted locations for deletion.
- `removeChoose`: checkbox multi-select for removal.
- `removeRun`: remove selected ids.
- `done`: final.
- `failed`: final error state.

### Event Catalog

- External:
  - `{ type: 'LOCATION.BACK' }`
  - `{ type: 'LOCATION.MENU.LOOKUP' }`
  - `{ type: 'LOCATION.MENU.VIEW' }`
  - `{ type: 'LOCATION.MENU.REMOVE' }`
- Internal done/error from invoked actors:
  - prompt done/error for menu/query/result/nickname/remove selection
  - operation done/error for lookup/list/persist/remove

### Transition Table

| From | Event | Guard | Actions | To |
|---|---|---|---|---|
| `menu` | done(prompt) | `menuChoiceLookup` | - | `lookupQuery` |
| `menu` | done(prompt) | `menuChoiceView` | - | `viewRun` |
| `menu` | done(prompt) | `menuChoiceRemove` | - | `removeLoad` |
| `menu` | done(prompt) | `menuChoiceBack` | `printLocationExit` | `done` |
| `lookupQuery` | done(prompt) | `emptyQuery` | `printEmptyQuery` | `menu` |
| `lookupQuery` | done(prompt) | - | `storeQuery` | `lookupRun` |
| `lookupRun` | done(invoke) | `lookupNoResults` | `storeResults`, `printNoResults` | `menu` |
| `lookupRun` | done(invoke) | - | `storeResults` | `chooseResult` |
| `chooseResult` | (always) | `hasSingleResult` | `autoSelectResult` | `nicknamePrompt` |
| `chooseResult` | done(prompt) | `resultCancelled` | `printCancelled` | `menu` |
| `chooseResult` | done(prompt) | - | `storeSelectedResultFromPrompt` | `nicknamePrompt` |
| `nicknamePrompt` | done(prompt) | - | `storeNickname` | `persistRun` |
| `persistRun` | done(invoke) | - | `storeLastPersisted`, `printPersisted` | `menu` |
| `viewRun` | done(invoke) | - | `storePersistedList`, `printPersistedList` | `menu` |
| `removeLoad` | done(invoke) | `noPersistedForRemove` | `storePersistedList`, `printNoPersistedToRemove` | `menu` |
| `removeLoad` | done(invoke) | - | `storePersistedList` | `removeChoose` |
| `removeChoose` | done(prompt) | `noSelectionMade` | `printCancelled` | `menu` |
| `removeChoose` | done(prompt) | - | `storeSelectedRemovalIds` | `removeRun` |
| `removeRun` | done(invoke) | - | `storeRemovalOutcome`, `printRemovalOutcome` | `menu` |
| any invoke/prompt state | error(actor) | - | `setFatalError` | `failed` |

### Async/Actor Map

- Prompt actors (`fromPromise`):
  - action menu select
  - lookup query input
  - lookup result select
  - nickname input
  - remove checkbox
- Operation actors (`fromPromise`):
  - lookup locations
  - persist add
  - list persisted
  - remove selected persisted ids

### Acceptance Scenarios

1. Lookup -> single result -> auto-select -> nickname defaults to query -> persisted entry saved.
2. Lookup -> multiple results -> cursor selection prompt -> persist selected.
3. View persisted -> prints formatted list and returns to menu.
4. Remove persisted -> checkbox multi-select -> selected ids deleted.
5. Remove persisted with no items -> informative message and return to menu.
6. Menu Back exits location workflow and returns done to main app.
7. Pressing Esc in location actions is treated as Back.
