import { DEFAULT_THEME_ID, getThemePreset } from './themes.js'
import { buildPageShell, relativeHref } from './scaffold.js'
import { ICON_FALLBACK, ICONS_SCRIPT, hasIcon } from './icons.js'
import { SECTION_SNIPPETS, SECTION_TYPES } from './snippets.js'

const TYPE_ALIASES = {
  banner: 'hero',
  header: 'hero',
  home: 'hero',
  service: 'services',
  feature: 'features',
  benefit: 'features',
  benefits: 'features',
  stat: 'stats',
  numbers: 'stats',
  metrics: 'stats',
  testimonial: 'testimonials',
  review: 'testimonials',
  reviews: 'testimonials',
  quotes: 'testimonials',
  plans: 'pricing',
  packages: 'pricing',
  price: 'pricing',
  faqs: 'faq',
  questions: 'faq',
  accordion: 'faq',
  process: 'steps',
  howitworks: 'steps',
  'how-it-works': 'steps',
  workflow: 'steps',
  gallery: 'gallery',
  work: 'gallery',
  portfolio: 'gallery',
  showcase: 'gallery',
  projects: 'gallery',
  story: 'about',
  aboutus: 'about',
  'about-us': 'about',
  bio: 'about',
  form: 'contact',
  contactform: 'contact',
  'contact-form': 'contact',
  enquiry: 'contact',
  contactinfo: 'contact-info',
  'contact-info': 'contact-info',
  details: 'contact-info',
  pagehero: 'page-hero',
  'page-hero': 'page-hero',
  values: 'values',
  mission: 'mission',
  blog: 'blogs',
  articles: 'blogs',
  cta: 'cta',
  'call-to-action': 'cta',
}

export const COMPOSABLE_SECTION_TYPES = [
  'hero', 'page-hero', 'services', 'features', 'stats', 'testimonials',
  'pricing', 'steps', 'faq', 'gallery', 'about', 'team', 'contact',
  'contact-info', 'values', 'mission', 'blogs', 'cta',
]

const NAV_SECTION_TYPES = new Set([
  'services', 'features', 'about', 'pricing', 'testimonials', 'faq', 'stats',
  'team', 'gallery', 'steps', 'blogs', 'values', 'mission', 'contact', 'contact-info', 'cta',
])

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function slug(value, fallback = 'section') {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return text || fallback
}

function iconTag(name) {
  const icon = hasIcon(name) ? name : ICON_FALLBACK
  return `<i class="icon" data-icon="${icon}" aria-hidden="true"></i>`
}

