import { createServer } from "../src/index"

const port = Number(process.env.PORT ?? 4173)
const server = createServer({ port })

console.log(`Playwright server listening at ${server.url}`)

const shutdown = () => {
  server.stop(true)
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

await new Promise(() => {
  // Keep the process alive while Playwright runs.
})
