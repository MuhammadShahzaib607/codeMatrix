import { DEFAULT_THEME_ID, getThemePreset, fontsHref } from './themes.js'
import { SECTION_TYPES } from './snippets.js'

const SOCIAL_ICONS = {
  x: '<path d="M4 4l7 8-7 8h3l5.5-6.3L18 20h3l-7.3-8.4L20.5 4h-3l-5 5.8L7 4Z" fill="currentColor" stroke="none"/>',
  linkedin:
    '<path d="M4 9h4v11H4zM6 4.5A2 2 0 1 0 6 8.5 2 2 0 0 0 6 4.5ZM10 9h4v1.6a4 4 0 0 1 3.5-1.8c2.6 0 4.5 1.7 4.5 5V20h-4v-5c0-1.3-.6-2-1.8-2s-2.2.8-2.2 2.2V20h-4Z" fill="currentColor" stroke="none"/>',
  github:
    '<path d="M12 3a9 9 0 0 0-2.8 17.5c.4.1.6-.2.6-.5v-1.9c-2.3.5-2.9-1-2.9-1-.4-1-1-1.3-1-1.3-.8-.5 0-.5 0-.5.9.1 1.4.9 1.4.9.8 1.3 2 1 2.5.7.1-.6.3-1 .6-1.2-2-.2-4-1-4-4.2 0-.9.3-1.7.9-2.3-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.4.9a8 8 0 0 1 4.2 0c1.7-1.1 2.4-.9 2.4-.9.5 1.2.2 2.1.1 2.3.6.6.9 1.4.9 2.3 0 3.2-2 4-3.9 4.2.3.3.6.9.6 1.8v2.6c0 .3.2.6.6.5A9 9 0 0 0 12 3Z" fill="currentColor" stroke="none"/>',
  instagram:
    '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.6" cy="7.4" r="1" fill="currentColor"/>',
}

export function socialLinks(label) {
  return Object.entries(SOCIAL_ICONS)
    .map(
      ([network, path]) =>
        `<a class="social-link" href="https://www.${network === 'x' ? 'x' : network}.com" aria-label="${label} on ${network === 'x' ? 'X' : network[0].toUpperCase() + network.slice(1)}"><svg class="social__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">${path}</svg></a>`,
    )
    .join('\n          ')
}

function normalizePages(pages) {
  const list = []
  for (const entry of Array.isArray(pages) ? pages : []) {
    const file = String(typeof entry === 'string' ? entry : entry?.file ?? '')
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .trim()
    if (!file || list.some((page) => page.file === file)) continue
    const sections = (Array.isArray(entry?.sections) ? entry.sections : [])
      .map((section) => String(section ?? '').trim())
      .filter((section) => SECTION_TYPES.includes(section))
    const fallbackName = file.replace(/\.html?$/i, '')
    const navLabel = String(entry?.nav_label ?? '').trim() || fallbackName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    list.push({
      file,
      title: String(entry?.title ?? '').trim() || navLabel,
      navLabel,
      sections,
    })
  }
  return list
}