function labelForType(type) {
  if (type === 'page-hero') return 'Overview'
  if (type === 'contact-info') return 'Contact'
  if (type === 'steps') return 'How it works'
  if (type === 'faq') return 'FAQ'
  if (type === 'blogs') return 'Latest'
  return String(type ?? '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function normalizeSectionType(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  if (!raw) return null
  const aliased = TYPE_ALIASES[raw] ?? raw
  if (COMPOSABLE_SECTION_TYPES.includes(aliased)) return aliased
  if (SECTION_TYPES.includes(aliased)) return aliased
  return null
}

function sectionId(section, fallback) {
  return slug(section?.id ?? section?.section ?? fallback, fallback)
}

function sectionTitle(section, type) {
  return String(section?.title ?? section?.heading ?? '').trim() || labelForType(type)
}

function sectionBlock({ type, id, title, className = 'section', inner }) {
  return `<section class="${className}" id="${id}" data-section="${type}" data-title="${escapeHtml(
    title,
  )}">\n${inner}\n</section>`
}

function sectionHeader(section, type, { left = false } = {}) {
  const eyebrow = String(section?.eyebrow ?? '').trim()
  const title = sectionTitle(section, type)
  const lead = String(section?.lead ?? section?.body ?? '').trim()
  const pieces = []
  if (eyebrow) pieces.push(`      <p class="section-header__eyebrow">${escapeHtml(eyebrow)}</p>`)
  pieces.push(`      <h2 class="section-header__title">${escapeHtml(title)}</h2>`)
  if (lead) pieces.push(`      <p class="section-header__lead">${escapeHtml(lead)}</p>`)
  return `<div class="section-header${left ? ' section-header--left' : ''} reveal">\n${pieces.join('\n')}\n    </div>`
}

function button(spec, fallback, ctx, { primary = true } = {}) {
  const buttonSpec = spec && typeof spec === 'object' ? spec : {}
  const label = String(buttonSpec.label ?? '').trim() || fallback
  const href = String(buttonSpec.href ?? '').trim() || (ctx.hasContact ? `#${ctx.contactId || 'contact'}` : '#main')
  const variant = primary ? 'btn--primary' : 'btn--secondary'
  return `<a class="btn ${variant} btn--lg" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
}

function items(section) {
  return Array.isArray(section?.items) ? section.items.filter(Boolean) : []
}

function renderHero(section, ctx) {
  const type = 'hero'
  const id = sectionId(section, 'hero')
  const title = String(section?.title ?? '').trim() || 'A clear promise for the visitor'
  const highlight = String(section?.highlight ?? '').trim()
  const eyebrow = String(section?.eyebrow ?? '').trim()
  const lead = String(section?.lead ?? section?.body ?? '').trim()
  const stats = Array.isArray(section?.stats) ? section.stats.filter(Boolean) : []
  const buttons = Array.isArray(section?.buttons) ? section.buttons : []
  const card = section?.card && typeof section.card === 'object' ? section.card : {}
  const titleHtml = highlight
    ? `${escapeHtml(title)} <span class="hero__highlight">${escapeHtml(highlight)}</span>`
    : escapeHtml(title)
  const proof = stats
    .slice(0, 3)
    .map(
      (stat) =>
        `          <div class="stat"><span class="stat__value">${escapeHtml(
          stat.value ?? '',
        )}</span><span class="stat__label">${escapeHtml(stat.label ?? '')}</span></div>`,
    )
    .join('\n')
  const cardStats = (Array.isArray(card.stats) ? card.stats : stats)
    .slice(0, 3)
    .map(
      (stat) =>
        `            <div class="stat"><span class="stat__value">${escapeHtml(
          stat.value ?? '',
        )}</span><span class="stat__label">${escapeHtml(stat.label ?? '')}</span></div>`,
    )
    .join('\n')
  const cardTitle = String(card.title ?? '').trim() || highlight || labelForType(type)
  const cardText = String(card.text ?? '').trim() || lead || 'Built to help visitors act with confidence.'
  const cardInner = [
    `          <span class="icon-badge icon-badge--lg">${iconTag(card.icon || 'sparkle')}</span>`,
    `          <h3>${escapeHtml(cardTitle)}</h3>`,
    `          <p class="card__text">${escapeHtml(cardText)}</p>`,
    cardStats ? `          <div class="hero__proof">\n${cardStats}\n          </div>` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const inner = [
    `    <span class="hero__blob" aria-hidden="true"></span>`,
    `    <div class="container hero__inner">`,
    `      <div class="hero__content reveal">`,
    eyebrow ? `        <p class="hero__eyebrow">${escapeHtml(eyebrow)}</p>` : '',
    `        <h1 class="hero__title">${titleHtml}</h1>`,
    lead ? `        <p class="hero__lead">${escapeHtml(lead)}</p>` : '',
    `        <div class="hero__actions">`,
    `          ${button(buttons[0], 'Get started', ctx, { primary: true })}`,
    buttons[1] || section?.secondary
      ? `          ${button(buttons[1] ?? section?.secondary, 'See what we do', ctx, { primary: false })}`
      : '',
    `        </div>`,
    proof ? `        <div class="hero__proof">\n${proof}\n        </div>` : '',
    `      </div>`,
    `      <div class="hero__visual reveal" aria-hidden="true">`,
    `        <div class="hero__card">`,
    cardInner,
    `        </div>`,
    `      </div>`,
    `    </div>`,
  ]
    .filter(Boolean)
    .join('\n')
  return sectionBlock({ type, id, title, className: 'hero', inner })
}

function renderPageHero(section) {
  const type = 'page-hero'
  const id = sectionId(section, 'page-hero')
  const title = sectionTitle(section, type)
  const eyebrow = String(section?.eyebrow ?? '').trim()
  const lead = String(section?.lead ?? section?.body ?? '').trim()
  const home = String(section?.homeHref ?? 'index.html')
  const inner = [
    `    <div class="container page-hero__inner">`,
    `      <ol class="breadcrumbs"><li><a class="breadcrumb-link" href="${escapeHtml(home)}">Home</a></li><li aria-hidden="true">/</li><li>${escapeHtml(title)}</li></ol>`,
    eyebrow ? `      <p class="page-hero__eyebrow">${escapeHtml(eyebrow)}</p>` : '',
    `      <h1 class="page-hero__title">${escapeHtml(title)}</h1>`,
    lead ? `      <p class="page-hero__lead">${escapeHtml(lead)}</p>` : '',
    `    </div>`,
  ]
    .filter(Boolean)
    .join('\n')
  return sectionBlock({ type, id, title, className: 'page-hero', inner })
}

function cardGrid(type, section, { gridClass, renderItem }) {
  const id = sectionId(section, type)
  const list = items(section)
  const columns = Math.min(Math.max(items(section).length, 1), 4)
  const grid = gridClass || `grid grid--${columns === 1 ? 1 : columns}`
  const cards = list.map((item) => renderItem(item)).join('\n')
  const inner = [
    `    <div class="container">`,
    section?.eyebrow || section?.lead || section?.title ? `${sectionHeader(section, type)}\n` : '',
    `      <div class="${grid}">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section', inner })
}

function renderServices(section) {
  const renderItem = (item) => `      <article class="service-card reveal">
        <span class="service-card__icon">${iconTag(item.icon || 'layers')}</span>
        <h3 class="service-card__title">${escapeHtml(item.title ?? '')}</h3>
        <p class="service-card__text">${escapeHtml(item.text ?? '')}</p>${
        item.link
          ? `\n        <a class="link link--arrow service-card__link" href="${escapeHtml(
              item.link,
            )}">${escapeHtml(item.linkLabel ?? 'Enquire')}</a>`
          : ''
      }
      </article>`
  return cardGrid('services', section, { renderItem })
}

function renderFeatures(section) {
  const renderItem = (item) => `      <div class="feature reveal">
        <span class="feature__icon">${iconTag(item.icon || 'zap')}</span>
        <div class="feature__body"><h3 class="feature__title">${escapeHtml(
          item.title ?? '',
        )}</h3><p class="feature__text">${escapeHtml(item.text ?? '')}</p></div>
      </div>`
  return cardGrid('features', section, { gridClass: 'grid grid--2', renderItem })
}

function renderGallery(section) {
  const renderItem = (item) => `      <article class="card reveal">
        <span class="card__icon">${iconTag(item.icon || 'palette')}</span>
        <h3 class="card__title">${escapeHtml(item.title ?? '')}</h3>
        <p class="card__text">${escapeHtml(item.text ?? '')}</p>
      </article>`
  return cardGrid('gallery', section, { renderItem })
}

function renderStats(section) {
  const type = 'stats'
  const id = sectionId(section, 'stats')
  const list = items(section)
  const stats = list
    .map(
      (item) =>
        `        <div class="stat"><span class="stat__value">${escapeHtml(
          item.value ?? '',
        )}</span><span class="stat__label">${escapeHtml(item.label ?? item.title ?? '')}</span></div>`,
    )
    .join('\n')
  const inner = `    <div class="container">\n      <div class="stats reveal">\n${stats}\n      </div>\n    </div>`
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section section--tight', inner })
}

function renderTestimonials(section) {
  const type = 'testimonials'
  const id = sectionId(section, 'testimonials')
  const list = items(section)
  const stars =
    '<i class="icon" data-icon="star" aria-hidden="true"></i>'.repeat(5)
  const cards = list
    .map((item) => {
      const initials = String(item.name ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
      return `      <figure class="testimonial reveal">
        <div class="rating" aria-label="5 out of 5">${stars}</div>
        <blockquote class="testimonial__quote">${escapeHtml(item.quote ?? '')}</blockquote>
        <figcaption class="testimonial__meta">
          <span class="testimonial__avatar" aria-hidden="true">${escapeHtml(initials || 'AB')}</span>
          <span><span class="testimonial__name">${escapeHtml(
            item.name ?? '',
          )}</span><span class="testimonial__role">${escapeHtml(item.role ?? '')}</span></span>
        </figcaption>
      </figure>`
    })
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="grid grid--3">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section', inner })
}

function renderPricing(section) {
  const type = 'pricing'
  const id = sectionId(section, 'pricing')
  const list = items(section)
  const featuredIndex = list.findIndex((item) => item?.featured)
  const cards = list
    .map((item, index) => {
      const isFeatured = item?.featured || (featuredIndex === -1 && index === Math.floor(list.length / 2))
      const features = (Array.isArray(item.features) ? item.features : [])
        .map(
          (feature) =>
            `          <li class="price-feature">${iconTag('check')} ${escapeHtml(
              typeof feature === 'string' ? feature : feature?.label ?? '',
            )}</li>`,
        )
        .join('\n')
      return `      <article class="pricing-card reveal${isFeatured ? ' pricing-card--featured' : ''}">
        <p class="pricing-card__name">${escapeHtml(item.name ?? '')}</p>
        <p class="pricing-card__price">${escapeHtml(item.price ?? '')} <span class="pricing-card__period">${escapeHtml(
          item.period ?? '',
        )}</span></p>
        <ul class="pricing-card__features">
