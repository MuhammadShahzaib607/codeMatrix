import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getWorkspacePath } from '../../utils/workspaceManager.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

const DEFAULT_UA_SERIF = /^["']?(times new roman|times|serif|georgia)["']?$/i

let chromePathCache

export async function findChrome() {
  if (chromePathCache !== undefined) return chromePathCache
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate) continue
    try {
      await fs.access(candidate)
      chromePathCache = candidate
      return candidate
    } catch {}
  }
  const fromPath = await new Promise((resolve) => {
    execFile('which', ['google-chrome'], (error, stdout) => resolve(error ? null : String(stdout).trim() || null))
  })
  chromePathCache = fromPath ?? null
  return chromePathCache
}

function runChrome(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 24 * 1024 * 1024 }, (error, stdout) => {
      resolve({ error, stdout: String(stdout ?? '') })
    })
  })
}

const PROBE_SCRIPT = `<script>
(function () {
  function px(value) { return parseFloat(value) || 0; }
  function report() {
    var link = document.querySelector('.btn, main a, .site-footer a');
    var header = document.querySelector('.site-header, header');
    var hero = document.querySelector('.hero, .page-hero');
    var card = document.querySelector('.card, .service-card, .feature, .testimonial, .pricing-card, .info-card, .blog-card');
    var body = getComputedStyle(document.body);
    var out = {
      linkColor: link ? getComputedStyle(link).color : '',
      hasLink: Boolean(link),
      headerPosition: header ? getComputedStyle(header).position : '',
      heroPadding: 0,
      hasCard: Boolean(card),
      cardPadding: 0,
      bodyFont: body.fontFamily || '',
      bodyBackground: body.backgroundColor || '',
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 4,
      width: window.innerWidth,
      mobileNavWorks: null,
      faqWorks: null,
      headerCount: document.querySelectorAll('header').length,
      footerCount: document.querySelectorAll('footer').length,
      mainCount: document.querySelectorAll('main').length,
      faqItemCount: document.querySelectorAll('.faq-item').length
    };
    function firstBox(scope) {
      if (!scope) return null;
      var kids = scope.children;
      for (var i = 0; i < kids.length; i += 1) {
        var box = kids[i].getBoundingClientRect();
        if (box.height > 0 && box.width > 0) return box;
      }
      var own = scope.getBoundingClientRect();
      return own.height > 0 ? own : null;
    }
    var mainEl = document.querySelector('main');
    var headBox = header ? header.getBoundingClientRect() : null;
    var contentBox = firstBox(mainEl);
    out.headerHeight = headBox ? Math.round(headBox.height) : 0;
    out.headerBottom = headBox ? Math.round(headBox.bottom) : 0;
    out.contentTop = contentBox ? Math.round(contentBox.top) : null;
    out.headerOverlap = headBox && contentBox ? Math.round(headBox.bottom - contentBox.top) : 0;
    out.bodyPaddingTop = px(getComputedStyle(document.body).paddingTop);
    out.mainPaddingTop = mainEl ? px(getComputedStyle(mainEl).paddingTop) : 0;
    if (hero) { var hs = getComputedStyle(hero); out.heroPadding = px(hs.paddingTop) + px(hs.paddingBottom); }
    if (card) { var cs = getComputedStyle(card); out.cardPadding = px(cs.paddingTop) + px(cs.paddingLeft); }
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.site-nav');
    if (toggle && nav) {
      toggle.click();
      out.mobileNavWorks = nav.classList.contains('is-open') && toggle.getAttribute('aria-expanded') === 'true';
      toggle.click();
    }
    var faqToggles = document.querySelectorAll('.faq-item__toggle');
    if (faqToggles.length > 0) {
      var faqToggle = faqToggles[0];
      var faqItem = faqToggle.closest('.faq-item');
      faqToggle.click();
      out.faqWorks = faqItem.classList.contains('is-open') && faqToggle.getAttribute('aria-expanded') === 'true';
      out.faqOpensOthersClosed = null;
      if (faqToggles.length > 1) {
        var second = faqToggles[1];
        var secondItem = second.closest('.faq-item');
        second.click();
        out.faqOpensOthersClosed = !faqItem.classList.contains('is-open') && secondItem.classList.contains('is-open');
        second.click();
      }
      faqToggle.click();
    }
    var rgbOf = function (value) {
      var text = String(value || '');
      var open = text.indexOf('(');
      var close = text.indexOf(')');
      if (open === -1 || close === -1) return null;
      var parts = text.slice(open + 1, close).split(',');
      if (parts.length < 3) return null;
      var channels = [];
      for (var i = 0; i < 3; i += 1) {
        var channel = parseFloat(parts[i]);
        if (isNaN(channel)) return null;
        channels.push(channel);
      }
      return channels;
    };
    var lumOf = function (rgb) {
      if (!rgb) return null;
      var parts = rgb.map(function (c) { var v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
    };
    var contrastOf = function (fg, bg) {
      var a = lumOf(rgbOf(fg));
      var b = lumOf(rgbOf(bg));
      if (a === null || b === null) return null;
      var hi = Math.max(a, b);
      var lo = Math.min(a, b);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    var rawBackground = String(out.bodyBackground || '');
    if (!rawBackground || rawBackground === 'transparent' || rawBackground === 'rgba(0, 0, 0, 0)') out.bodyBackground = 'rgb(255, 255, 255)';
    out.themeBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    var effectiveBg = function (element) {
      var node = element;
      while (node && node.nodeType === 1) {
        var bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
        node = node.parentElement;
      }
      return out.bodyBackground;
    };
    var heading = document.querySelector('main h1, h1');
    var para = document.querySelector('main p, p');
    out.headingContrast = heading ? contrastOf(getComputedStyle(heading).color, effectiveBg(heading)) : null;
    out.bodyContrast = para ? contrastOf(getComputedStyle(para).color, effectiveBg(para)) : null;
    var navList = document.querySelector('.nav-list, nav ul, header ul');
    out.navListStyle = navList ? getComputedStyle(navList).listStyleType : '';
    var crumbs = document.querySelector('.breadcrumbs');
    out.breadcrumbListStyle = crumbs ? getComputedStyle(crumbs).listStyleType : '';
    var controls = [].slice.call(document.querySelectorAll('input:not([type="hidden"]), select, textarea, .btn, button'));
    var grouped = {};
    controls.forEach(function (control) {
      var box = control.getBoundingClientRect();
      if (box.height < 8 || !control.parentNode) return;
      var parent = control.parentNode;
      var key = parent.className ? String(parent.className) : String(parent.tagName);
      (grouped[key] = grouped[key] || []).push(Math.round(box.height));
    });
    out.unequalControlRows = [];
    Object.keys(grouped).forEach(function (key) {
      var heights = grouped[key];
      if (heights.length < 2) return;
      var min = Math.min.apply(null, heights);
      var max = Math.max.apply(null, heights);
      if (max - min > 1) out.unequalControlRows.push({ group: key, heights: heights });
    });
    var iconNoLabel = 0;
    [].slice.call(document.querySelectorAll('button')).forEach(function (button) {
      var text = (button.textContent || '').trim();
      if (!text && button.querySelector('svg, img') && !button.getAttribute('aria-label') && !button.getAttribute('title') && !button.getAttribute('aria-labelledby')) iconNoLabel += 1;
    });
    out.iconButtonsMissingLabel = iconNoLabel;
    var footer = document.querySelector('footer');
    if (footer) {
      var footerContent = footer.querySelector('.container') || footer.firstElementChild;
      var mainContent = document.querySelector('main .container');
      if (!mainContent) {
        var mainEl = document.querySelector('main');
        if (mainEl) {
          var mainMax = getComputedStyle(mainEl).maxWidth;
          if (mainMax && mainMax !== 'none' && parseFloat(mainMax) > 0) mainContent = mainEl;
        }
      }
      if (footerContent && mainContent) {
        var fbox = footerContent.getBoundingClientRect();
        var mbox = mainContent.getBoundingClientRect();
        out.footerLeftDelta = Math.round(Math.abs(fbox.left - mbox.left));
        out.footerWidthDelta = Math.round(Math.abs(fbox.width - mbox.width));
      }
      var previous = footer.previousElementSibling;
      out.footerGap = previous ? Math.round(footer.getBoundingClientRect().top - previous.getBoundingClientRect().bottom) : null;
    }
    document.documentElement.setAttribute('data-visual-report', JSON.stringify(out));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report, { once: true });
  else report();
})();
</script>`

