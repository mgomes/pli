// Small, bundled SVG vocabulary used by the library controls.
const paths = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  play: '<path d="m8 5 11 7-11 7z" fill="currentColor"/>',
  settings: '<path d="m9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1z"/><circle cx="12" cy="12" r="3"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m10 0h4M3 16h4m10 0h4"/>',
  tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m7 2 5 5 5-5"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7M5 12h14"/>',
  'arrow-right': '<path d="m12 5 7 7-7 7M19 12H5"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  'ellipsis-vertical': '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  'trash-2': '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="m3 3 18 18M10 5c7-2 12 7 12 7s-1 3-4 5M6 6c-3 2-4 6-4 6s4 7 10 7c2 0 3 0 4-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  'external-link': '<path d="M15 3h6v6m0-6L10 14M10 3H3v18h18v-7"/>',
  'image-off': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 3 18 18M3 17l5-5 4 4 3-3"/>',
};
window.lucide = { createIcons() {
  document.querySelectorAll('[data-lucide]').forEach(node => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: node.className || '' })) svg.setAttribute(key, value);
    svg.innerHTML = paths[node.dataset.lucide] || paths.film;
    node.replaceWith(svg);
  });
} };