${features}
        </ul>
        <a class="btn btn--primary pricing-card__cta" href="${escapeHtml(
          item.href ?? '#contact',
        )}">${escapeHtml(item.cta ?? 'Choose plan')}</a>
      </article>`
    })
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="grid grid--3">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section section--alt', inner })
}

function renderSteps(section) {
  const type = 'steps'
  const id = sectionId(section, 'steps')
  const list = items(section)
  const steps = list
    .map(
      (item, index) => `      <div class="process-step reveal"><span class="process-step__number">${
        item.number ?? index + 1
      }</span><h3 class="process-step__title">${escapeHtml(
        item.title ?? '',
      )}</h3><p class="process-step__text">${escapeHtml(item.text ?? '')}</p></div>`,
    )
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="process">`,
    steps,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section', inner })
}

function renderFaq(section) {
  const type = 'faq'
  const id = sectionId(section, 'faq')
  const list = items(section)
  const itemsHtml = list
    .map((item, index) => {
      const panelId = `${id}-${index + 1}`
      return `      <div class="faq-item">
        <h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="${panelId}">${escapeHtml(
        item.question ?? item.title ?? '',
      )} ${iconTag('chevron-down')}</button></h3>
        <div class="faq-item__panel" id="${panelId}"><p class="faq-item__answer">${escapeHtml(
        item.answer ?? item.text ?? '',
      )}</p></div>
      </div>`
    })
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="faq reveal">`,
    itemsHtml,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section section--alt', inner })
}

function renderTeam(section) {
  const type = 'team'
  const id = sectionId(section, 'team')
  const list = items(section)
  const cards = list
    .map((item) => {
      const initials = String(item.name ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
      return `      <article class="team-card reveal">
        <span class="team-card__avatar" aria-hidden="true">${escapeHtml(initials || 'AB')}</span>
        <h3 class="team-card__name">${escapeHtml(item.name ?? '')}</h3>
        <p class="team-card__role">${escapeHtml(item.role ?? '')}</p>
        <p class="team-card__bio">${escapeHtml(item.bio ?? item.text ?? '')}</p>
        <div class="team-card__social"><a class="social-link" href="${escapeHtml(
          item.href ?? 'https://www.linkedin.com',
        )}" aria-label="${escapeHtml(item.name ?? 'Team member')} on LinkedIn">${iconTag('linkedin')}</a></div>
      </article>`
    })
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="team">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section section--alt', inner })
}

function renderAbout(section) {
  const type = 'about'
  const id = sectionId(section, 'about')
  const list = items(section)
  const paragraphs = String(section?.body ?? section?.lead ?? '')
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => `        <p class="card__text">${escapeHtml(text)}</p>`)
    .join('\n')
  const milestones = list
    .map(
      (item) => `        <li class="timeline-item"><span class="timeline-item__year">${escapeHtml(
        item.year ?? item.value ?? '',
      )}</span><h3 class="timeline-item__title">${escapeHtml(
        item.title ?? '',
      )}</h3><p class="timeline-item__text">${escapeHtml(item.text ?? '')}</p></li>`,
    )
    .join('\n')
  const inner = [
    `    <div class="container story">`,
    sectionHeader(section, type, { left: true }),
    paragraphs ? `      <div class="card reveal">\n${paragraphs}\n      </div>` : '',
    milestones ? `      <ol class="story-timeline reveal">\n${milestones}\n      </ol>` : '',
    `    </div>`,
  ]
    .filter(Boolean)
    .join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section', inner })
}

function formField({ id, label, name, type = 'text', placeholder, required = true, textarea = false, autocomplete }) {
  const control = textarea
    ? `<textarea class="form-textarea" id="${id}" name="${name}" rows="6" placeholder="${escapeHtml(
        placeholder ?? '',
      )}"${required ? ' required' : ''}></textarea>`
    : `<input class="form-input" id="${id}" name="${name}" type="${type}"${
        autocomplete ? ` autocomplete="${autocomplete}"` : ''
      } placeholder="${escapeHtml(placeholder ?? '')}"${required ? ' required' : ''}>`
  return `        <div class="form-field">
          <label class="form-label" for="${id}">${escapeHtml(label)}</label>
          ${control}
          <span class="form-error" data-error-for="${id}"></span>
        </div>`
}