function resolveRelative(fromFile, reference) {
  const clean = String(reference ?? '').split('?')[0].split('#')[0]
  if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith('//')) return null
  const dir = path.posix.dirname(String(fromFile ?? '').replace(/\\/g, '/'))
  const joined = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, clean.replace(/^\.?\//, '')))
  if (!joined || joined === '.' || joined.startsWith('..')) return null
  return joined
}

function inlineStyles(html, assets, pageFile = '') {
  let output = html.replace(
    /<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi,
    (tag) => {
      const match = /href\s*=\s*["']([^"']+)["']/i.exec(tag)
      const href = match ? match[1] : ''
      if (/^https?:/i.test(href)) return ''
      const key = resolveRelative(pageFile, href)
      const css = key ? assets.get(key) : null
      if (!css) return tag
      return `<style>${css}</style>`
    },
  )
  output = output.replace(/<script\b([^>]*)><\/script>/gi, (tag, attrs) => {
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(String(attrs ?? ''))?.[1] ?? ''
    if (!src) return tag
    if (/^(https?:)?\/\//i.test(src)) return ''
    const key = resolveRelative(pageFile, src)
    const js = key ? assets.get(key) : null
    if (!js) return ''
    return `<script>${js}</script>`
  })
  return output.replace(/<\/body>/i, `${PROBE_SCRIPT}</body>`)
}

async function readAssets(workspaceRoot, files) {
  const assets = new Map()
  for (const file of files) {
    if (!/\.(css|js)$/i.test(file)) continue
    try {
      assets.set(file, await fs.readFile(path.join(workspaceRoot, file), 'utf8'))
    } catch {}
  }
  return assets
}

const TEMP_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.visual'])

async function collectHtmlFiles(root, relative = '', out = []) {
  if (out.length >= 48) return out
  let entries
  try {
    entries = await fs.readdir(path.join(root, relative || '.'), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const name = String(entry.name ?? '')
    if (!name) continue
    const next = relative ? `${relative}/${name}` : name
    if (entry.isDirectory()) {
      if (TEMP_SKIP_DIRS.has(name)) continue
      await collectHtmlFiles(root, next, out)
    } else if (/\.html?$/i.test(name)) {
      out.push(next)
    }
  }
  return out
}

function evaluateReport(report, file, problems) {
  if (!report) {
    problems.push(`"${file}" could not be rendered in headless Chrome, so its styling could not be verified.`)
    return
  }
  if (report.headerCount > 1) {
    problems.push(
      `"${file}" renders ${report.headerCount} <header> elements. Every page has exactly ONE header at the top of <body> — a single-page site with many sections still has one. The repeated copies come from re-emitting a page tail per section; delete them with edit_file.`,
    )
  }
  if (report.footerCount > 1) {
    problems.push(
      `"${file}" renders ${report.footerCount} <footer> elements. Every page has exactly ONE footer at the bottom of <body>; every section belongs inside <main> between the single header and the single footer. Delete the repeated footers with edit_file.`,
    )
  }
  if (report.mainCount > 1) {
    problems.push(
      `"${file}" renders ${report.mainCount} <main> elements but a document has exactly one. Fold the sections into the single <main> instead of closing and reopening it per section.`,
    )
  }
  if (report.faqItemCount > 0 && report.faqWorks === false) {
    problems.push(
      `"${file}" has ${report.faqItemCount} FAQ item(s) but clicking .faq-item__toggle did not open one (no is-open class / aria-expanded="true"). Keep the kit's markup exactly as documented — .faq-item > h3.faq-item__question > button.faq-item__toggle[aria-expanded] and a .faq-item__panel sibling with a unique id — and never add your own click handler for it.`,
    )
  }
  if (report.faqOpensOthersClosed === false) {
    problems.push(
      `"${file}": opening one FAQ item did not close the other, so two answers can be open at once. The kit's main.js closes siblings; check that the items share the same .faq parent.`,
    )
  }
  if (report.hasLink && /^rgba?\(0,\s*0,\s*238/.test(report.linkColor)) {
    problems.push(
      `"${file}" renders links with the browser default blue (${report.linkColor}) — the stylesheet did not apply. Check the <link> paths and that css/base.css is not empty.`,
    )
  }
  if (report.headerPosition && report.headerPosition !== 'sticky' && report.headerPosition !== 'fixed') {
    problems.push(
      `"${file}" header is "${report.headerPosition}" but should be position: sticky (preferred — it reserves its own space, so it can never cover the page) or position: fixed with a matching offset.`,
    )
  }
  if (report.headerOverlap > 2) {
    problems.push(
      `"${file}" hides content under the header at ${report.width}px wide: the header is ${report.headerHeight}px tall (bottom edge at ${report.headerBottom}px) but the first block inside <main> starts at ${report.contentTop}px — ${report.headerOverlap}px of it is covered. Fix it by making the header position: sticky (no offset maths needed), OR, if the header must stay fixed, offset the content by the REAL measured height: set --header-offset: ${report.headerHeight}px and add padding-top: var(--header-offset) to <body>, or add padding-top: ${report.headerHeight}px to <main>. Never use a guessed pixel value. Current body padding-top: ${report.bodyPaddingTop}px, main padding-top: ${report.mainPaddingTop}px.`,
    )
  }
  if (report.heroPadding > 0 && report.heroPadding < 48) {
    problems.push(`"${file}" hero has only ${Math.round(report.heroPadding)}px of vertical padding — it needs at least 48px.`)
  }
  if (report.hasCard && report.cardPadding === 0) {
    problems.push(`"${file}" cards have no padding, so the layout will look cramped.`)
  }
  if (report.bodyFont && DEFAULT_UA_SERIF.test(report.bodyFont.trim())) {
    problems.push(`"${file}" is using the browser default serif font ("${report.bodyFont}") instead of the site font.`)
  }
  if (report.overflowX) {
    problems.push(`"${file}" has horizontal overflow at ${report.width}px wide.`)
  }
  if (report.width === NARROW_WIDTH && report.mobileNavWorks === false) {
    problems.push(
      `"${file}": at ${NARROW_WIDTH}px the hamburger button did not open the nav (.site-nav never got is-open / aria-expanded stayed "false"). Keep the kit's nav-toggle markup and js/main.js wiring.`,
    )
  }
  if (report.headingContrast != null && report.headingContrast < 3) {
    problems.push(`"${file}" headings have only ${report.headingContrast}:1 contrast against the body background — they are hard to read. Use a theme text colour that reaches at least 4.5:1.`)
  }
  if (report.bodyContrast != null && report.bodyContrast < 3) {
    problems.push(`"${file}" body text has only ${report.bodyContrast}:1 contrast against its background — increase the contrast.`)
  }
  const defaultBg = !report.bodyBackground || /rgb\(\s*255,\s*255,\s*255\s*\)/.test(report.bodyBackground)
  const themeBg = String(report.themeBg ?? '').trim()
  const themeLight = /#fff|#ffffff|white|rgb\(\s*255/i.test(themeBg)
  if (defaultBg && !themeLight) {
    problems.push(
      `"${file}" renders with a default/transparent body background (${report.bodyBackground || 'none'}) instead of the theme background (--bg: ${themeBg || 'undefined'}) — the page is not picking up its stylesheet. Check the <link> paths and give <body> the theme's background and text colours.`,
    )
  }
  if (report.navListStyle && report.navListStyle !== 'none') {
    problems.push(`"${file}" navigation renders as a browser-default list (list-style: ${report.navListStyle}) — set list-style: none on the nav list.`)
  }
  if (report.breadcrumbListStyle && report.breadcrumbListStyle !== 'none') {
    problems.push(`"${file}" breadcrumbs render as a numbered/bulleted list (list-style: ${report.breadcrumbListStyle}) — style .breadcrumbs with list-style: none and an inline layout.`)
  }
  if (Array.isArray(report.unequalControlRows) && report.unequalControlRows.length > 0) {
    const first = report.unequalControlRows[0]
    problems.push(`"${file}" has controls on the same row with different heights (${first.group}: ${first.heights.join(', ')}px). Give buttons and inputs on one row the SAME rendered height.`)
  }
  if (report.iconButtonsMissingLabel > 0) {
    problems.push(`"${file}" has ${report.iconButtonsMissingLabel} icon-only button(s) with no accessible name — add an aria-label (plus visible text where space allows).`)
  }
  if (report.footerWidthDelta != null && report.footerWidthDelta > 8) {
    problems.push(`"${file}" footer content does not align with the page container (${report.footerWidthDelta}px difference) — use the same container width and horizontal padding.`)
  }
  if (report.footerGap != null && report.footerGap < 8) {
    problems.push(`"${file}" footer touches the content above it (only ${report.footerGap}px gap) — add spacing between the main content and the footer.`)
  }
}

const NARROW_WIDTH = 375
const MID_WIDTH = 768
export const VISUAL_WIDTHS = [1280, MID_WIDTH, NARROW_WIDTH]
export const VISUAL_NARROW_WIDTH = NARROW_WIDTH
export const VISUAL_MID_WIDTH = MID_WIDTH

export async function visualSanityCheck({ projectId = null, root = null, files = null, narrow = true } = {}) {
  let workspaceRoot = root
  if (!workspaceRoot) {
    try {
      workspaceRoot = getWorkspacePath(projectId)
    } catch (error) {
      return { skipped: true, reason: `workspace unresolved: ${error.message}`, problems: [], checked: [] }
    }
  }
  const chrome = await findChrome()
  if (!chrome) {
    return { skipped: true, reason: 'no Chrome/Chromium executable found', problems: [], checked: [] }
  }

  const allHtml = await collectHtmlFiles(workspaceRoot)
  let htmlFiles
  if (Array.isArray(files) && files.length > 0) {
    const requested = files
      .filter((file) => /\.html?$/i.test(file))
      .map((file) => String(file).replace(/^\.?\//, ''))
    htmlFiles = [...new Set([...requested, ...allHtml])]
  } else {
    htmlFiles = allHtml
  }
  if (htmlFiles.length === 0) return { ok: true, skipped: false, problems: [], checked: [], chrome }

  const problemFiles = new Set()
  const problems = []
  const checked = []
  const reports = []
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-visual-'))
  const multiWidthFiles = new Set(narrow ? htmlFiles.slice(0, 2) : [])

  for (const file of htmlFiles.slice(0, 4)) {
    let html
    try {
      html = await fs.readFile(path.join(workspaceRoot, file), 'utf8')
    } catch {
      continue
    }
    const reachable = [
      ...[...html.matchAll(/href\s*=\s*["']([^"']+\.css)["']/gi)].map((match) => match[1]),
      ...[...html.matchAll(/src\s*=\s*["']([^"']+\.js)["']/gi)].map((match) => match[1]),
    ]
      .map((value) => resolveRelative(file, value))
      .filter(Boolean)
    const assets = await readAssets(workspaceRoot, reachable)

    const slug = file.replace(/[\\/]/g, '_')
    const probeFile = path.join(tempRoot, `${slug}.html`)
    await fs.writeFile(probeFile, inlineStyles(html, assets, file), 'utf8')
    const widths = multiWidthFiles.has(file) ? VISUAL_WIDTHS : [VISUAL_WIDTHS[0]]
    for (const width of widths) {
      let target = probeFile
      if (width !== VISUAL_WIDTHS[0]) {
        const wrapper = path.join(tempRoot, `${slug}.w${width}.html`)
        await fs.writeFile(
          wrapper,
          `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>probe</title>
<style>html,body{margin:0;padding:0;background:#fff}iframe{width:${width}px;height:1000px;border:0;display:block;margin:0 auto}</style>
</head>
<body>
<iframe id="probe" src="${slug}.html"></iframe>
<script>
(function () {
  var frame = document.getElementById('probe')
  function copy() {
    try {
      var inner = frame.contentDocument && frame.contentDocument.documentElement.getAttribute('data-visual-report')
      if (inner) document.documentElement.setAttribute('data-visual-report', inner)
    } catch (error) {
      document.documentElement.setAttribute('data-visual-report', JSON.stringify({ width: ${width} }))
    }
  }
  frame.addEventListener('load', function () { copy(); window.setTimeout(copy, 150) })
})()
</script>
</body>
</html>
`,
          'utf8',
        )
        target = wrapper
      }
      const { stdout } = await runChrome(
        chrome,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--hide-scrollbars',
          `--window-size=${width},${width < 800 ? 1000 : 1200}`,
          '--virtual-time-budget=2500',
          '--allow-file-access-from-files',
          '--dump-dom',
          pathToFileURL(target).href,
        ],
        width < 800 ? 30000 : 25000,
      )

      const match = /data-visual-report="([^"]+)"/.exec(stdout)
      let report = null
      if (match) {
        try {
          report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
        } catch {
          report = null
        }
      }
      const before = problems.length
      evaluateReport(report, file, problems)
      if (problems.length > before) problemFiles.add(file)
      if (!checked.includes(file)) checked.push(file)
      if (report) reports.push({ file, width, ...report })
    }
  }

  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  return { ok: problems.length === 0, skipped: false, problems, checked, chrome, reports, problemFiles: [...problemFiles] }
}

export async function captureScreenshots({ projectId = null, root = null, files = [], outDir, widths = [1280, 768, 375] } = {}) {
  const workspaceRoot = root ?? getWorkspacePath(projectId)
  const chrome = await findChrome()
  if (!chrome) return { skipped: true, reason: 'no Chrome/Chromium executable found', shots: [] }
  const targetDir = outDir ?? path.join(workspaceRoot, '.visual')
  await fs.mkdir(targetDir, { recursive: true })
  const shots = []
  for (const file of files) {
    for (const width of widths) {
      const name = `${path.basename(file, path.extname(file))}-${width}.png`
      const target = path.join(targetDir, name)
      await runChrome(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        `--window-size=${width},1400`,
        '--virtual-time-budget=3000',
        '--allow-file-access-from-files',
        `--screenshot=${target}`,
        pathToFileURL(path.join(workspaceRoot, file)).href,
      ], 30000)
      try {
        const stat = await fs.stat(target)
        shots.push({ file, width, path: target, bytes: stat.size })
      } catch {}
    }
  }
  return { skipped: false, shots, chrome, outDir: targetDir }
}

export function formatVisualReport(result) {
  if (!result || result.ok || result.skipped) return ''
  const lines = result.problems.map((problem, index) => `${index + 1}. ${problem}`)
  return ['VISUAL CHECK FAILED — the page does not render like a styled site:', ...lines.slice(0, 6)].join('\n')
}

export const __testables = { inlineStyles, evaluateReport, findChrome, here }
