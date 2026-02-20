# bun-react-tailwind-template

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

To run tests:

```bash
bun test
```

To run the interactive location persistence TUI:

```bash
bun run tui
```

Menu shortcuts:

- Top-level menu: `Exit` option, `Esc` also exits.
- Child feature menus: `Back` option, `Esc` also goes back one level (for `location`, Back returns to feature selection).

To bypass the app-feature menu and jump directly into location persistence:

```bash
bun run tui location
```

## Persisted location API

- `GET /api/locations/persisted`
- `POST /api/locations/persisted` with JSON body `{ "name": string, "lat": number, "long": number, "nickname"?: string }`
- `DELETE /api/locations/persisted/:id`

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
