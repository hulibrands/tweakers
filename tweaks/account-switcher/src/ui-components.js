const { protectInteractiveControl } = require("./dom-utils");

const PANEL_ROW_LEFT_INSET = 30;

function addButtonFeedback(element, styles) {
  const normal = {
    background: element.style.background || element.style.backgroundColor || "transparent",
    color: element.style.color || "",
    transform: element.style.transform || "",
  };
  const apply = (values) => {
    if (values.background != null) element.style.background = values.background;
    if (values.color != null) element.style.color = values.color;
    if (values.transform != null) element.style.transform = values.transform;
  };
  const hover = styles.hover || {};
  const active = styles.active || hover;
  const restore = () => apply(styles.normal || normal);
  element.style.transition = "background-color 120ms ease, color 120ms ease, transform 80ms ease";
  element.addEventListener("pointerenter", () => {
    if (element.disabled) return;
    apply(hover);
  });
  element.addEventListener("pointerleave", restore);
  element.addEventListener("focus", () => {
    if (element.disabled) return;
    apply(hover);
  });
  element.addEventListener("blur", restore);
  element.addEventListener("pointerdown", () => {
    if (element.disabled) return;
    apply(active);
  });
  element.addEventListener("pointerup", () => {
    if (element.disabled) return;
    apply(hover);
  });
  element.addEventListener("pointercancel", restore);
}

// ─── Popup-panel buttons ──────────────────────────────────────────────────────

function smallButton(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText =
    "height:24px;border:0;border-radius:6px;padding:0 8px;" +
    "background:color-mix(in srgb,var(--color-token-text-primary,currentColor) 10%,transparent);" +
    "color:var(--color-token-text-primary,currentColor);font:inherit;font-size:12px;line-height:1;cursor:pointer;";
  addButtonFeedback(button, {
    hover: {
      background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 16%,transparent)",
    },
    active: {
      background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 22%,transparent)",
      transform: "scale(0.98)",
    },
  });
  protectInteractiveControl(button);
  return button;
}

function iconButton(label, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.style.cssText =
    "display:grid;place-items:center;width:22px;height:22px;border:0;border-radius:5px;" +
    "background:transparent;color:var(--color-token-text-secondary,currentColor);" +
    "font:inherit;font-size:16px;line-height:1;cursor:pointer;";
  addButtonFeedback(button, {
    hover: {
      background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 10%,transparent)",
      color: "var(--color-token-text-primary,currentColor)",
    },
    active: {
      background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 18%,transparent)",
      color: "var(--color-token-text-primary,currentColor)",
      transform: "scale(0.94)",
    },
  });
  protectInteractiveControl(button);
  return button;
}

// ─── Settings-page primitives ─────────────────────────────────────────────────

function settingsButton(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className =
    "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-sm " +
    "text-token-text-primary hover:bg-token-foreground/10 disabled:cursor-default disabled:opacity-50";
  button.style.border = "1px solid color-mix(in srgb, currentColor 14%, transparent)";
  button.style.backgroundColor = "color-mix(in srgb, currentColor 5%, transparent)";
  addButtonFeedback(button, {
    hover: {
      background: "color-mix(in srgb, currentColor 10%, transparent)",
    },
    active: {
      background: "color-mix(in srgb, currentColor 16%, transparent)",
      transform: "scale(0.98)",
    },
  });
  protectInteractiveControl(button);
  return button;
}

function settingsSection(title) {
  const section = document.createElement("section");
  section.className = "flex flex-col gap-2";

  const titleRow = document.createElement("div");
  titleRow.className = "flex h-toolbar items-center justify-between gap-2 px-0 py-0";

  const inner = document.createElement("div");
  inner.className = "flex min-w-0 flex-1 flex-col gap-1";

  const heading = document.createElement("div");
  heading.className = "text-base font-medium text-token-text-primary";
  heading.textContent = title;

  inner.appendChild(heading);
  titleRow.appendChild(inner);
  section.appendChild(titleRow);
  return section;
}

function settingsCard() {
  const card = document.createElement("div");
  card.className =
    "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border";
  card.style.backgroundColor = "var(--color-background-panel, var(--color-token-bg-fog))";
  return card;
}

function settingsRowShell() {
  const row = document.createElement("div");
  row.className = "flex items-center justify-between gap-4 p-3";
  return row;
}

