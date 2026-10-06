const ICON_PATHS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.4 2.4L15.5 9.8"/>',
  'check-square': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>',
  quote: '<path d="M9 11H5.5a3.5 3.5 0 0 1 0-7H7v4M18 11h-3.5a3.5 3.5 0 0 1 0-7H16v4"/><path d="M5 11c0 5 1.5 7 4 9M14 11c0 5 1.5 7 4 9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
  phone: '<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6.5 3Z"/>',
  'map-pin': '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  truck: '<path d="M3 6h10v9H3zM13 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  shield: '<path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6Z"/>',
  'shield-check': '<path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7.8 4.1 4.1 0 0 1 19 10.6c0 5-7 9.4-7 9.4Z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-13 0 9-5 14-13 13Z"/><path d="M5 19c3-4 6-6 10-7"/>',
  sparkles: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6Z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M18.5 19a5.6 5.6 0 0 0-3-4.9"/>',
  'shopping-bag': '<path d="M5 8h14l-1 12H6Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  'shopping-cart': '<circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M3 4h2l2.2 10.5h10l2-7H6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7M9 7h8v8"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m14 6 4 4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.1 1.3M17.7 15.2l2.1 1.3M4.2 16.5l2.1-1.3M17.7 8.8l2.1-1.3"/>',
  zap: '<path d="M13 3 5 14h6l-1 7 8-11h-6Z"/>',
  award: '<circle cx="12" cy="9" r="5"/><path d="m9 13-1 8 4-2.4L16 21l-1-8"/>',
  gift: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M4 10h16M12 10v10M12 10S9 4 7 6s5 4 5 4Zm0 0s3-6 5-4-5 4-5 4Z"/>',
  'credit-card': '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14h3"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 3 2.6 15 0 18-2.6-3-2.6-15 0-18Z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  home: '<path d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  'list-checks': '<path d="M11 6h9M11 12h9M11 18h9M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18 5 19.5 7.5 17"/>',
  'bar-chart': '<path d="M5 20V10M12 20V5M19 20v-7"/>',
  play: '<path d="M8 5.5v13l11-6.5Z"/>',
  download: '<path d="M12 4v10M7.5 10 12 14.5 16.5 10M5 20h14"/>',
  upload: '<path d="M12 14V4M7.5 8 12 3.5 16.5 8M5 20h14"/>',
  'external-link': '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  clipboard: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4h6v2H9zM9 11h6M9 15h4"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/>',
  'eye-off': '<path d="M4 4l16 16M9.5 5.3A9.6 9.6 0 0 1 12 5c6 0 9.5 6 9.5 6a15 15 0 0 1-3 3.6M6.4 7.2A15.4 15.4 0 0 0 2.5 11s3.5 6 9.5 6a9.6 9.6 0 0 0 3-.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-2s-.7-2-.7-3 1-1.6 2.2-1.6H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-2h5L16 7"/><circle cx="12" cy="13" r="3.2"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  tag: '<path d="M4 4h7l9 9-7 7-9-9Z"/><circle cx="8" cy="8" r="1.3"/>',
  percent: '<path d="M6 6h.01M18 18h.01M18 6 6 18"/>',
  'trending-up': '<path d="M4 17l6-6 4 4 6-6M15 9h5v5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3.5 12 8.5 4.7 8.5-4.7M3.5 16l8.5 4.7 8.5-4.7"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/>',
  droplet: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z"/>',
  flower: '<circle cx="12" cy="12" r="2.4"/><path d="M12 9.6c0-3 1-4.6 3-4.6s1.6 3-1 6.2M14.4 12c3 0 4.6 1 4.6 3s-3 1.6-6.2-1M12 14.4c0 3-1 4.6-3 4.6s-1.6-3 1-6.2M9.6 12c-3 0-4.6-1-4.6-3s3-1.6 6.2 1"/>',
  coffee: '<path d="M5 8h12v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z"/><path d="M17 9h1.6a2.2 2.2 0 0 1 0 4.4H17M6 3.5c0 .8.8 1.2.8 2M10 3.5c0 .8.8 1.2.8 2M14 3.5c0 .8.8 1.2.8 2"/>',
  code: '<path d="m9 8-5 4 5 4M15 8l5 4-5 4"/>',
  send: '<path d="M4 12 20 5l-7 15-2.5-5.5Z"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.4L7 20Z"/>',
  'thumbs-up': '<path d="M7 10v9H4v-9ZM7 19l1.6 1h6.2a2 2 0 0 0 2-1.6l1-4.4a1.6 1.6 0 0 0-1.6-2H13l.6-3.2a2 2 0 0 0-3.4-1.6L7 10"/>',
  'message-circle': '<path d="M20 12a7.5 7.5 0 0 1-10.8 6.7L4 20l1.3-4.6A7.5 7.5 0 1 1 20 12Z"/>',
  facebook: '<path d="M14 8h2V5h-2a3 3 0 0 0-3 3v2H9v3h2v6h3v-6h2.2l.8-3H14V9a1 1 0 0 1 1-1Z" fill="currentColor" stroke="none"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.6" cy="7.4" r="1" fill="currentColor"/>',
  twitter: '<path d="M4 4l7 8-7 8h3l5.5-6.3L18 20h3l-7.3-8.4L20.5 4h-3l-5 5.8L7 4Z" fill="currentColor" stroke="none"/>',
  linkedin: '<path d="M4 9h4v11H4zM6 4.5A2 2 0 1 0 6 8.5 2 2 0 0 0 6 4.5ZM10 9h4v1.6a4 4 0 0 1 3.5-1.8c2.6 0 4.5 1.7 4.5 5V20h-4v-5c0-1.3-.6-2-1.8-2s-2.2.8-2.2 2.2V20h-4Z" fill="currentColor" stroke="none"/>',
  youtube: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="m11 9.5 4 2.5-4 2.5Z" fill="currentColor" stroke="none"/>',
  github: '<path d="M12 3a9 9 0 0 0-2.8 17.5c.4.1.6-.2.6-.5v-1.9c-2.3.5-2.9-1-2.9-1-.4-1-1-1.3-1-1.3-.8-.5 0-.5 0-.5.9.1 1.4.9 1.4.9.8 1.3 2 1 2.5.7.1-.6.3-1 .6-1.2-2-.2-4-1-4-4.2 0-.9.3-1.7.9-2.3-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.4.9a8 8 0 0 1 4.2 0c1.7-1.1 2.4-.9 2.4-.9.5 1.2.2 2.1.1 2.3.6.6.9 1.4.9 2.3 0 3.2-2 4-3.9 4.2.3.3.6.9.6 1.8v2.6c0 .3.2.6.6.5A9 9 0 0 0 12 3Z" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8Z"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
}

