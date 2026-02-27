import "./index.css";
import { HomeClockTailwindPage } from "./pages/HomeClockTailwindPage";

export type AppRoute = "home-tailwind";

export function resolveAppRoute(pathname: string): AppRoute {
  void pathname;
  return "home-tailwind";
}

export function App() {
  resolveAppRoute(window.location.pathname);
  return <HomeClockTailwindPage />;
}

export default App;
