const icon = (name) => `<i class="icon" data-icon="${name}" aria-hidden="true"></i>`

export const SECTION_ICONS = {
  bolt: icon('zap'),
  chart: icon('bar-chart'),
  shield: icon('shield'),
  sparkle: icon('sparkle'),
  globe: icon('globe'),
  layers: icon('layers'),
  palette: icon('palette'),
  mail: icon('mail'),
  phone: icon('phone'),
  pin: icon('map-pin'),
  clock: icon('clock'),
  check: icon('check'),
  users: icon('users'),
  star: icon('star'),
  search: icon('search'),
  code: icon('code'),
}

export const SECTION_SNIPPETS = {
  hero: `<section class="hero" id="hero">
  <span class="hero__blob" aria-hidden="true"></span>
  <div class="container hero__inner">
    <div class="hero__content reveal">
      <p class="hero__eyebrow">Eyebrow / location or proof point</p>
      <h1 class="hero__title">Promise-led headline with a <span class="hero__highlight">highlighted payoff</span></h1>
      <p class="hero__lead">One or two sentences on who you help, what you deliver and the result.</p>
      <div class="hero__actions">
        <a class="btn btn--primary btn--lg" href="contact.html">Primary call to action</a>
        <a class="btn btn--secondary btn--lg" href="#services">Secondary action</a>
      </div>
      <div class="hero__proof">
        <div class="stat"><span class="stat__value">120+</span><span class="stat__label">Projects shipped</span></div>
        <div class="stat"><span class="stat__value">4.9/5</span><span class="stat__label">Client rating</span></div>
        <div class="stat"><span class="stat__value">11 yrs</span><span class="stat__label">In business</span></div>
      </div>
    </div>
    <div class="hero__visual reveal" aria-hidden="true">
      <div class="hero__card">${SECTION_ICONS.code}<h3>Inline hero visual</h3><p class="card__text">Use an inline SVG, a gradient panel or a stacked card composition. No external images.</p></div>
    </div>
  </div>
</section>`,

  'page-hero': `<section class="page-hero" id="page-hero">
  <div class="container page-hero__inner">
    <ol class="breadcrumbs"><li><a class="breadcrumb-link" href="index.html">Home</a></li><li aria-hidden="true">/</li><li>Page name</li></ol>
    <p class="page-hero__eyebrow">Eyebrow</p>
    <h1 class="page-hero__title">Page headline</h1>
    <p class="page-hero__lead">One clear sentence describing what this page covers.</p>
  </div>
</section>`,

  services: `<section class="section" id="services">
  <div class="container">
    <div class="section-header reveal">
      <p class="section-header__eyebrow">Services</p>
      <h2 class="section-header__title">What we do</h2>
      <p class="section-header__lead">Three to six concrete services, each with a real outcome.</p>
    </div>
    <div class="grid grid--3">
      <article class="service-card reveal">
        <span class="service-card__icon">${SECTION_ICONS.palette}</span>
        <h3 class="service-card__title">Service name</h3>
        <p class="service-card__text">Two sentences on the offer, the process and the result the client gets.</p>
        <a class="link link--arrow service-card__link" href="contact.html">Enquire</a>
      </article>
    </div>
  </div>
</section>`,

  features: `<section class="section section--alt" id="features">
  <div class="container">
    <div class="grid grid--2">
      <div class="feature reveal">
        <span class="feature__icon">${SECTION_ICONS.bolt}</span>
        <div class="feature__body"><h3 class="feature__title">Feature name</h3><p class="feature__text">Why it matters to the customer, in one or two sentences.</p></div>
      </div>
    </div>
  </div>
</section>`,

  stats: `<section class="section section--tight" id="stats">
  <div class="container">
    <div class="stats reveal">
      <div class="stat"><span class="stat__value">250+</span><span class="stat__label">Metric label</span></div>
    </div>
  </div>
</section>`,

  testimonials: `<section class="section" id="testimonials">
  <div class="container">
    <div class="section-header reveal"><h2 class="section-header__title">What clients say</h2></div>
    <div class="grid grid--3">
      <figure class="testimonial reveal">
        <div class="rating" aria-label="5 out of 5">${SECTION_ICONS.star}</div>
        <blockquote class="testimonial__quote">A specific quote about the result, with a concrete number or outcome.</blockquote>
        <figcaption class="testimonial__meta">
          <span class="testimonial__avatar" aria-hidden="true">AB</span>
          <span><span class="testimonial__name">Full Name</span><span class="testimonial__role">Role, Company</span></span>
        </figcaption>
      </figure>
    </div>
  </div>
</section>`,

  pricing: `<section class="section section--alt" id="pricing">
  <div class="container">
    <div class="grid grid--3">
      <article class="pricing-card reveal">
        <p class="pricing-card__name">Plan name</p>
        <p class="pricing-card__price">£1,200 <span class="pricing-card__period">one-off</span></p>
        <ul class="pricing-card__features">
          <li class="price-feature">${SECTION_ICONS.check} What is included</li>
        </ul>
        <a class="btn btn--primary pricing-card__cta" href="contact.html">Choose plan</a>
      </article>
    </div>
  </div>
</section>`,

  process: `<section class="section" id="process">
  <div class="container">
    <div class="process">
      <div class="process-step reveal"><span class="process-step__number">1</span><h3 class="process-step__title">Step name</h3><p class="process-step__text">What happens in this step and how long it takes.</p></div>
    </div>
  </div>
</section>`,

  faq: `<section class="section section--alt" id="faq">
  <div class="container">
    <div class="section-header reveal"><h2 class="section-header__title">Questions, answered</h2></div>
    <div class="faq reveal">
      <div class="faq-item">
        <h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-1">A real question?</button></h3>
        <div class="faq-item__panel" id="faq-1"><p class="faq-item__answer">A specific, useful answer.</p></div>
      </div>
    </div>
  </div>
</section>`,

  cta: `<section class="section" id="cta">
  <div class="container">
    <div class="cta-banner reveal">
      <div class="cta-banner__inner">
        <h2 class="cta-banner__title">Ready to start?</h2>
        <p class="cta-banner__text">One line on the next step and how fast the reply is.</p>
        <div class="cta-banner__actions">
          <a class="btn btn--secondary btn--lg" href="contact.html">Start a project</a>
          <a class="btn btn--ghost btn--lg" href="#services">See services</a>
        </div>
      </div>
    </div>
  </div>
</section>`,

  'contact-form': `<section class="section" id="contact-form">
  <div class="container">
    <div class="contact-layout">
      <form class="form reveal" data-validate novalidate>
        <div class="form-grid">
          <div class="form-field">
            <label class="form-label" for="name">Full name</label>
            <input class="form-input" id="name" name="name" type="text" autocomplete="name" placeholder="Alex Morgan" required>
            <span class="form-error" data-error-for="name"></span>
          </div>
          <div class="form-field">
            <label class="form-label" for="email">Work email</label>
            <input class="form-input" id="email" name="email" type="email" autocomplete="email" placeholder="alex@company.com" required>
            <span class="form-error" data-error-for="email"></span>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" for="subject">Subject</label>
          <input class="form-input" id="subject" name="subject" type="text" placeholder="New website enquiry" required>
          <span class="form-error" data-error-for="subject"></span>
        </div>
        <div class="form-field">
          <label class="form-label" for="message">How can we help?</label>
          <textarea class="form-textarea" id="message" name="message" rows="6" placeholder="Tell us about your project, timeline and budget." required></textarea>
          <span class="form-error" data-error-for="message"></span>
        </div>
        <div class="form-actions">
          <button class="btn btn--primary btn--lg" type="submit">Send enquiry</button>
          <span class="form-hint">We reply within one working day.</span>
        </div>
        <p class="form-success" role="status">Thanks — your message is on its way. We will reply within one working day.</p>
      </form>
      <div class="contact-info reveal">
        <div class="info-card"><span class="info-card__icon">${SECTION_ICONS.mail}</span><h3 class="info-card__title">Email</h3><p class="info-card__text">hello@example.com</p></div>
      </div>
    </div>
  </div>
</section>`,

  'contact-info': `<section class="section section--alt" id="contact-info">
  <div class="container">
    <div class="contact-info reveal">
      <div class="info-card"><span class="info-card__icon">${SECTION_ICONS.phone}</span><h3 class="info-card__title">Phone</h3><p class="info-card__text">+44 20 7946 0123</p></div>
      <div class="info-card"><span class="info-card__icon">${SECTION_ICONS.pin}</span><h3 class="info-card__title">Studio</h3><p class="info-card__text">14 Bridge Street, London</p></div>
      <div class="info-card"><span class="info-card__icon">${SECTION_ICONS.clock}</span><h3 class="info-card__title">Hours</h3><p class="info-card__text">Mon to Fri, 9am to 6pm</p></div>
      <div class="map-block"><span class="map-block__pin"></span></div>
    </div>
  </div>
</section>`,

  'about-story': `<section class="section" id="about-story">
  <div class="container story">
    <div class="section-header section-header--left reveal"><h2 class="section-header__title">Our story</h2></div>
    <ol class="story-timeline reveal">
      <li class="timeline-item"><span class="timeline-item__year">2015</span><h3 class="timeline-item__title">Milestone</h3><p class="timeline-item__text">What happened and why it mattered.</p></li>
    </ol>
  </div>
</section>`,

  team: `<section class="section section--alt" id="team">
  <div class="container">
    <div class="team">
      <article class="team-card reveal">
        <span class="team-card__avatar" aria-hidden="true">AB</span>
        <h3 class="team-card__name">Full Name</h3>
        <p class="team-card__role">Role</p>
        <p class="team-card__bio">One line of real background.</p>
        <div class="team-card__social">
          <a class="social-link" href="https://www.linkedin.com" aria-label="LinkedIn profile of Full Name">${icon('linkedin')}</a>
        </div>
      </article>
    </div>
  </div>
</section>`,

  values: `<section class="section" id="values">
  <div class="container">
    <div class="values-grid">
      <article class="value-card reveal"><span class="value-card__icon">${SECTION_ICONS.shield}</span><h3 class="value-card__title">Value name</h3><p class="value-card__text">How this value shows up in the work.</p></article>
    </div>
  </div>
</section>`,

  mission: `<section class="section" id="mission">
  <div class="container">
    <div class="mission-vision reveal">
      <article class="card"><span class="card__icon">${SECTION_ICONS.sparkle}</span><h3 class="card__title">Our mission</h3><p class="card__text">Why the business exists, in one sentence.</p></article>
      <article class="card"><span class="card__icon">${SECTION_ICONS.globe}</span><h3 class="card__title">Our vision</h3><p class="card__text">Where the business is going.</p></article>
    </div>
  </div>
</section>`,

  blogs: `<section class="section" id="blogs">
  <div class="container">
    <div class="grid grid--3">
      <article class="blog-card reveal">
        <span class="blog-card__thumb" aria-hidden="true"></span>
        <span class="tag">Category</span>
        <h3 class="blog-card__title">Article title</h3>
        <p class="blog-card__excerpt">One-sentence summary of the article.</p>
        <p class="blog-card__meta"><span>12 June 2026</span><span>6 min read</span></p>
      </article>
    </div>
  </div>
</section>`,
}

export const SECTION_TYPES = Object.keys(SECTION_SNIPPETS)

export const SLOT_PATTERN = /<!--\s*SLOT:([a-z0-9-]+)\s*-->/
