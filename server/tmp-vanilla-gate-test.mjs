import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSystemPrompt, resolveTier } from './src/agent/prompts/index.js'
import { vanillaGate } from './src/agent/quality/vanillaGate.js'
import { parsePlanJson } from './src/services/agentService.js'

let passed = 0
let failed = 0
function check(label, condition, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  ok   ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label} ${extra}`)
  }
}

const YEAR = new Date().getFullYear()
const FILLER =
  'We roast every batch by hand before sunrise and ship it the same afternoon, so each bag reaches your kitchen within a week of harvest. Every order is backed by a no-questions guarantee and our team answers questions within one working day.'
const copy = (lead) => `${lead} ${FILLER}`

const NAV = [
  { label: 'Home', href: 'index.html' },
  { label: 'Services', href: 'index.html#services' },
  { label: 'About', href: 'about.html' },
  { label: 'Blogs', href: 'index.html#blogs' },
  { label: 'Contact', href: 'contact.html' },
]

function header(active) {
  const links = NAV.map(
    (item) =>
      `        <a href="${item.href}"${item.label === active ? ' class="active" aria-current="page"' : ''}>${item.label}</a>`,
  ).join('\n')
  return `  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="index.html">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg>
        <span>Ember Lane</span>
      </a>
      <nav class="site-nav" id="primary-nav" aria-label="Main">
${links}
      </nav>
      <button class="hamburger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="primary-nav">
        <span></span>
      </button>
    </div>
  </header>`
}

function footer() {
  return `  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <p class="brand-blurb">Ember Lane is a small-batch coffee roastery in Portland.</p>
      </div>
      <div>
        <h2 class="footer-title">Quick Links</h2>
        <ul><li><a href="index.html">Home</a></li><li><a href="about.html">About</a></li></ul>
      </div>
      <div>
        <h2 class="footer-title">Contact</h2>
        <ul><li><a href="contact.html">Send a message</a></li></ul>
      </div>
      <div class="social">
        <a href="contact.html" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></a>
        <a href="contact.html" aria-label="X"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></a>
        <a href="contact.html" aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></a>
        <a href="contact.html" aria-label="LinkedIn"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></a>
      </div>
    </div>
    <p class="footer-bottom">(c) <span id="year">${YEAR}</span> Ember Lane</p>
  </footer>`
}

function head(title, description) {
  return `  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${description}" />
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css" />`
}

function icon() {
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /></svg>'
}

function cards(count, className, make) {
  return Array.from({ length: count }, (_, index) => make(index + 1, className)).join('\n')
}

function sectionTextItem(tag, className, lead) {
  return `        <${tag} class="${className}">
          ${copy(lead)}
          <a href="contact.html">Ask us anything</a>
        </${tag}>`
}

const services = cards(
  6,
  'service-card',
  (n) =>
    `        <article class="service-card">
          ${icon()}
          <h3>Service ${n}</h3>
          <p>${copy(`Roasting program number ${n} for homes and cafes.`)}</p>
          <a href="contact.html">Ask about service ${n}</a>
        </article>`,
)

const features = cards(
  4,
  'feature-row',
  (n) => `        <div class="feature-row">${icon()}<h3>Feature ${n}</h3><p>${copy('Built to last.')}</p></div>`,
)

const testimonials = cards(
  3,
  'testimonial',
  (n) =>
    `        <article class="testimonial">
          <p class="quote">${copy(`Testimonial ${n}: the best beans we have ordered.`)}</p>
          <div class="avatar" aria-hidden="true">AB</div>
          <p class="name">Guest ${n}</p>
          <p class="role">Cafe owner</p>
          <div class="rating" aria-label="5 out of 5">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7 7 0-6 4 2 7-6-4-6 4 2-7-6-4 7 0z" /></svg>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7 7 0-6 4 2 7-6-4-6 4 2-7-6-4 7 0z" /></svg>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7 7 0-6 4 2 7-6-4-6 4 2-7-6-4 7 0z" /></svg>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7 7 0-6 4 2 7-6-4-6 4 2-7-6-4 7 0z" /></svg>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7 7 0-6 4 2 7-6-4-6 4 2-7-6-4 7 0z" /></svg>
          </div>
        </article>`,
)

