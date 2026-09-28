import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'followup-'))
process.env.WORKSPACES_ROOT = tempRoot

const workspaceManager = await import('./src/utils/workspaceManager.js')
const fileWatcher = await import('./src/utils/fileWatcher.js')
const { adoptScratchProject } = await import('./src/services/scratchProjectService.js')
const { runAgent } = await import('./src/services/agentService.js')
const { connectionCheck } = await import('./src/agent/quality/connectionCheck.js')

const { registerWorkspaceFolder, getWorkspaceRecord, getWorkspacePath } = workspaceManager
const { startWatchingProject, getWatchedProjectIds, closeAllWatchers } = fileWatcher

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const NAV = [
  ['Home', 'index.html'],
  ['About', 'about.html'],
  ['Services', 'services.html'],
  ['Team', 'team.html'],
  ['Pricing', 'pricing.html'],
  ['Blog', 'blog.html'],
  ['Contact', 'contact.html'],
]

function navMarkup(active) {
  return NAV.map(
    ([label, href]) =>
      `        <a class="nav-link${href === active ? ' active' : ''}" href="${href}"${
        href === active ? ' aria-current="page"' : ''
      }>${label}</a>`,
  ).join('\n')
}

function pageHtml({ title, description, active, main }) {
  const raw = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${description}">
    <title>${title} — Northwind Studio</title>
    <link rel="stylesheet" href="css/style.css">
  </head>
  <body>
    <header class="site-header">
      <div class="container header-inner">
        <a class="brand" href="index.html">Northwind Studio</a>
        <nav class="site-nav" id="site-nav" aria-label="Primary">
${navMarkup(active)}
        </nav>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Toggle navigation menu">
          <span class="nav-toggle-bar"></span>
          <span class="nav-toggle-bar"></span>
          <span class="nav-toggle-bar"></span>
        </button>
      </div>
    </header>
    <main class="site-main">
${main}
    </main>
    <footer class="site-footer">
      <div class="container footer-grid">
        <div class="footer-brand">
          <p class="footer-blurb">Northwind Studio designs calm, fast websites for small teams who care about the details.</p>
        </div>
        <div class="footer-col">
          <h2 class="footer-heading">Explore</h2>
          <a class="footer-link" href="index.html">Home</a>
          <a class="footer-link" href="about.html">About</a>
          <a class="footer-link" href="services.html">Services</a>
        </div>
        <div class="footer-col">
          <h2 class="footer-heading">Contact</h2>
          <p class="footer-meta">hello@northwind.example</p>
          <p class="footer-meta">+1 555 0100</p>
        </div>
      </div>
      <div class="container footer-bar">
        <p class="footer-copy">© 2026 Northwind Studio</p>
      </div>
    </footer>
    <script src="js/main.js" defer></script>
  </body>
</html>
`
  const lines = raw.split('\n')
  const MIN_LINES = 132
  if (lines.length >= MIN_LINES) return raw
  const filler = []
  while (lines.length + filler.length < MIN_LINES) {
    filler.push('      <p class="prose">A short, concrete paragraph that gives the reader one useful fact and keeps the page genuinely complete.</p>')
  }
  const index = lines.findIndex((line) => line.includes('</main>'))
  return [...lines.slice(0, index), ...filler, ...lines.slice(index)].join('\n')
}

const EXISTING_MAIN = {
  'index.html': `      <section class="hero" id="home">
        <div class="container">
          <p class="eyebrow">Web studio</p>
          <h1 class="hero-title">We build calm, <span class="highlight">fast websites</span></h1>
          <p class="hero-sub">Northwind Studio plans, designs and ships websites that load quickly and read clearly on every device.</p>
          <a class="btn btn-primary" href="contact.html">Start a project</a>
        </div>
      </section>
      <section class="services" id="services">
        <div class="container">
          <h2 class="section-title">What we do</h2>
          <div class="card-grid">
            <article class="card"><h3 class="card-title">Planning</h3><p class="card-text">Content first, structure second, pixels last — every page earns its place.</p></article>
            <article class="card"><h3 class="card-title">Design</h3><p class="card-text">A single coherent design system keeps every screen on brand.</p></article>
            <article class="card"><h3 class="card-title">Build</h3><p class="card-text">Hand-written HTML, CSS and JavaScript with zero framework weight.</p></article>
          </div>
        </div>
      </section>`,
  'about.html': `      <section class="page-hero" id="page-hero">
        <div class="container">
          <h1 class="page-title">About Northwind Studio</h1>
          <p class="page-lead">A small team that ships thoughtful websites without the bloat.</p>
        </div>
      </section>
      <section class="story" id="story">
        <div class="container">
          <h2 class="section-title">Our story</h2>
          <p class="prose">We started in a shared office with one rule: never ship a page we would not read ourselves. That rule still guides every project.</p>
        </div>
      </section>`,
  'services.html': `      <section class="page-hero" id="page-hero">
        <div class="container">
          <h1 class="page-title">Services</h1>
          <p class="page-lead">Three focused offers, one predictable process.</p>
        </div>
      </section>
      <section class="service-list" id="offers">
        <div class="container">
          <h2 class="section-title">How we help</h2>
          <div class="card-grid">
            <article class="card"><h3 class="card-title">Launch</h3><p class="card-text">A complete marketing site in four weeks, copy included.</p></article>
            <article class="card"><h3 class="card-title">Refresh</h3><p class="card-text">Rework an existing site into a fast, accessible system.</p></article>
            <article class="card"><h3 class="card-title">Care</h3><p class="card-text">Monthly updates, content changes and performance checks.</p></article>
          </div>
        </div>
      </section>`,
}

const NEW_MAIN = {
  'team.html': `      <section class="page-hero" id="page-hero">
        <div class="container">
          <h1 class="page-title">Meet the team</h1>
          <p class="page-lead">Four people, one shared standard for honest, durable work.</p>
        </div>
      </section>
      <section class="team" id="team">
        <div class="container">
          <h2 class="section-title">Who you work with</h2>
          <div class="team-grid">
            <article class="team-card"><span class="avatar" aria-hidden="true">AK</span><h3 class="team-name">Amina Khan</h3><p class="team-role">Strategy and words</p><p class="team-bio">Turns vague briefs into sharp outlines and copy that earns the scroll.</p></article>
            <article class="team-card"><span class="avatar" aria-hidden="true">JR</span><h3 class="team-name">Jonas Reed</h3><p class="team-role">Design systems</p><p class="team-bio">Keeps type, spacing and colour honest across every template.</p></article>
            <article class="team-card"><span class="avatar" aria-hidden="true">ML</span><h3 class="team-name">Mira Lowe</h3><p class="team-role">Front-end build</p><p class="team-bio">Writes the HTML, CSS and JavaScript that make the design real.</p></article>
            <article class="team-card"><span class="avatar" aria-hidden="true">DP</span><h3 class="team-name">Dev Patel</h3><p class="team-role">Performance</p><p class="team-bio">Measures everything, removes what the page does not need.</p></article>
          </div>
        </div>
      </section>`,
  'pricing.html': `      <section class="page-hero" id="page-hero">
        <div class="container">
          <h1 class="page-title">Simple pricing</h1>
          <p class="page-lead">Fixed scope, fixed price, no surprise invoices.</p>
        </div>
      </section>
      <section class="pricing" id="plans">
        <div class="container">
          <h2 class="section-title">Plans</h2>
          <div class="pricing-grid">
            <article class="pricing-card"><h3 class="pricing-name">Starter</h3><p class="pricing-price">$1,200</p><p class="pricing-note">Up to four pages, one review round, delivered in two weeks.</p><a class="btn btn-secondary" href="contact.html">Choose Starter</a></article>
            <article class="pricing-card"><h3 class="pricing-name">Growth</h3><p class="pricing-price">$2,800</p><p class="pricing-note">Up to ten pages, two review rounds, copy editing included.</p><a class="btn btn-secondary" href="contact.html">Choose Growth</a></article>
            <article class="pricing-card"><h3 class="pricing-name">Care</h3><p class="pricing-price">$180/mo</p><p class="pricing-note">Monthly content updates, uptime checks and a performance report.</p><a class="btn btn-secondary" href="contact.html">Choose Care</a></article>
          </div>
        </div>
      </section>
      <section class="faq-section" id="faq">
        <div class="container">
          <h2 class="section-title">Frequently asked questions</h2>
          <div class="faq-list">
            <div class="faq-item"><button class="faq-question" type="button" aria-expanded="false" aria-controls="faq-a1">How long does a project take?</button><div class="faq-answer" id="faq-a1"><p>Most launches take two to four weeks depending on how much content you bring.</p></div></div>
            <div class="faq-item"><button class="faq-question" type="button" aria-expanded="false" aria-controls="faq-a2">Do you write the copy?</button><div class="faq-answer" id="faq-a2"><p>Yes — every plan includes a first draft of the page copy, reviewed with you before launch.</p></div></div>
            <div class="faq-item"><button class="faq-question" type="button" aria-expanded="false" aria-controls="faq-a3">Can you work with our designer?</button><div class="faq-answer" id="faq-a3"><p>Absolutely. We can build from an existing design system or create one for you.</p></div></div>
            <div class="faq-item"><button class="faq-question" type="button" aria-expanded="false" aria-controls="faq-a4">What do you need from us?</button><div class="faq-answer" id="faq-a4"><p>Brand basics, any existing content, and one decision maker for reviews.</p></div></div>
            <div class="faq-item"><button class="faq-question" type="button" aria-expanded="false" aria-controls="faq-a5">Do you host the site?</button><div class="faq-answer" id="faq-a5"><p>We deploy to your host of choice and hand over every file and account.</p></div></div>
          </div>
        </div>
      </section>`,
  'blog.html': `      <section class="page-hero" id="page-hero">
        <div class="container">
          <h1 class="page-title">Notes from the studio</h1>
          <p class="page-lead">Short, practical writing about building fast websites.</p>
        </div>
      </section>
      <section class="blog" id="posts">
        <div class="container">
          <h2 class="section-title">Latest posts</h2>
          <div class="blog-grid">
            <article class="blog-card"><p class="blog-tag">Performance</p><h3 class="blog-title">Why we still hand-write CSS</h3><p class="blog-excerpt">A stylesheet you can read beats a framework you cannot debug.</p><p class="blog-meta">Sep 2026 · 6 min read</p></article>
            <article class="blog-card"><p class="blog-tag">Content</p><h3 class="blog-title">Copy that survives a redesign</h3><p class="blog-excerpt">Write the structure first, the decoration second, and the words last forever.</p><p class="blog-meta">Aug 2026 · 5 min read</p></article>
            <article class="blog-card"><p class="blog-tag">Accessibility</p><h3 class="blog-title">Focus states are not optional</h3><p class="blog-excerpt">If a keyboard user cannot see where they are, the page is broken.</p><p class="blog-meta">Jul 2026 · 4 min read</p></article>
            <article class="blog-card"><p class="blog-tag">Process</p><h3 class="blog-title">The four-week launch plan</h3><p class="blog-excerpt">How we keep scope, review and delivery inside a single month.</p><p class="blog-meta">Jun 2026 · 7 min read</p></article>
          </div>
        </div>
      </section>`,
  'contact.html': `      <section class="page-hero" id="page-hero">
        <div class="container">
          <h1 class="page-title">Contact us</h1>
          <p class="page-lead">Tell us about the site you want to ship.</p>
        </div>
      </section>
      <section class="contact" id="contact-form">
        <div class="container contact-grid">
          <form class="contact-form" id="contact" aria-label="Contact form">
            <div class="form-field">
              <label class="form-label" for="name">Name</label>
              <input class="form-input" id="name" name="name" type="text" autocomplete="name" aria-describedby="name-error" required>
              <p class="form-error" id="name-error"></p>
            </div>
            <div class="form-field">
              <label class="form-label" for="email">Email</label>
              <input class="form-input" id="email" name="email" type="email" autocomplete="email" aria-describedby="email-error" required>
              <p class="form-error" id="email-error"></p>
            </div>
            <div class="form-field">
              <label class="form-label" for="subject">Subject</label>
              <input class="form-input" id="subject" name="subject" type="text" aria-describedby="subject-error" required>
              <p class="form-error" id="subject-error"></p>
            </div>
            <div class="form-field">
              <label class="form-label" for="message">Message</label>
              <textarea class="form-textarea" id="message" name="message" rows="6" aria-describedby="message-error" required></textarea>
              <p class="form-error" id="message-error"></p>
            </div>
            <button class="btn btn-primary" type="submit">Send message</button>
            <p class="form-success" hidden>Thanks — we reply within one business day.</p>
          </form>
          <aside class="contact-info" id="contact-info">
            <div class="info-card"><h2 class="info-title">Email</h2><p class="info-text">hello@northwind.example</p></div>
            <div class="info-card"><h2 class="info-title">Phone</h2><p class="info-text">+1 555 0100</p></div>
            <div class="info-card"><h2 class="info-title">Office hours</h2><p class="info-text">Monday to Friday, 9:00 to 17:00</p></div>
          </aside>
        </div>
      </section>`,
}

const BASE_CSS = `:root {
  --bg: #0f1720;
  --surface: #16222e;
  --text: #e8eef4;
  --muted: #9fb0c0;
  --primary: #3ea6ff;
  --accent: #7ef0c0;
  --border: #26384a;
  --radius: 14px;
  --space: 1.25rem;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
.container { width: min(1100px, 92%); margin: 0 auto; }
.site-header { position: sticky; top: 0; background: var(--surface); border-bottom: 1px solid var(--border); z-index: 10; }
.header-inner { display: flex; align-items: center; justify-content: space-between; gap: var(--space); padding: 0.9rem 0; }
.brand { font-weight: 700; color: var(--text); text-decoration: none; letter-spacing: 0.02em; }
.site-nav { display: flex; gap: 1rem; flex-wrap: wrap; }
.nav-link { color: var(--muted); text-decoration: none; padding: 0.35rem 0.5rem; border-radius: 8px; }
.nav-link:hover, .nav-link:focus-visible { color: var(--text); background: var(--border); }
.nav-link.active { color: var(--accent); }
.nav-toggle { display: none; background: none; border: 1px solid var(--border); border-radius: 8px; padding: 0.45rem 0.55rem; cursor: pointer; }
.nav-toggle-bar { display: block; width: 20px; height: 2px; background: var(--text); margin: 4px 0; }
.site-main { padding: 2.5rem 0; }
.services, .story, .service-list, .team, .pricing, .blog, .contact, .faq-section, .footer-brand { padding: 1.5rem 0; }
.hero, .page-hero { padding: 3rem 0; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.8rem; color: var(--accent); }
.hero-title, .page-title { font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.1; margin: 0.4rem 0 0.8rem; }
.highlight { color: var(--primary); }
.hero-sub, .page-lead, .prose, .card-text, .team-bio, .pricing-note, .blog-excerpt, .info-text, .footer-blurb, .footer-meta { color: var(--muted); }
.section-title { font-size: clamp(1.4rem, 3vw, 2rem); margin: 0 0 1.2rem; }
.card-grid, .team-grid, .pricing-grid, .blog-grid { display: grid; gap: var(--space); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.card, .team-card, .pricing-card, .blog-card, .info-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem; }
.card-title, .team-name, .pricing-name, .blog-title, .info-title, .footer-heading { margin: 0.2rem 0 0.5rem; font-size: 1.05rem; }
.avatar { display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 50%; background: var(--border); color: var(--accent); font-weight: 700; }
.team-role, .pricing-price, .blog-tag, .blog-meta, .footer-copy { color: var(--accent); font-size: 0.9rem; }
.btn { display: inline-block; padding: 0.7rem 1.2rem; border-radius: 999px; text-decoration: none; border: 1px solid var(--border); }
.btn-primary { background: var(--primary); color: #06121c; border-color: var(--primary); font-weight: 600; }
.btn-secondary { background: transparent; color: var(--primary); }
.btn:focus-visible, .nav-link:focus-visible, .form-input:focus-visible, .form-textarea:focus-visible, .nav-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.faq-list { display: grid; gap: 0.75rem; }
.faq-item { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 0.8rem 1rem; }
.faq-question { width: 100%; text-align: left; background: none; border: 0; color: var(--text); font-size: 1rem; cursor: pointer; padding: 0.3rem 0; }
.faq-answer { color: var(--muted); }
.contact-grid { display: grid; gap: 1.5rem; grid-template-columns: 1.4fr 1fr; align-items: start; }
.contact-form { display: grid; gap: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.4rem; }
.form-field { display: grid; gap: 0.35rem; }
.form-label { font-size: 0.9rem; color: var(--text); }
.form-input, .form-textarea { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 0.65rem 0.75rem; font: inherit; }
.form-textarea { resize: vertical; }
.form-error { color: #ff8f8f; font-size: 0.8rem; min-height: 1rem; margin: 0; }
.form-success { color: var(--accent); }
.contact-info { display: grid; gap: 1rem; }
.site-footer { border-top: 1px solid var(--border); background: var(--surface); padding: 2rem 0; }
.footer-grid { display: grid; gap: 1.2rem; grid-template-columns: 1.4fr 1fr 1fr; }
.footer-col { display: grid; gap: 0.4rem; align-content: start; }
.footer-link { color: var(--muted); text-decoration: none; }
.footer-link:hover, .footer-link:focus-visible { color: var(--text); }
.footer-bar { display: flex; justify-content: space-between; gap: 1rem; margin-top: 1.4rem; padding-top: 1rem; border-top: 1px solid var(--border); }
@media (max-width: 900px) {
  .site-nav { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--surface); flex-direction: column; padding: 1rem; border-bottom: 1px solid var(--border); }
  .site-nav.is-open { display: flex; }
  .nav-toggle { display: block; }
  .contact-grid, .footer-grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .hero, .page-hero { padding: 2rem 0; }
  .btn { display: block; text-align: center; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`

const APPEND_CSS = `
.team-card { text-align: center; }
.pricing-card { display: grid; gap: 0.6rem; }
.pricing-card.is-popular { border-color: var(--primary); }
.blog-card { display: grid; gap: 0.4rem; }
.info-card { margin-bottom: 0.8rem; }
.form-input, .form-textarea { width: 100%; }
`

const MAIN_JS = `document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('is-open', !open);
    });
  }
  const bars = document.querySelectorAll('.nav-toggle-bar');
  const year = document.querySelector('.footer-copy');
  if (year) {
    year.textContent = '© ' + new Date().getFullYear() + ' Northwind Studio';
  }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    });
    document.querySelectorAll('.team-card, .pricing-card, .blog-card, .info-card').forEach((element) => observer.observe(element));
  }
  document.querySelectorAll('.faq-question').forEach((button) => {
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
    });
  });
});
`

const NEW_PAGES = ['team.html', 'pricing.html', 'blog.html', 'contact.html']

async function buildFixture(root) {
  await fsp.mkdir(path.join(root, 'css'), { recursive: true })
  await fsp.mkdir(path.join(root, 'js'), { recursive: true })
  for (const [file, main] of Object.entries(EXISTING_MAIN)) {
    const html = pageHtml({ title: file.replace('.html', ''), description: `Northwind Studio ${file}`, active: file, main })
    await fsp.writeFile(path.join(root, file), html)
  }
  await fsp.writeFile(path.join(root, 'css', 'style.css'), BASE_CSS)
  await fsp.writeFile(path.join(root, 'js', 'main.js'), MAIN_JS)
}

const records = { requests: [], warns: [], events: [] }

const originalWarn = console.warn
console.warn = (...args) => {
  records.warns.push(args.join(' '))
  originalWarn(...args)
}

const RATE_HEADERS = {
  'x-ratelimit-limit-tokens': '200000',
  'x-ratelimit-remaining-tokens': '195000',
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...RATE_HEADERS },
  })
}

function sseResponse(message) {
  const frames = []
  const content = message.content ?? ''
  if (content) frames.push({ choices: [{ delta: { content } }] })
  for (const call of message.tool_calls ?? []) {
    frames.push({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: call.id, type: call.type, function: call.function }],
          },
        },
      ],
    })
  }
  frames.push({
    choices: [{ delta: {}, finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop' }],
    usage: { total_tokens: 12 },
  })
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}`).join('\n\n') + '\n\n'
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...RATE_HEADERS },
  })
}