function initialMark(brand) {
  const words = String(brand ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return 'AB'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

export function normalizeScaffoldInput(input) {
  const brand = String(input?.brand ?? '').trim() || 'Your Brand'
  const tagline = String(input?.tagline ?? '').trim() || 'Websites that win work'
  const theme = getThemePreset(input?.palette ?? DEFAULT_THEME_ID)
  const pages = normalizePages(input?.pages)
  return { brand, tagline, theme, pages }
}

export function buildPageShell({ brand, tagline, theme, pages, page, description }) {
  const navLinks = pages
    .map((entry) => {
      const isCurrent = entry.file === page.file
      return `          <li class="nav-item"><a class="nav-link${isCurrent ? ' is-active' : ''}" href="${entry.file}"${isCurrent ? ' aria-current="page"' : ''}>${entry.navLabel}</a></li>`
    })
    .join('\n')

  const contactPage = pages.find((entry) => /contact/i.test(entry.file))
  const ctaHref = contactPage?.file ?? pages[0]?.file ?? '#main'
  const slots = page.sections.map((section) => `      <!-- SLOT:${section} -->`).join('\n')
  const descriptionText = String(description ?? '').trim() || `${tagline} — ${brand}.`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${page.title}</title>
  <meta name="description" content="${descriptionText}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${fontsHref(theme.fonts)}">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/theme.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container site-header__inner">
      <a class="brand" href="${pages[0]?.file ?? 'index.html'}">
        <span class="brand__mark" aria-hidden="true">${initialMark(brand)}</span>
        <span class="brand__name">${brand}</span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open navigation menu">
        <span class="nav-toggle__bar"></span>
        <span class="nav-toggle__bar"></span>
        <span class="nav-toggle__bar"></span>
      </button>
      <nav class="site-nav" id="site-nav" aria-label="Main navigation">
        <ul class="nav-list">
${navLinks}
        </ul>
        <a class="btn btn--primary btn--sm nav-cta" href="${ctaHref}">Start a project</a>
      </nav>
    </div>
  </header>
  <main id="main">
${slots}
  </main>
  <footer class="site-footer">
    <div class="container site-footer__grid">
      <div class="footer-brand">
        <a class="brand" href="${pages[0]?.file ?? 'index.html'}">
          <span class="brand__mark" aria-hidden="true">${initialMark(brand)}</span>
          <span class="brand__name">${brand}</span>
        </a>
        <p class="footer-blurb">${tagline}. We design and build websites that turn visitors into customers.</p>
        <div class="footer-social">
          ${socialLinks(brand)}
        </div>
      </div>
      <div class="footer-col">
        <h2 class="footer-col__title">Explore</h2>
        <ul class="footer-col__list">
${pages.map((entry) => `          <li><a class="footer-link" href="${entry.file}">${entry.navLabel}</a></li>`).join('\n')}
        </ul>
      </div>
      <div class="footer-col">
        <h2 class="footer-col__title">Services</h2>
        <ul class="footer-col__list">
          <li><a class="footer-link" href="${pages[0]?.file ?? 'index.html'}#services">Web design</a></li>
          <li><a class="footer-link" href="${pages[0]?.file ?? 'index.html'}#services">Development</a></li>
          <li><a class="footer-link" href="${pages[0]?.file ?? 'index.html'}#services">SEO and content</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h2 class="footer-col__title">Contact</h2>
        <ul class="footer-contact">
          <li>hello@${String(brand).toLowerCase().replace(/[^a-z0-9]+/g, '')}.com</li>
          <li>+44 20 7946 0123</li>
          <li>14 Bridge Street, London</li>
        </ul>
      </div>
    </div>
    <div class="container site-footer__bottom">
      <p class="footer-note">&copy; <span data-year>2026</span> ${brand}. All rights reserved.</p>
      <p class="footer-note"><a class="footer-link" href="${pages[0]?.file ?? 'index.html'}">Back to top of site</a></p>
    </div>
  </footer>
  <button class="back-to-top" type="button" aria-label="Back to top">
    <svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
  </button>
  <script src="js/main.js" defer></script>
</body>
</html>
`
}

export function buildScaffoldFiles(input) {
  const { brand, tagline, theme, pages } = normalizeScaffoldInput(input)
  if (pages.length === 0) return { files: [], theme, pages, skipped: [] }
  const files = [
    { path: 'css/base.css', content: null, kind: 'kit' },
    { path: 'css/theme.css', content: theme.css, kind: 'theme' },
    { path: 'js/main.js', content: null, kind: 'kit' },
  ]
  for (const page of pages) {
    files.push({
      path: page.file,
      content: buildPageShell({ brand, tagline, theme, pages, page, description: `${tagline} — ${brand}.` }),
      kind: 'page',
    })
  }
  return { files, theme, pages, brand, tagline }
}

export function sectionCatalog() {
  return SECTION_TYPES.join(', ')
}
