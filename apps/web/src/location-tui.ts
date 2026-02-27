import { waitFor, createActor } from "xstate";
import { PersistedLocationStore, createSameSkyService } from "./lib/same-sky";
import { mainTuiMachine } from "./tui/main-tui.machine";
import { createInquirerUi } from "./tui/inquirer-ui";

async function run(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const verbose = rawArgs.includes("--verbose");
  const argv = rawArgs.filter(arg => arg !== "--verbose");

  const actor = createActor(mainTuiMachine, {
    input: {
      argv,
      verbose,
      service: createSameSkyService(),
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
