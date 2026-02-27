export type MainlineMeta = Record<string, unknown> | null | undefined;

export interface MainlineShortcut {
  key: string;
  targetItemId?: string;
}

export interface MainlineCommand {
  id: string;
  label: string;
  subtitle?: string;
  keywords?: string[];
  hidden?: boolean;
  disabled?: boolean;
  shortcuts?: MainlineShortcut[];
  intent: "page" | "action";
  childPageId?: string;
  meta?: MainlineMeta;
}

export interface MainlinePage {
  id: string;
  title: string;
  subtitle?: string;
  mode?: "list" | "input";
  placeholder?: string;
  emptyStateText?: string;
  submitLabel?: string;
  items: MainlineCommand[];
  meta?: MainlineMeta;
}

export type MainlineResult =
  | { kind: "close" }
  | { kind: "stay" }
  | { kind: "pushPage"; page: MainlinePage }
  | { kind: "replacePage"; page: MainlinePage }
  | { kind: "popPage" }
  | { kind: "refreshPage" }
  | { kind: "error"; message: string };

export interface MainlineAdapter {
  loadRoot: () => Promise<MainlinePage>;
  loadChild: (
    pageId: string,
    itemId: string,
    query?: string,
    meta?: MainlineMeta,
  ) => Promise<MainlinePage | MainlineResult>;
  execute: (
    itemId: string,
    pageId: string,
    query?: string,
    meta?: MainlineMeta,
  ) => Promise<MainlineResult>;
  submit: (
    pageId: string,
    query: string,
    meta?: MainlineMeta,
  ) => Promise<MainlineResult>;
  onOpenChange?: (isOpen: boolean) => void;
}

export interface MainlineClassNames {
  trigger?: string;
  overlay?: string;
  modal?: string;
  dialog?: string;
  header?: string;
  title?: string;
  subtitle?: string;
  searchField?: string;
  input?: string;
  inputSubmit?: string;
  list?: string;
  item?: string;
  itemLabel?: string;
  itemSubtitle?: string;
  emptyState?: string;
  footerHint?: string;
}

export interface ReactMainlineProps {
  adapter: MainlineAdapter;
  classNames?: MainlineClassNames;
  triggerLabel?: string;
  hotkeys?: boolean;
}

export function createMainlineAdapter<T extends MainlineAdapter>(
  adapter: T,
): T {
  return adapter;
}