const blogs = cards(
  3,
  'post-card',
  (n) =>
    `        <article class="post-card">
          <div class="post-thumb" aria-hidden="true"></div>
          <span class="tag">Brewing</span>
          <h3>Post ${n}</h3>
          <p>${copy(`Post ${n} walks through our brewing routine.`)}</p>
          <p class="meta"><time datetime="${YEAR}-0${n}-1${n}">March ${n}, ${YEAR}</time> · 5 min read</p>
          <a href="index.html#blogs">Read post ${n}</a>
        </article>`,
)

const faq = Array.from(
  { length: 6 },
  (_, index) => `        <div class="faq-item">
          <h3><button type="button" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="faq-panel-${index}">Question ${index + 1}?</button></h3>
          <div class="faq-panel" id="faq-panel-${index}"${index === 0 ? '' : ' hidden'}>${copy('Yes, and here is the detail.')}</div>
        </div>`,
).join('\n')

const team = cards(
  4,
  'member',
  (n) => `        <article class="member">
          <div class="avatar" aria-hidden="true">M${n}</div>
          <h3>Member ${n}</h3>
          <p class="role">Roaster</p>
          <p>${copy(`Member ${n} has been roasting for a decade.`)}</p>
          <ul class="social" aria-label="Member ${n} links">
            <li><a href="contact.html" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></a></li>
            <li><a href="contact.html" aria-label="X"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></a></li>
            <li><a href="contact.html" aria-label="LinkedIn"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></a></li>
          </ul>
        </article>`,
)

const values = cards(
  4,
  'value-card',
  (n) => `        <article class="value-card"><h3>Value ${n}</h3><p>${copy('This is what guides us.')}</p></article>`,
)

const stats = cards(
  4,
  'stat',
  (n) => `        <div class="stat">
          <span class="stat-number" data-count="${10 * n}">0</span>
          <p>${copy(`Stat ${n} measures how far we have come.`)}</p>
        </div>`,
)

const story = cards(
  4,
  'timeline-item',
  (n) =>
    `        <li class="timeline-item"><h3>${YEAR - 4 + n}</h3><p>${copy(`Milestone ${n} changed how we roast.`)}</p></li>`,
)

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
${head('Ember Lane — small-batch coffee roasted in Portland', 'Ember Lane roasts small-batch coffee in Portland and ships it the day it is roasted.')}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
${header('Home')}
  <main id="main">
    <section id="hero" class="hero">
      <p class="eyebrow">Portland roastery since ${YEAR - 6}</p>
      <h1>Small-batch <span class="grad">coffee</span>, roasted the morning it ships</h1>
      <p>${copy('Coffee that tastes like the morning it was roasted.')}</p>
      <a class="btn" href="contact.html">Order a bag</a>
      <a class="btn btn-ghost" href="index.html#services">See our services</a>
      <div class="hero-visual" aria-hidden="true"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" /></svg></div>
      <ul class="trust">
        <li><strong data-count="4200">0</strong> bags roasted</li>
        <li><strong data-count="38">0</strong> cafes served</li>
      </ul>
    </section>
    <section id="services" class="services">
      <h2>What we do</h2>
      <div class="grid">
${services}
      </div>
    </section>
    <section id="features" class="features">
      <h2>Why Ember Lane</h2>
${features}
    </section>
    <section id="testimonials" class="testimonials">
      <h2>Loved by cafes and home brewers</h2>
      <div class="grid">
${testimonials}
      </div>
    </section>
    <section id="blogs" class="blogs">
      <h2>From the journal</h2>
      <div class="grid">
${blogs}
      </div>
    </section>
    <section id="faq" class="faq">
      <h2>Questions</h2>
${faq}
    </section>
    <section id="cta" class="cta">
      <h2>Never run out of good coffee</h2>
      <p>${copy('Start a subscription and we will keep the grinder full.')}</p>
      <a class="btn" href="contact.html">Start my subscription</a>
    </section>
  </main>
${footer()}
  <script src="js/main.js" defer></script>