const PLAN = {
  project_name: 'crafted-solutions',
  brand: { name: 'Northwind Studio', tagline: 'Calm websites', industry: 'web studio' },
  nav: [],
  files: NEW_PAGES.map((file) => ({ path: file, purpose: 'new page' })),
  pages: NEW_PAGES.map((file) => ({ file, sections: [] })),
  requirements: ['add 4 more pages: team, pricing, blog, contact'],
}

global.fetch = async (url, options) => {
  const target = String(url)
  if (target.endsWith('/models')) {
    return jsonResponse({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile' }] })
  }
  let parsed = {}
  try {
    parsed = JSON.parse(options?.body ?? '{}')
  } catch {}
  records.requests.push(parsed)
  const callNumber = records.requests.length

  let message
  if (callNumber <= NEW_PAGES.length) {
    const file = NEW_PAGES[callNumber - 1]
    const main = NEW_MAIN[file]
    const args = JSON.stringify({
      path: file,
      content: pageHtml({
        title: file.replace('.html', ''),
        description: `Northwind Studio ${file}`,
        active: file,
        main,
      }),
    })
    if (callNumber === 1) {
      message = {
        role: 'assistant',
        content: JSON.stringify(PLAN),
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'create_file', arguments: args } }],
      }
    } else {
      message = {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `call_${callNumber}`, type: 'function', function: { name: 'create_file', arguments: args } }],
      }
    }
  } else if (callNumber <= NEW_PAGES.length + 3) {
    const file = Object.keys(EXISTING_MAIN)[callNumber - NEW_PAGES.length - 1]
    message = {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${callNumber}`,
        type: 'function',
        function: {
          name: 'edit_file',
          arguments: JSON.stringify({
            path: file,
            content: pageHtml({ title: file.replace('.html', ''), description: `Northwind Studio ${file}`, active: file, main: EXISTING_MAIN[file] }),
          }),
        },
      }],
    }
  } else if (callNumber === NEW_PAGES.length + 4) {
    message = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_css', type: 'function', function: { name: 'append_to_file', arguments: JSON.stringify({ path: 'css/style.css', content: APPEND_CSS }) } }],
    }
  } else {
    message = { role: 'assistant', content: 'Done — added team, pricing, blog and contact pages, linked them in every nav and styled the new sections in the existing stylesheet.' }
  }
  if (parsed.stream) return sseResponse(message)
  return jsonResponse({ choices: [{ message, finish_reason: 'stop' }], usage: { total_tokens: 12 } })
}

const register = registerWorkspaceFolder('scratch-followup1', {
  ownerId: 'followup',
  folderName: 'modern-static-website',
})
const projectPath = path.join(tempRoot, register.container, register.folderName)
await buildFixture(projectPath)
const beforeName = getWorkspaceRecord('scratch-followup1')?.folderName

const watcherStarted = startWatchingProject('scratch-followup1', () => {}, null)
const shell = spawn(process.env.ComSpec || 'cmd.exe', [], { cwd: projectPath, stdio: 'ignore' })
await new Promise((resolve) => setTimeout(resolve, 500))

const adoption1 = await adoptScratchProject({
  projectId: 'scratch-followup1',
  task: 'add 4 more pages',
  userId: 'followup',
  modelSuggestedName: null,
  fresh: true,
  emit: () => {},
})
const adoption2 = await adoptScratchProject({
  projectId: 'scratch-followup1',
  task: 'add 4 more pages',
  userId: 'followup',
  modelSuggestedName: 'crafted-solutions',
  fresh: true,
  emit: () => {},
})

const run = await runAgent({
  projectId: 'scratch-followup1',
  task: 'add 4 more pages',
  framework: 'html',
  apiKeys: [{ id: 'k1', label: 'mock', provider: 'groq', plain: 'gsk_mockfollowupkey0000000000000001' }],
  emit: (event) => records.events.push(event),
  userId: 'followup',
  strictRules: [{ id: 'r1', text: 'Reply in English.' }],
  onProjectName: (name) =>
    adoptScratchProject({
      projectId: 'scratch-followup1',
      task: 'add 4 more pages',
      userId: 'followup',
      modelSuggestedName: name,
      fresh: true,
      emit: () => {},
    }),
})

shell.kill()
const afterName = getWorkspaceRecord('scratch-followup1')?.folderName
const renameWarns = records.warns.filter((text) => /rename failed|adoption failed/.test(text))

check('1: watcher was attached for the whole run', watcherStarted && getWatchedProjectIds().includes('scratch-followup1'))
check('2: a terminal with cwd inside the project was open', Number.isInteger(shell.pid) && shell.pid > 0, `pid=${shell.pid}`)
check('3: no rename was attempted on the named project', adoption1?.renamed === false && adoption2?.renamed === false, `adoption2.renamed=${adoption2?.renamed}`)
check('4: the folder kept its name', beforeName === 'modern-static-website' && afterName === 'modern-static-website', `${beforeName} -> ${afterName}`)
check('5: no EPERM / adoption warning was logged', renameWarns.length === 0, renameWarns.join(' | ').slice(0, 200))
check('6: the run finished', typeof run?.message === 'string' && run.toolCalls > 0, run?.message?.slice(0, 120))

const missing = NEW_PAGES.filter((file) => !fs.existsSync(path.join(projectPath, file)))
check('7: all 4 new pages were created', missing.length === 0, missing.join(', '))

const allPages = [...Object.keys(EXISTING_MAIN), ...NEW_PAGES]
const navGaps = []
for (const file of allPages) {
  const html = await fsp.readFile(path.join(projectPath, file), 'utf8').catch(() => '')
  for (const [, href] of NAV) {
    if (!html.includes(`href="${href}"`)) navGaps.push(`${file} -> ${href}`)
  }
}
check('8: every page links every other page (nav updated everywhere)', navGaps.length === 0, navGaps.slice(0, 6).join(', '))

const css = await fsp.readFile(path.join(projectPath, 'css', 'style.css'), 'utf8').catch(() => '')
check('9: new section CSS was added to the existing stylesheet', css.includes('pricing-card') && css.includes('team-card') && css.length > BASE_CSS.length)

const connection = await connectionCheck({ projectId: 'scratch-followup1' })
check('10: connection check passes at the end', connection.ok, connection.problems.slice(0, 4).join(' | '))

const gateEvent = [...records.events].reverse().find((event) => event.type === 'complete')
check('11: the run reports gatePassed', gateEvent?.details?.gatePassed === true, JSON.stringify(gateEvent?.details?.gateFailures ?? []).slice(0, 300))

const failedEvents = records.events.filter((event) => event.details?.status === 'error')
check('12: no tool action failed during the run (no "failed to create")', failedEvents.length === 0, failedEvents.map((event) => `${event.type}:${event.description}`).join(' | ').slice(0, 300))

const firstSystem = records.requests[0]?.messages?.find((message) => message.role === 'system')
check('13: system prompt carries the USER STRICT RULES block', String(firstSystem?.content ?? '').includes('USER STRICT RULES') && String(firstSystem?.content ?? '').includes('Reply in English.'))
check('14: system prompt carries the follow-up block', String(firstSystem?.content ?? '').includes('FOLLOW-UP TASK'))
check('15: no file on disk was written into a nested project folder', !fs.existsSync(path.join(projectPath, 'crafted-solutions')) && !fs.existsSync(path.join(projectPath, 'modern-static-website')))

console.warn = originalWarn
await closeAllWatchers()
console.log(`\n${passed}/${passed + failed} checks passed`)
await fsp.rm(tempRoot, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
