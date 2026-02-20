import { waitFor, createActor } from "xstate";
import { PersistedLocationStore, createTimeInPlaceService } from "./lib/time-in-place";
import { mainTuiMachine } from "./tui/main-tui.machine";
import { createInquirerUi } from "./tui/inquirer-ui";

async function run(): Promise<void> {
  const actor = createActor(mainTuiMachine, {
    input: {
      argv: process.argv.slice(2),
      service: createTimeInPlaceService(),
      store: new PersistedLocationStore(),
      ui: createInquirerUi(),
    },
  });

  actor.start();

  await waitFor(actor, snapshot => snapshot.matches("done") || snapshot.matches("failed"));

  const snapshot = actor.getSnapshot();
  if (snapshot.matches("failed")) {
    process.exitCode = 1;
  }

  actor.stop();
}

if (import.meta.main) {
  run().catch(error => {
    console.error(`Fatal error: ${String(error)}`);
    process.exitCode = 1;
  });
}