</body>
</html>`

const aboutHtml = `<!DOCTYPE html>
<html lang="en">
<head>
${head('About Ember Lane — our roastery story', 'The story, mission and team behind Ember Lane small-batch coffee.')}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
${header('About')}
  <main id="main">
    <section id="page-hero" class="page-hero">
      <p class="eyebrow">Our story</p>
      <h1>We built Ember Lane to roast coffee we wanted to drink</h1>
      <p>${copy('A roastery run by brewers, for brewers.')}</p>
    </section>
    <section id="story" class="story">
      <h2>How we got here</h2>
      <ol class="timeline">
${story}
      </ol>
    </section>
    <section id="mission" class="mission">
      <h2>Mission</h2>
      <p>${copy('Make the freshest coffee in the city accessible.')}</p>
    </section>
    <section id="vision" class="vision">
      <h2>Vision</h2>
      <p>${copy('A neighbourhood roastery in every district.')}</p>
    </section>
    <section id="values" class="values">
      <h2>Values</h2>
      <div class="grid">
${values}
      </div>
    </section>
    <section id="stats" class="stats">
      <h2>By the numbers</h2>
${stats}
    </section>
    <section id="team" class="team">
      <h2>Meet the team</h2>
      <div class="grid">
${team}
      </div>
    </section>
  </main>
${footer()}
  <script src="js/main.js" defer></script>
</body>
</html>`

const contactHtml = `<!DOCTYPE html>
<html lang="en">
<head>
${head('Contact Ember Lane — orders and wholesale', 'Contact the Ember Lane roastery for orders, wholesale pricing and visits.')}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
${header('Contact')}
  <main id="main">
    <section id="page-hero" class="page-hero">
      <p class="eyebrow">Say hello</p>
      <h1>Talk to the roastery</h1>
      <p>${copy('Tell us what you drink and we will recommend a bag.')}</p>
    </section>
    <section id="contact-form" class="contact">
      <h2>Send us a message</h2>
      <p>${copy('Tell us what you drink and how you brew it.')}</p>
      <form class="contact-form" novalidate>
        <div class="field">
          <label for="name">Name</label>
          <input id="name" name="name" type="text" autocomplete="name" required />
          <p class="hint">The name we should greet you by.</p>
          <p class="error" data-error-for="name" hidden></p>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" required />
          <p class="hint">We reply within one working day.</p>
          <p class="error" data-error-for="email" hidden></p>
        </div>
        <div class="field">
          <label for="subject">Subject</label>
          <input id="subject" name="subject" type="text" autocomplete="off" required />
          <p class="hint">Order, wholesale or a visit.</p>
          <p class="error" data-error-for="subject" hidden></p>
        </div>
        <div class="field">
          <label for="message">Message</label>
          <textarea id="message" name="message" rows="6" required></textarea>
          <p class="hint">Tell us how you brew at home.</p>
          <p class="error" data-error-for="message" hidden></p>
        </div>
        <button class="btn" type="submit">Send message</button>
        <p class="form-success" id="form-success" hidden>Thanks — we will reply within one working day.</p>
      </form>
    </section>
    <section id="contact-info" class="contact-info">
      <h2>Visit the roastery</h2>
      <p>${copy('Drop in for a cupping session on Thursday afternoons.')}</p>
      ${sectionTextItem('p', 'info-card', 'Email us at hello@emberlane.example.')}
      ${sectionTextItem('p', 'info-card', 'Call us on +1 503 555 0134.')}
      ${sectionTextItem('p', 'info-card', 'Find us at 18 Alder Street, Portland.')}
      ${sectionTextItem('p', 'info-card', 'Open weekdays from seven in the morning.')}
      <div class="map" role="img" aria-label="Stylized map of the roastery"><svg viewBox="0 0 200 120"><rect width="200" height="120" /></svg></div>
      <h3>Opening hours</h3>
      <ul class="hours">
        <li>Monday: 7:00 - 16:00</li>
        <li>Tuesday: 7:00 - 16:00</li>
        <li>Wednesday: 7:00 - 16:00</li>
        <li>Thursday: 7:00 - 18:00</li>
        <li>Friday: 7:00 - 18:00</li>
      </ul>
    </section>
  </main>
${footer()}
  <script src="js/main.js" defer></script>
