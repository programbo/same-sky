import "./index.css";
import { HomeClockPage } from "./pages/HomeClockPage";
import { HomeClockTailwindPage } from "./pages/HomeClockTailwindPage";
import { RingRendererPage } from "./pages/RingRendererPage";

function normalizedPath(pathname: string): string {
  if (!pathname) {
    return "/";
  }

  return pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
}

export type AppRoute = "home-tailwind" | "home-css" | "ring-renderer";

export function resolveAppRoute(pathname: string): AppRoute {
  const path = normalizedPath(pathname);

  if (path === "/with-css") {
    return "home-css";
  }

  if (path === "/ring-renderer") {
    return "ring-renderer";
  }

  return "home-tailwind";
}

export function App() {
  const route = resolveAppRoute(window.location.pathname);

  if (route === "ring-renderer") {
    return <RingRendererPage />;
  }

  if (route === "home-css") {
    return <HomeClockPage />;
  }

  return <HomeClockTailwindPage />;
}

export default App;