function renderContact(section) {
  const type = 'contact'
  const id = sectionId(section, 'contact')
  const title = sectionTitle(section, type)
  const form = section?.form && typeof section.form === 'object' ? section.form : {}
  const submitLabel = String(form.submit ?? '').trim() || 'Send message'
  const success =
    String(form.success ?? '').trim() ||
    'Thanks — your message has been received. We will reply within one working day.'
  const topFields = [
    formField({ id: 'name', label: 'Full name', name: 'name', placeholder: 'Alex Morgan', autocomplete: 'name' }),
    formField({
      id: 'email',
      label: 'Email address',
      name: 'email',
      type: 'email',
      placeholder: 'alex@company.com',
      autocomplete: 'email',
    }),
  ].join('\n')
  const lowerFields = [
    formField({ id: 'subject', label: 'Subject', name: 'subject', placeholder: 'How can we help?', required: false }),
    formField({
      id: 'message',
      label: 'Message',
      name: 'message',
      placeholder: 'Tell us about your project, timeline and budget.',
      textarea: true,
    }),
  ].join('\n')
  const infoItems = items(section)
  const infoCards = infoItems.length > 0
    ? infoItems
        .map(
          (item) => `        <div class="info-card"><span class="info-card__icon">${iconTag(
            item.icon || 'mail',
          )}</span><h3 class="info-card__title">${escapeHtml(
            item.title ?? '',
          )}</h3><p class="info-card__text">${escapeHtml(item.text ?? '')}</p></div>`,
        )
        .join('\n')
    : `        <div class="info-card"><span class="info-card__icon">${iconTag(
        'mail',
      )}</span><h3 class="info-card__title">Email</h3><p class="info-card__text">hello@example.com</p></div>`
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="contact-layout">`,
    `        <form class="form reveal" data-validate novalidate>`,
    `          <div class="form-grid">`,
    topFields,
    `          </div>`,
    lowerFields,
    `          <div class="form-actions">`,
    `            <button class="btn btn--primary btn--lg" type="submit">${escapeHtml(submitLabel)}</button>`,
    `            <span class="form-hint">We reply within one working day.</span>`,
    `          </div>`,
    `          <p class="form-success" role="status">${escapeHtml(success)}</p>`,
    `        </form>`,
    `        <div class="contact-info reveal">`,
    infoCards,
    `        </div>`,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title, className: 'section', inner })
}

function renderContactInfo(section) {
  const type = 'contact-info'
  const id = sectionId(section, 'contact-info')
  const list = items(section)
  const cards = (list.length > 0 ? list : [{ icon: 'mail', title: 'Email', text: 'hello@example.com' }])
    .map(
      (item) => `      <div class="info-card"><span class="info-card__icon">${iconTag(
        item.icon || 'mail',
      )}</span><h3 class="info-card__title">${escapeHtml(
        item.title ?? '',
      )}</h3><p class="info-card__text">${escapeHtml(item.text ?? '')}</p></div>`,
    )
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="contact-info reveal">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section section--alt', inner })
}

function renderValues(section) {
  const type = 'values'
  const id = sectionId(section, 'values')
  const list = items(section)
  const cards = list
    .map(
      (item) => `      <article class="value-card reveal"><span class="value-card__icon">${iconTag(
        item.icon || 'shield',
      )}</span><h3 class="value-card__title">${escapeHtml(
        item.title ?? '',
      )}</h3><p class="value-card__text">${escapeHtml(item.text ?? '')}</p></article>`,
    )
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="values-grid">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section', inner })
}

function renderMission(section) {
  const type = 'mission'
  const id = sectionId(section, 'mission')
  const list = items(section)
  const cards = (list.length > 0 ? list : [])
    .map(
      (item) => `      <article class="card reveal"><span class="card__icon">${iconTag(
        item.icon || 'sparkle',
      )}</span><h3 class="card__title">${escapeHtml(
        item.title ?? '',
      )}</h3><p class="card__text">${escapeHtml(item.text ?? '')}</p></article>`,
    )
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="mission-vision reveal">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section section--alt', inner })
}

function renderBlogs(section) {
  const type = 'blogs'
  const id = sectionId(section, 'blogs')
  const list = items(section)
  const cards = list
    .map(
      (item) => `      <article class="blog-card reveal">
        <span class="blog-card__thumb" aria-hidden="true"></span>
        <span class="tag">${escapeHtml(item.tag ?? 'Article')}</span>
        <h3 class="blog-card__title">${escapeHtml(item.title ?? '')}</h3>
        <p class="blog-card__excerpt">${escapeHtml(item.text ?? item.excerpt ?? '')}</p>
        <p class="blog-card__meta"><span>${escapeHtml(item.date ?? '')}</span><span>${escapeHtml(
        item.readTime ?? '5 min read',
      )}</span></p>
      </article>`,
    )
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    `      <div class="grid grid--3">`,
    cards,
    `      </div>`,
    `    </div>`,
  ].join('\n')
  return sectionBlock({ type, id, title: sectionTitle(section, type), className: 'section', inner })
}

function renderCta(section, ctx) {
  const type = 'cta'
  const id = sectionId(section, 'cta')
  const title = String(section?.title ?? '').trim() || 'Ready to start?'
  const text = String(section?.lead ?? section?.body ?? '').trim() || 'Tell us what you need and we will reply within one working day.'
  const buttons = Array.isArray(section?.buttons) ? section.buttons : []
  const inner = [
    `    <div class="container">`,
    `      <div class="cta-banner reveal">`,
    `        <div class="cta-banner__inner">`,
    `          <h2 class="cta-banner__title">${escapeHtml(title)}</h2>`,
    `          <p class="cta-banner__text">${escapeHtml(text)}</p>`,
    `          <div class="cta-banner__actions">`,
    `            ${button(buttons[0], ctx.hasContact ? 'Start a project' : 'Get in touch', ctx, { primary: true })}`,
    buttons[1]
      ? `            ${button(buttons[1], 'See what we do', ctx, { primary: false })}`
      : '',
    `          </div>`,
    `        </div>`,
    `      </div>`,
    `    </div>`,
  ]
    .filter(Boolean)
    .join('\n')
  return sectionBlock({ type, id, title, className: 'section', inner })
}

const RENDERERS = {
  hero: renderHero,
  'page-hero': renderPageHero,
  services: renderServices,
  features: renderFeatures,
  stats: renderStats,
  testimonials: renderTestimonials,
  pricing: renderPricing,
  steps: renderSteps,
  faq: renderFaq,
  gallery: renderGallery,
  about: renderAbout,
  team: renderTeam,
  contact: renderContact,
  'contact-info': renderContactInfo,
  values: renderValues,
  mission: renderMission,
  blogs: renderBlogs,
  cta: renderCta,
}

function fallbackSection(type, section, ctx) {
  const id = sectionId(section, type)
  const title = sectionTitle(section, type)
  const list = items(section)
  const body = String(section?.body ?? section?.lead ?? '').trim()
  const cards = list
    .map(
      (item) => `      <article class="card reveal"><span class="card__icon">${iconTag(
        item.icon || 'sparkle',
      )}</span><h3 class="card__title">${escapeHtml(
        item.title ?? '',
      )}</h3><p class="card__text">${escapeHtml(item.text ?? '')}</p></article>`,
    )
    .join('\n')
  const inner = [
    `    <div class="container">`,
    sectionHeader(section, type),
    body && !section?.title ? `      <p class="card__text">${escapeHtml(body)}</p>` : '',
    cards ? `      <div class="grid grid--3">\n${cards}\n      </div>` : '',
    `    </div>`,
  ]
    .filter(Boolean)
    .join('\n')
  return sectionBlock({ type, id, title, className: 'section', inner })
}

export function renderSection(section, ctx = {}) {
  const resolved = { hasContact: Boolean(ctx.hasContact), contactId: ctx.contactId || 'contact' }
  const declared = normalizeSectionType(section?.type) ?? String(section?.type ?? 'section').toLowerCase()
  if (RENDERERS[declared]) return RENDERERS[declared](section, resolved)
  if (SECTION_SNIPPETS[declared]) {
    return fallbackSection(declared, section, resolved)
  }
  return fallbackSection(declared, section, resolved)
}

function normalizeComposeSection(raw, index) {
  if (typeof raw === 'string') return { type: normalizeSectionType(raw) ?? raw, id: slug(raw, `section-${index + 1}`) }
  if (!raw || typeof raw !== 'object') return null
  const type = normalizeSectionType(raw.type ?? raw.section ?? raw.kind) ?? null
  if (!type) return null
  return { ...raw, type }
}

function normalizeComposePage(entry, index) {
  const file = String(entry?.file ?? entry?.path ?? (index === 0 ? 'index.html' : ''))
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim()
  if (!file) return null
  const sections = (Array.isArray(entry?.sections) ? entry.sections : [])
    .map((section, sectionIndex) => normalizeComposeSection(section, sectionIndex))
    .filter(Boolean)
  const fallbackName = file.replace(/\.html?$/i, '')
  const navLabel =
    String(entry?.nav_label ?? entry?.navLabel ?? '').trim() ||
    fallbackName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
  return {
    file,
    title: String(entry?.title ?? '').trim() || navLabel,
    navLabel,
    sections,
  }
}

export function normalizeComposeInput(input) {
  const brand = String(input?.brand ?? '').trim() || 'Your Brand'
  const tagline = String(input?.tagline ?? '').trim() || 'Websites that win work'
  const theme = getThemePreset(input?.palette ?? DEFAULT_THEME_ID)
  const seen = new Set()
  const pages = []
  for (const [index, entry] of (Array.isArray(input?.pages) ? input.pages : []).entries()) {
    const page = normalizeComposePage(entry, index)
    if (!page || seen.has(page.file)) continue
    seen.add(page.file)
    pages.push(page)
  }
  return { brand, tagline, theme, pages }
}

function pageHasType(page, type) {
  return page.sections.some((section) => section.type === type)
}

function navItemsFor(pages, page, singlePage) {
  if (!singlePage) {
    return pages.map((entry) => ({
      label: entry.navLabel,
      href: relativeHref(page.file, entry.file),
      current: entry.file === page.file,
    }))
  }
  const entries = [{ label: 'Home', href: relativeHref(page.file, page.file), current: true }]
  for (const section of page.sections) {
    if (!NAV_SECTION_TYPES.has(section.type)) continue
    entries.push({
      label: section.navLabel || sectionTitle(section, section.type),
      href: `#${sectionId(section, section.type)}`,
    })
  }
  return entries.slice(0, 6)
}