</body>
</html>`

const COMPONENTS = [
  'header', 'nav', 'hero', 'services', 'features', 'testimonials', 'blogs', 'faq', 'cta', 'footer',
  'form', 'map', 'stat', 'team', 'timeline', 'value', 'card', 'badge', 'btn', 'grid', 'avatar', 'field', 'skip-link', 'brand',
]
const cssRules = COMPONENTS.map(
  (name) => `.${name} {
  display: block;
  position: relative;
  margin: 0 auto;
  padding: var(--space-4) var(--space-3);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition), box-shadow var(--transition);
}

.${name}:hover,
.${name}:focus-visible {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}`,
).join('\n\n')

const css = `:root {
  --bg: #fbf6f0;
  --surface: #ffffff;
  --text: #2a1d16;
  --muted: #6b5b52;
  --primary: #b4552d;
  --primary-600: #8f3f1f;
  --accent: #f0b429;
  --border: #e6d9cf;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 1rem;
  --space-4: 1.5rem;
  --space-5: 2.5rem;
  --space-6: 4rem;
  --radius-sm: 6px;
  --radius-md: 14px;
  --radius-lg: 28px;
  --shadow-sm: 0 1px 2px rgb(42 29 22 / 8%);
  --shadow-md: 0 18px 40px rgb(42 29 22 / 14%);
  --container: 1160px;
  --transition: 200ms cubic-bezier(0.22, 1, 0.36, 1);
  --step-0: clamp(1rem, 0.95rem + 0.3vw, 1.125rem);
  --step-1: clamp(1.5rem, 1.2rem + 1vw, 2rem);
  --step-2: clamp(2rem, 1.4rem + 2.4vw, 3.25rem);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: var(--step-0);
  line-height: 1.65;
  color: var(--text);
  background: var(--bg);
}

