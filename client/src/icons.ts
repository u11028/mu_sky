// The game's own icon set: one line weight, one style, drawn the same on every phone (emoji look
// different on each, and never match each other). Each is the inside of a 24×24 SVG.

const PATHS = {
  attack:
    '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/>',
  spin: '<path d="M21 12a9 9 0 1 1-3.6-7.2"/><path d="M16.5 8.2A5 5 0 1 0 17 14"/><path d="M21 3.5V9h-5.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  strike: '<path d="M13.5 2 4.5 13.5H11L9.8 22l9.2-12H12.8z" fill="currentColor" fill-opacity=".22"/>',
  dash: '<path d="M3 8h10.5a3 3 0 1 0-3-3"/><path d="M3 12h15.5a3 3 0 1 1-3 3"/><path d="M3 16h6"/>',
  heal: '<path d="M12 20.5s-7.5-4.6-9.3-9C1.4 8.2 3.5 4.5 7.2 4.5c2 0 3.3 1.1 4.8 2.9 1.5-1.8 2.8-2.9 4.8-2.9 3.7 0 5.8 3.7 4.5 7-1.8 4.4-9.3 9-9.3 9z" fill="currentColor" fill-opacity=".18"/><path d="M12 9.5v6M9 12.5h6"/>',
  potion: '<path d="M9 2.5h6"/><path d="M10 2.5v5.2L5 16.6a3.2 3.2 0 0 0 2.8 4.9h8.4a3.2 3.2 0 0 0 2.8-4.9l-5-8.9V2.5"/><path d="M6.8 14h10.4" /><path d="M8 17.5h8" stroke-opacity=".5"/>',
  bulwark: '<path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z" fill="currentColor" fill-opacity=".18"/><path d="M12 7v10M8 11h8"/>',
  berserk:
    '<path d="M12 22c4 0 7-2.7 7-6.6 0-3-1.9-5.5-3.6-7.1-.3 2-1.4 3-2.6 3.1.6-3.6-1-6.7-4-8.4.3 3-2 5.2-3.4 7.1C4.6 11.6 5 14 5 15.4 5 19.3 8 22 12 22z" fill="currentColor" fill-opacity=".2"/><path d="M12 22c-1.7 0-3-1.2-3-2.9 0-1.9 1.7-3 3-5.1 1.3 2.1 3 3.2 3 5.1 0 1.7-1.3 2.9-3 2.9z"/>',
  meteor: '<circle cx="15" cy="15" r="5.5" fill="currentColor" fill-opacity=".2"/><path d="M11 11 3 3M14 8.5 9 3.5M8.5 14l-5-5"/>',
  arrowRain: '<path d="M6 2.5v12M3.5 12 6 14.5 8.5 12M12 2.5v16M9.5 16l2.5 2.5 2.5-2.5M18 2.5v12M15.5 12l2.5 2.5 2.5-2.5"/><path d="M4 21.5h16" stroke-opacity=".5"/>',
  pierce: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/>',
  shadowStrike: '<path d="M14 3.5h6.5V10L10.2 20.3l-6.5-6.5z" fill="currentColor" fill-opacity=".18"/><path d="m2.5 21.5 3.2-3.2M6.7 12.8l4.5 4.5"/>',
  auto: '<path d="M20.5 12a8.5 8.5 0 0 1-14.7 5.8L3.5 15.5"/><path d="M3.5 12a8.5 8.5 0 0 1 14.7-5.8l2.3 2.3"/><path d="M20.5 3.5v5h-5M3.5 20.5v-5h5"/>',
  ride: '<path d="M6.5 21V11a5.5 5.5 0 1 1 11 0v10"/><path d="M4 21h5M15 21h5"/><path d="M6.5 14h2M15.5 14h2M7.5 9.5h1.5M15 9.5h1.5" stroke-opacity=".6"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3" fill="currentColor" fill-opacity=".18"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7"/>',
  bag: '<path d="M5 10.5a7 7 0 0 1 14 0V19a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19z"/><path d="M9 4.6V4a3 3 0 0 1 6 0v.6"/><path d="M8.5 14h7v4h-7z"/>',
  shop: '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2 3h3l2.6 12.3a2 2 0 0 0 2 1.7h8.7a2 2 0 0 0 2-1.6L22 7H6"/>',
  trophy: '<path d="M8 21.5h8M12 16.5v5M7 3.5h10v5.5a5 5 0 0 1-10 0z" fill="none"/><path d="M7 5.5H4.2a3.3 3.3 0 0 0 3.2 4.3M17 5.5h2.8a3.3 3.3 0 0 1-3.2 4.3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2.5H6.5A2.5 2.5 0 0 0 4 5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/><path d="M9 7h7M9 10.5h5" stroke-opacity=".6"/>',
  team: '<circle cx="9" cy="8" r="3.8"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16 4.3a3.8 3.8 0 0 1 0 7.4M21.5 21a6.5 6.5 0 0 0-4.6-6.2"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  gm: '<path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z"/><path d="m12 7.5 1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z" fill="currentColor"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" stroke-width="2.6"/>',
  fullscreen: '<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>',
  minimize: '<path d="M5 12h14"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function isIconName(name: string): name is IconName {
  return name in PATHS;
}

/** The SVG for an icon, drawn in the current text colour. */
export function icon(name: IconName) {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** Fills every element marked data-icon="name" with its icon, ahead of whatever else it holds. */
export function applyIcons(root: ParentNode = document) {
  for (const element of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const name = element.dataset.icon ?? "";
    if (isIconName(name)) {
      setIcon(element, name);
    }
  }
}

/** Puts an icon in an element, in place of the one it had. */
export function setIcon(element: HTMLElement, name: IconName) {
  element.querySelector(":scope > .icon-svg")?.remove();
  element.insertAdjacentHTML("afterbegin", icon(name));
  element.dataset.icon = name;
}