function contactLinesFor(page, brand) {
  const contact = page.sections.find((section) => section.type === 'contact' || section.type === 'contact-info')
  const list = contact && Array.isArray(contact.items) ? contact.items : []
  const lines = list
    .map((item) => String(item.text ?? '').trim())
    .filter(Boolean)
    .slice(0, 3)
  if (lines.length > 0) return lines
  return [
    `hello@${String(brand).toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`,
    '+44 20 7946 0123',
    '14 Bridge Street, London',
  ]
}

function footerColumnsFor(page, brand, navItems) {
  const columns = [{ title: 'Explore', links: navItems.map((entry) => ({ label: entry.label, href: entry.href })) }]
  const servicesSection = page.sections.find((section) => section.type === 'services' || section.type === 'features' || section.type === 'pricing' || section.type === 'gallery')
  if (servicesSection) {
    const sectionIdValue = sectionId(servicesSection, servicesSection.type)
    const links = (Array.isArray(servicesSection.items) ? servicesSection.items : [])
      .map((item) => String(item.title ?? item.name ?? '').trim())
      .filter(Boolean)
      .slice(0, 4)
      .map((label) => ({ label, href: `#${sectionIdValue}` }))
    if (links.length > 0) columns.push({ title: 'Services', links })
  }
  columns.push({ title: 'Contact', contact: true, lines: contactLinesFor(page, brand) })
  return columns
}