export const ICON_FALLBACK = 'circle'

export function iconNames() {
  return Object.keys(ICON_PATHS).sort()
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, String(name ?? '').trim())
}

const ICONS_JS = `;(function () {
  'use strict'
  var PATHS = ${JSON.stringify(ICON_PATHS)}
  var FALLBACK = ${JSON.stringify(ICON_FALLBACK)}
  var SVG_OPEN =
    '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'

  function hydrateNode(node) {
    if (!node || node.getAttribute('data-icon-ready') === '1') return
    var name = String(node.getAttribute('data-icon') || '').trim()
    var inner = PATHS[name] || PATHS[FALLBACK]
    node.innerHTML = SVG_OPEN + inner + '</svg>'
    if (!node.classList.contains('icon') && !node.classList.contains('icon-badge')) node.classList.add('icon')
    if (node.getAttribute('aria-hidden') !== 'false') node.setAttribute('aria-hidden', 'true')
    if (!node.getAttribute('focusable')) node.setAttribute('focusable', 'false')
    node.setAttribute('data-icon-ready', '1')
  }

  function hydrate(root) {
    var scope = root && root.querySelectorAll ? root : document
    if (scope.querySelectorAll) {
      Array.prototype.forEach.call(scope.querySelectorAll('[data-icon]'), hydrateNode)
    }
    if (scope.getAttribute && scope.getAttribute('data-icon')) hydrateNode(scope)
  }

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true })
    } else {
      callback()
    }
  }

  onReady(function () {
    hydrate(document)
    if (typeof MutationObserver === 'function') {
      var observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes, function (node) {
            if (node && node.nodeType === 1) hydrate(node)
          })
        })
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }
  })

  window.CMIcons = { hydrate: hydrate, has: function (name) { return Object.prototype.hasOwnProperty.call(PATHS, name) } }
})()
`

export const ICONS_SCRIPT = ICONS_JS