.container {
  width: min(100% - 2rem, var(--container));
  margin-inline: auto;
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.reveal {
  opacity: 0;
  transform: translateY(18px);
}

.reveal.in-view {
  opacity: 1;
  transform: none;
}

.hero {
  background: linear-gradient(140deg, var(--primary), var(--accent));
  padding-block: var(--space-6);
}

.btn {
  background: linear-gradient(120deg, var(--primary), var(--accent));
  color: #fff;
  text-decoration: none;
}

${cssRules}

@media (min-width: 768px) {
  .grid {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
}

@media (min-width: 1024px) {
  .container {
    padding-inline: var(--space-4);
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17110e;
    --surface: #211815;
    --text: #f6ece5;
    --muted: #c6b3a8;
    --border: #3a2b25;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
`

const js = `document.addEventListener('DOMContentLoaded', function () {
  var header = document.querySelector('.site-header')
  var hamburger = document.querySelector('.hamburger')
  var nav = document.querySelector('.site-nav')
  var year = document.getElementById('year')
  var toTop = document.getElementById('back-to-top')

  if (year) year.textContent = String(new Date().getFullYear())

  if (hamburger && nav) {
    hamburger.addEventListener('click', function () {
      var open = hamburger.getAttribute('aria-expanded') === 'true'
      hamburger.setAttribute('aria-expanded', open ? 'false' : 'true')
      nav.classList.toggle('is-open', !open)
    })
    document.addEventListener('click', function (event) {
      if (!nav.contains(event.target) && !hamburger.contains(event.target)) {
        hamburger.setAttribute('aria-expanded', 'false')
        nav.classList.remove('is-open')
      }
    })
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        hamburger.setAttribute('aria-expanded', 'false')
        nav.classList.remove('is-open')
      }
    })
  }

  function onScroll() {
    if (!header) return
    header.classList.toggle('is-stuck', window.scrollY > 20)
    if (toTop) toTop.classList.toggle('is-visible', window.scrollY > 400)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  var reveals = document.querySelectorAll('.reveal')
  if ('IntersectionObserver' in window && reveals.length) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.15 })
    reveals.forEach(function (element) { observer.observe(element) })
  }

  document.querySelectorAll('.faq-item button[aria-expanded]').forEach(function (button) {
    button.addEventListener('click', function () {
      var expanded = button.getAttribute('aria-expanded') === 'true'
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true')
      var panel = document.getElementById(button.getAttribute('aria-controls'))
      if (panel) panel.hidden = expanded
    })
  })

  document.querySelectorAll('[data-count]').forEach(function (node) {
    var target = Number(node.getAttribute('data-count'))
    var step = Math.max(1, Math.round(target / 40))
    var current = 0
    var timer = setInterval(function () {
      current += step
      if (current >= target) {
        current = target
        clearInterval(timer)
      }
      node.textContent = String(current)
    }, 30)
  })

  var form = document.querySelector('.contact-form')
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var valid = true
      var emailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
      var fields = ['name', 'email', 'subject', 'message']
      fields.forEach(function (name) {
        var input = form.elements[name]
        var error = form.querySelector('[data-error-for="' + name + '"]')
        if (!input || !error) return
        var value = String(input.value || '').trim()
        var message = ''
        if (input.hasAttribute('required') && !value) message = 'This field is required.'
        else if (name === 'email' && !emailPattern.test(value)) message = 'Enter a valid email address.'
        else if (name === 'message' && value.length < 10) message = 'Please write at least 10 characters.'
        error.textContent = message
        error.hidden = !message
        if (message) valid = false
      })
      var success = document.getElementById('form-success')
      if (valid) {
        if (success) success.hidden = false
        form.reset()
      } else if (success) {
        success.hidden = true
      }
    })
  }

  document.querySelectorAll('a[href^="#"], a[href*="index.html#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      var hash = String(link.getAttribute('href') || '').split('#')[1]
      var target = hash ? document.getElementById(hash) : null
      if (!target) return
      event.preventDefault()
      var offset = header ? header.offsetHeight : 0
      var top = target.getBoundingClientRect().top + window.scrollY - offset
      var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: top, behavior: reduced ? 'auto' : 'smooth' })
    })
  })

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }
})
`

function writeSite(root, { index = indexHtml, about = aboutHtml, contact = contactHtml, cssText = css, jsText = js } = {}) {
  fs.mkdirSync(path.join(root, 'css'), { recursive: true })
  fs.mkdirSync(path.join(root, 'js'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), index)
  fs.writeFileSync(path.join(root, 'about.html'), about)
  fs.writeFileSync(path.join(root, 'contact.html'), contact)
  fs.writeFileSync(path.join(root, 'css', 'style.css'), cssText)
  fs.writeFileSync(path.join(root, 'js', 'main.js'), jsText)
}

function lineCounts(root) {
  const counts = {}
  for (const file of ['index.html', 'about.html', 'contact.html', 'css/style.css', 'js/main.js']) {
    counts[file] = fs.readFileSync(path.join(root, file), 'utf8').split('\n').length
  }
  return counts
}

const PLAN = {
  project_name: 'ember-lane-coffee',
  brand: {
    name: 'Ember Lane',
    tagline: 'Small-batch coffee, roasted the morning it ships',
    industry: 'specialty coffee roastery',
    palette: { primary: '#b4552d', accent: '#f0b429', background: '#fbf6f0', text: '#2a1d16' },
    fontStack: 'Inter, system-ui, sans-serif',
  },
  nav: NAV,
  files: [
    { path: 'index.html', purpose: 'home' },
    { path: 'about.html', purpose: 'about' },
    { path: 'contact.html', purpose: 'contact' },
    { path: 'css/style.css', purpose: 'styles' },
    { path: 'js/main.js', purpose: 'behaviour' },
  ],
  pages: [
    { file: 'index.html', sections: ['hero', 'services', 'features', 'testimonials', 'blogs', 'faq', 'cta'] },
    { file: 'about.html', sections: ['page-hero', 'story', 'mission', 'vision', 'values', 'stats', 'team'] },
    { file: 'contact.html', sections: ['page-hero', 'contact-form', 'contact-info'] },
  ],
  requirements: ['pure HTML/CSS/JS', 'nav Home, Services, About, Blogs, Contact'],
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanilla-gate-'))

try {
  console.log('1. prompt composer')
  const full = buildSystemPrompt({ framework: 'html', tier: 'full', now: new Date('2026-09-28T08:00:00') })
  const compact = buildSystemPrompt({ framework: 'html', tier: 'compact', now: new Date('2026-09-28T08:00:00') })
  check('full prompt contains the runtime date', full.includes('Current date: 2026-09-28. Current year: 2026.'))
  check('runtime context forbids earlier years', full.includes('Never use an earlier year as the current year'))
  check('full prompt has the design system', full.includes('--primary-600') && full.includes('prefers-reduced-motion'))
  check('compact tier is shorter than full', compact.length < full.length, `${compact.length} vs ${full.length}`)
  check('compact keeps the section ids', compact.includes('SECTION IDS (exact)'))
  check('groq limit resolves to compact', resolveTier({ tpm: 8000 }) === 'compact')
  check('mistral limit resolves to full', resolveTier({ tpm: 500000 }) === 'full')
  check('react gets a stub, not the vanilla blueprint', !buildSystemPrompt({ framework: 'react' }).includes('SECTION IDS'))

  console.log('2. plan JSON parsing')
  const parsedPlan = parsePlanJson(`Here is my plan:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\`\nStarting now.`)
  check('parses a fenced plan', parsedPlan?.projectName === 'ember-lane-coffee')
  check('keeps the five planned files', parsedPlan?.files.length === 5)
  check('keeps the page section map', parsedPlan?.pages[1].sections.includes('team'))
  check('keeps the nav', parsedPlan?.nav.length === 5 && parsedPlan.nav[1].href === 'index.html#services')
  check('rejects prose without JSON', parsePlanJson('I will build a site for you.') === null)

  console.log('3. quality gate on a complete vanilla site')
  writeSite(root)
  const counts = lineCounts(root)
  console.log(`   line counts ${JSON.stringify(counts)}`)
  const good = await vanillaGate({ root, plan: PLAN })
  check('complete site passes the gate', good.ok, JSON.stringify(good.failures.slice(0, 6), null, 2))
  check('gate reports every check group', good.checks.length === 7, String(good.checks.length))

  console.log('4. quality gate catches broken output')
  writeSite(root, {
    about: aboutHtml.replace('<meta name="description"', '<meta name="x-description"').replace('id="team"', 'id="crew"'),
    index: indexHtml
      .replace('<a class="btn btn-ghost" href="index.html#services">', '<a class="btn btn-ghost" href="#">')
      .replace('aria-expanded="false" aria-controls="faq-panel-4"', 'data-noop="1"')
      .replace('aria-expanded="false" aria-controls="faq-panel-5"', 'data-noop="2"')
      .replace('<p class="brand-blurb">', '<img src="https://example.com/logo.png" alt="" /><p class="brand-blurb">')
      .replace(`(c) <span id="year">${YEAR}</span>`, '(c) <span id="yearless">2020</span>'),
    cssText: css
      .replace(':root {', ':base {')
      .replace(':root {', ':base {')
      .replace(':root {', ':base {'),
    jsText: js.replaceAll('IntersectionObserver', 'IO').replace('getFullYear', 'yearNow'),
  })
  const bad = await vanillaGate({ root, plan: PLAN })
  const text = bad.failures.join('\n')
  check('fails the broken site', bad.ok === false)
  check('catches the missing description', text.includes('description'))
  check('catches the missing #team section', text.includes('id="team"'))
  check('catches href="#"', text.includes('href="#"'))
  check('catches the short faq', text.includes('#faq section needs at least 5'))
  check('catches the remote image', text.includes('remote <img'))
  check('catches the footer year', text.includes('footer copyright year'))
  check('catches the missing :root block', text.includes(':root block'))
  check('catches the missing IntersectionObserver', text.includes('IntersectionObserver'))
  check('catches the missing getFullYear', text.includes('getFullYear'))
  check('catches the renamed section id', bad.failures.some((failure) => failure.includes('crew') || failure.includes('team')))

  console.log('5. gate catches shorthand files and header drift')
  writeSite(root, {
    about: aboutHtml.replace(
      'class="active" aria-current="page">About</a>',
      'class="active" aria-current="page">About us</a>',
    ),
    cssText: ':base { color: red; }',
    jsText: 'var x = ',
  })
  const short = await vanillaGate({ root, plan: PLAN })
  const shortText = short.failures.join('\n')
  check('catches a file below the line threshold', shortText.includes('at least 400 lines'))
  check('catches js that does not compile', shortText.includes('does not compile'))
  check('catches header drift between pages', shortText.includes('header nav labels or hrefs differ'))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