export function buildComposedFiles(input) {
  const { brand, tagline, theme, pages } = normalizeComposeInput(input)
  if (pages.length === 0) return { files: [], theme, pages: [] }
  const singlePage = pages.length === 1
  const shellPages = pages.map((entry) => ({
    file: entry.file,
    title: entry.title,
    navLabel: entry.navLabel,
    sections: entry.sections.map((section) => section.type),
  }))
  const files = [
    { path: 'css/base.css', content: null, kind: 'kit' },
    { path: 'css/theme.css', content: theme.css, kind: 'theme' },
    { path: 'js/main.js', content: null, kind: 'kit' },
    { path: 'js/icons.js', content: ICONS_SCRIPT, kind: 'icons' },
  ]
  for (const page of pages) {
    const hasContact = pageHasType(page, 'contact') || pageHasType(page, 'contact-info')
    const contactSection = page.sections.find((section) => section.type === 'contact' || section.type === 'contact-info')
    const contactId = contactSection ? sectionId(contactSection, contactSection.type) : 'contact'
    const bodyHtml = page.sections
      .map((section) => renderSection(section, { hasContact, contactId }))
      .join('\n')
    const navItems = navItemsFor(pages, page, singlePage)
    const footerColumns = footerColumnsFor(page, brand, navItems)
    const shellPage = shellPages.find((entry) => entry.file === page.file)
    const content = buildPageShell({
      brand,
      tagline,
      theme,
      pages: shellPages,
      page: shellPage,
      description: `${tagline} — ${brand}.`,
      bodyHtml,
      navItems,
      footerColumns,
    })
    files.push({ path: page.file, content, kind: 'page' })
  }
  return { files, theme, pages }
}

export function sectionSummary(pages) {
  return pages
    .map((page) => `${page.file}[${page.sections.map((section) => `${section.type}#${sectionId(section, section.type)}`).join(', ')}]`)
    .join('; ')
}
