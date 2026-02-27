const MAINLINE_STYLE_ID = "react-mainline-inline-styles"

const MAINLINE_STYLES = `
:root {
  --font-mainline-display: "Fraunces", "Times New Roman", serif;
  --font-mainline-body: "Work Sans", "Segoe UI", sans-serif;
}

@keyframes react-mainline-panel-in {
  from {
    opacity: 0;
    transform: translate(-50%, 10px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
}

.react-mainline-panel-enter {
  animation: react-mainline-panel-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
`

export function ensureMainlineStyles(): void {
  if (typeof document === "undefined") {
    return
  }

  if (document.getElementById(MAINLINE_STYLE_ID)) {
    return
  }

  const style = document.createElement("style")
  style.id = MAINLINE_STYLE_ID
  style.textContent = MAINLINE_STYLES
  document.head.appendChild(style)
}