function settingsInfoRow(titleText, valueText, descriptionText) {
  const row = settingsRowShell();
  const left = document.createElement("div");
  left.className = "flex min-w-0 flex-col gap-1";

  const title = document.createElement("div");
  title.className = "min-w-0 text-sm text-token-text-primary";
  title.textContent = titleText;
  left.appendChild(title);

  if (descriptionText) {
    const desc = document.createElement("div");
    desc.className = "text-token-text-secondary min-w-0 text-sm";
    desc.textContent = descriptionText;
    left.appendChild(desc);
  }

  const value = document.createElement("div");
  value.className = "max-w-[45%] shrink-0 truncate text-right text-sm text-token-text-secondary";
  value.title = valueText;
  value.textContent = valueText;
  row.append(left, value);
  return row;
}

function settingsActionRow(titleText, descriptionText, actionText, onClick) {
  const row = settingsRowShell();
  const left = document.createElement("div");
  left.className = "flex min-w-0 flex-col gap-1";

  const title = document.createElement("div");
  title.className = "min-w-0 text-sm text-token-text-primary";
  title.textContent = titleText;
  left.appendChild(title);

  const desc = document.createElement("div");
  desc.className = "text-token-text-secondary min-w-0 text-sm";
  desc.textContent = descriptionText;
  left.appendChild(desc);
  row.appendChild(left);

  const button = settingsButton(actionText);
  bindButtonAction(button, onClick);
  row.appendChild(button);
  return row;
}

function bindButtonAction(button, onAction) {
  let lastRun = 0;
  const run = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    const now = Date.now();
    if (now - lastRun < 350) return;
    lastRun = now;
    onAction(event);
  };
  button.addEventListener("pointerup", run);
  button.addEventListener("click", run);
}

function settingsStatus(text, isError = false) {
  const status = document.createElement("div");
  status.className = "text-token-text-secondary text-sm";
  status.style.color = isError
    ? "var(--color-token-text-error, #c2410c)"
    : "var(--color-token-text-secondary, currentColor)";
  status.textContent = text;
  return status;
}

// ─── Popup-panel shell & status ───────────────────────────────────────────────

function accountPanelShell(base) {
  const panel = document.createElement("div");
  panel.setAttribute("data-codexpp-account-switcher", "panel");
  panel.setAttribute("role", "presentation");
  panel.style.cssText = [
    "box-sizing:border-box",
    "width:100%",
    "margin:0",
    "padding:0",
    "color:var(--color-token-text-primary,currentColor)",
    "cursor:default",
    "user-select:none",
  ].join(";");
  return panel;
}

function setPanelStatus(panel, text) {
  panel.textContent = "";
  const status = document.createElement("div");
  status.textContent = text;
  status.style.cssText =
    `font-size:12px;line-height:1.35;color:var(--color-token-text-secondary,currentColor);` +
    `padding:4px 24px 6px ${PANEL_ROW_LEFT_INSET}px;`;
  panel.appendChild(status);
}

function accountDisplayName(accountState, name, options = {}) {
  const email = accountState?.accountEmails?.[name];
  const suffix = accountState?.current === name && options.includeCurrent !== false ? " (current)" : "";
  return email ? `${email}${suffix}` : `${name}${suffix}`;
}

function accountUsageSummary(accountState, name) {
  const usage = accountState?.accountUsage?.[name];
  if (!usage || typeof usage !== "object") return null;
  const parts = [];
  const fiveHour = usageWindowSummary(usage.fiveHour, "5h");
  const weekly = usageWindowSummary(usage.weekly, "Weekly");
  if (fiveHour) parts.push(fiveHour);
  if (weekly) parts.push(weekly);
  if (!parts.length) return null;
  return parts.join(" · ");
}

function usageWindowSummary(window, fallbackLabel) {
  if (typeof window?.pct !== "number") return null;
  const label = window.label || fallbackLabel;
  const reset = window.pct <= 0 && window.resetAt ? `, resets ${window.resetAt}` : "";
  return `${label} ${window.pct}%${reset}`;
}

module.exports = {
  PANEL_ROW_LEFT_INSET,
  addButtonFeedback,
  smallButton,
  iconButton,
  settingsButton,
  settingsSection,
  settingsCard,
  settingsRowShell,
  settingsInfoRow,
  settingsActionRow,
  settingsStatus,
  bindButtonAction,
  accountPanelShell,
  setPanelStatus,
  accountDisplayName,
  accountUsageSummary,
};
