import "./index.css";
import { HomeClockPage } from "./pages/HomeClockPage";
import { RingRendererPage } from "./pages/RingRendererPage";

function normalizedPath(pathname: string): string {
  if (!pathname) {
    return "/";
  }

  return pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
}

export function App() {
  const path = normalizedPath(window.location.pathname);

  if (path === "/ring-renderer") {
    return <RingRendererPage />;
  }

  return <HomeClockPage />;
}

export default App;
