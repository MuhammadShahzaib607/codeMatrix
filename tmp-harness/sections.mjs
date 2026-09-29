const ICON = {
  brush:
    '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20s2-1 3-3 8-9 11-12"/><path d="M14 4h6v6"/></svg>',
  frame:
    '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/></svg>',
  star:
    '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 9.6l6.3-.9Z"/></svg>',
  mail:
    '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone:
    '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/></svg>',
  pin:
    '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  check:
    '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>',
}

const services = [
  {
    icon: ICON.brush,
    title: 'Original canvas paintings',
    text: 'Hand-painted oil and acrylic works on stretched linen, each one a single piece signed by Shahzaib. Studio works ship stretched, varnished and ready to hang, with a certificate of authenticity and a lifetime care sheet.',
  },
  {
    icon: ICON.frame,
    title: 'Limited-edition prints',
    text: 'Museum-grade giclee editions of the most requested works, limited to sixty signed and numbered copies on 310gsm cotton rag. Every order includes a hand-numbered certificate and archival packaging built to survive the post.',
  },
  {
    icon: ICON.star,
    title: 'Bespoke commissions',
    text: 'A private commission starts with a colour and story conversation, moves through two studio sketches you approve, and finishes as a piece sized for the wall it was made for. Typical turnaround is six to eight weeks.',
  },
]

const testimonials = [
  {
    quote:
      'We commissioned a four-metre piece for the hotel lobby and the studio handled every stage, from the first sketch to the crate it arrived in. Guests photograph it constantly.',
    name: 'Ayesha Rehman',
    role: 'Interior lead, Marlowe Hotels',
    initials: 'AR',
  },
  {
    quote:
      'The edition I bought was packed better than anything else I have ever had shipped, and the colours on the print match the original canvas exactly. It now hangs above our reception desk.',
    name: 'Daniel Okoye',
    role: 'Founder, Okoye Architecture',
    initials: 'DO',
  },
  {
    quote:
      'Shahzaib painted a portrait of my parents from two old photographs. He asked careful questions, showed progress sketches, and delivered something our family will keep for generations.',
    name: 'Hina Qureshi',
    role: 'Private collector, Karachi',
    initials: 'HQ',
  },
]

const faqs = [
  [
    'How do I know a painting will suit my room before it arrives?',
    'Every listing includes a short video in daylight, exact dimensions in centimetres and inches, and a free visual mockup. Send a photograph of the wall and you will get the piece composited onto it within one working day, before you commit to anything.',
  ],
  [
    'How long does a bespoke commission take?',
    'Most commissions take six to eight weeks from the approval of the first sketch. Larger architectural work is quoted on its own schedule, and every commission gets a written timeline with a studio photograph at each milestone so you always know where it stands.',
  ],
  [
    'What is included with a limited-edition print?',
    'Each edition is sixty signed and numbered copies printed on 310gsm cotton rag, supplied with a hand-numbered certificate of authenticity, a care card and archival packaging. Edition numbers are allocated in order of purchase and cannot be reissued once the run is closed.',
  ],
  [
    'Do you ship outside Pakistan and who handles customs?',
    'Yes. Paintings and prints ship worldwide from the Lahore studio, fully insured, with tracking from the moment they leave. Import duties are the buyer responsibility and the studio provides the commercial invoice and HS codes your customs broker will ask for.',
  ],
  [
    'Can I visit the studio before buying?',
    'The Lahore studio opens to collectors on Thursdays and Saturdays between 11am and 6pm, by appointment. You can see works in progress, review framing options and take away printed colour studies of anything you are considering.',
  ],
]

const blogs = [
  {
    tag: 'Studio notes',
    title: 'Why we switched every canvas to lead-free linen',
    excerpt:
      'A short account of the two years we spent testing grounds and primers, what it changed about the finish of the work, and why the new linen survives a Karachi summer far better.',
    date: '18 August 2026',
    read: '6 min read',
  },
  {
    tag: 'Collecting',
    title: 'How to hang a single large painting properly',
    excerpt:
      'Centre height, wall colour temperature and the light you actually live with. A practical guide to placing one statement piece so it reads well in the morning and at night.',
    date: '2 July 2026',
    read: '5 min read',
  },
  {
    tag: 'Commissions',
    title: 'From photographs to a finished family portrait',
    excerpt:
      'What the studio asks for when the only reference is a faded print, how many sketches a portrait normally needs, and what happens when the family disagrees about the composition.',
    date: '21 May 2026',
    read: '7 min read',
  },
]

function stat(value, label) {
  return `          <div class="stat"><span class="stat__value">${value}</span><span class="stat__label">${label}</span></div>`
}

function serviceCards() {
  return services
    .map(
      (service) => `        <article class="service-card reveal">
          <span class="service-card__icon">${service.icon}</span>
          <h3 class="service-card__title">${service.title}</h3>
          <p class="service-card__text">${service.text}</p>
          <a class="link link--arrow service-card__link" href="contact.html">Enquire about this</a>
        </article>`,
    )
    .join('\n')
}

function testimonialCards() {
  return testimonials
    .map(
      (item) => `        <figure class="testimonial reveal">
          <div class="rating" aria-label="5 out of 5">${ICON.star}</div>
          <blockquote class="testimonial__quote">${item.quote}</blockquote>
          <figcaption class="testimonial__meta">
            <span class="testimonial__avatar" aria-hidden="true">${item.initials}</span>
            <span><span class="testimonial__name">${item.name}</span><span class="testimonial__role">${item.role}</span></span>
          </figcaption>
        </figure>`,
    )
    .join('\n')
}

function faqItems() {
  return faqs
    .map(
      ([question, answer], index) => `          <div class="faq-item">
            <h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-${index + 1}">${question}</button></h3>
            <div class="faq-item__panel" id="faq-${index + 1}"><p class="faq-item__answer">${answer}</p></div>
          </div>`,
    )
    .join('\n')
}

function blogCards() {
  return blogs
    .map(
      (post) => `        <article class="blog-card reveal">
          <span class="blog-card__thumb" aria-hidden="true"></span>
          <span class="tag">${post.tag}</span>
          <h3 class="blog-card__title">${post.title}</h3>
          <p class="blog-card__excerpt">${post.excerpt}</p>
          <p class="blog-card__meta"><span>${post.date}</span><span>${post.read}</span></p>
        </article>`,
    )
    .join('\n')
}

function ctaBanner() {
  return `      <div class="cta-banner reveal">
        <div class="cta-banner__inner">
          <h2 class="cta-banner__title">Start with a conversation about the wall</h2>
          <p class="cta-banner__text">Send the room, the size and the mood you are after and the studio replies within one working day with a sketch direction and a fixed quote.</p>
          <div class="cta-banner__actions">
            <a class="btn btn--secondary btn--lg" href="contact.html">Commission a piece</a>
            <a class="btn btn--ghost btn--lg" href="services.html">See services</a>
          </div>
        </div>
      </div>`
}

export function sectionHtml(name, ctx = {}) {
  const pageLabel = ctx.pageLabel ?? 'The studio'
  switch (name) {
    case 'hero':
      return `<section class="hero" id="hero">
  <span class="hero__blob" aria-hidden="true"></span>
  <div class="container hero__inner">
    <div class="hero__content reveal">
      <p class="hero__eyebrow">Shahzaib.art — contemporary painting studio, Lahore</p>
      <h1 class="hero__title">Paintings that make a room <span class="hero__highlight">feel alive</span></h1>
      <p class="hero__lead">Oil and acrylic work made by hand in Lahore, plus signed limited-edition prints. Collectors, designers and hotels commission the studio for one honest reason: the finished piece looks better on the wall than it did on the screen.</p>
      <div class="hero__actions">
        <a class="btn btn--primary btn--lg" href="contact.html">Commission a painting</a>
        <a class="btn btn--secondary btn--lg" href="#services">Browse what we make</a>
      </div>
      <div class="hero__proof">
${[stat('120+', 'Works placed'), stat('4.9/5', 'Collector rating'), stat('11 yrs', 'In the studio')].join('\n')}
      </div>
    </div>
    <div class="hero__visual reveal" aria-hidden="true">
      <div class="hero__card"><h3>Studio work in progress</h3><p class="card__text">A four-metre commission on the easel, three colour studies pinned beside it, and the daylight rig we use to check every tone before it ships.</p></div>
    </div>
  </div>
</section>`

    case 'page-hero':
      return `<section class="page-hero" id="page-hero">
  <div class="container page-hero__inner">
    <ol class="breadcrumbs"><li><a class="breadcrumb-link" href="index.html">Home</a></li><li aria-hidden="true">/</li><li>${pageLabel}</li></ol>
    <p class="page-hero__eyebrow">${pageLabel} — Shahzaib.art studio, Lahore</p>
    <h1 class="page-hero__title">${ctx.title ?? pageLabel}</h1>
    <p class="page-hero__lead">${ctx.lead ?? 'Everything you need to know before you commission or collect a piece from the Lahore studio, from the first conversation and the colour studies through to framing, shipping and the certificate that arrives in the crate.'}</p>
  </div>
</section>`

    case 'services':
      return `<section class="section" id="services">
  <div class="container">
    <div class="section-header reveal">
      <p class="section-header__eyebrow">What the studio makes</p>
      <h2 class="section-header__title">Originals, editions and commissions</h2>
      <p class="section-header__lead">Three ways to work with Shahzaib.art, each with a fixed process, a written timeline and a price agreed before the first brush touches the canvas.</p>
    </div>
    <div class="grid grid--3">
${serviceCards()}
    </div>
  </div>
</section>`

    case 'testimonials':
      return `<section class="section section--alt" id="testimonials">
  <div class="container">
    <div class="section-header reveal">
      <p class="section-header__eyebrow">Collectors</p>
      <h2 class="section-header__title">What people say after the crate is open</h2>
      <p class="section-header__lead">Three recent commissions, in the words of the people who now live with the work.</p>
    </div>
    <div class="grid grid--3">
${testimonialCards()}
    </div>
  </div>
</section>`

    case 'faq':
      return `<section class="section" id="faq">
  <div class="container container--narrow">
    <div class="section-header reveal">
      <p class="section-header__eyebrow">Questions</p>
      <h2 class="section-header__title">The things collectors ask first</h2>
      <p class="section-header__lead">Shipping, timelines, editions and studio visits — answered plainly before you spend anything.</p>
    </div>
    <div class="faq reveal">
${faqItems()}
    </div>
  </div>
</section>`

    case 'cta':
      return `<section class="section section--tight" id="cta">
  <div class="container">
${ctaBanner()}
  </div>
</section>`

    case 'about-story':
      return `<section class="section" id="about-story">
  <div class="container story">
    <div class="section-header section-header--left reveal">
      <p class="section-header__eyebrow">Since 2015</p>
      <h2 class="section-header__title">Eleven years of painting in Lahore</h2>
    </div>
    <ol class="story-timeline reveal">
      <li class="timeline-item"><span class="timeline-item__year">2015</span><h3 class="timeline-item__title">A single studio room</h3><p class="timeline-item__text">Shahzaib left a commercial illustration job and rented one room in Gulberg with north light and a borrowed easel. The first six canvases sold to friends of friends.</p></li>
      <li class="timeline-item"><span class="timeline-item__year">2018</span><h3 class="timeline-item__title">First hotel commission</h3><p class="timeline-item__text">A boutique hotel in Islamabad asked for nine works for its lobby and corridors. That project set the studio process still used today: colour studies first, client approval, then paint.</p></li>
      <li class="timeline-item"><span class="timeline-item__year">2022</span><h3 class="timeline-item__title">Editions and worldwide shipping</h3><p class="timeline-item__text">The studio began releasing signed giclee editions of sixty, which opened the work to collectors who wanted the colour without the original scale. Shipping now reaches thirty-one countries.</p></li>
      <li class="timeline-item"><span class="timeline-item__year">2026</span><h3 class="timeline-item__title">The archive opens</h3><p class="timeline-item__text">Every work placed since 2015 is now recorded in a digital archive with its provenance, so a piece can be traced and re-valued decades after it left the studio.</p></li>
    </ol>
  </div>
</section>`

    case 'team':
      return `<section class="section section--alt" id="team">
  <div class="container">
    <div class="section-header reveal">
      <h2 class="section-header__title">The people in the room</h2>
      <p class="section-header__lead">Three people make every commission happen, from the first sketch to the crate on the truck.</p>
    </div>
    <div class="team">
      <article class="team-card reveal">
        <span class="team-card__avatar" aria-hidden="true">SQ</span>
        <h3 class="team-card__name">Shahzaib Qureshi</h3>
        <p class="team-card__role">Painter and founder</p>
        <p class="team-card__bio">Trained in miniature painting at NCA before moving to large-scale oil work. Paints every original and approves every edition by hand.</p>
        <div class="team-card__social"><a class="social-link" href="https://www.instagram.com" aria-label="Shahzaib Qureshi on Instagram">${ICON.frame}</a></div>
      </article>
      <article class="team-card reveal">
        <span class="team-card__avatar" aria-hidden="true">MA</span>
        <h3 class="team-card__name">Mariam Aslam</h3>
        <p class="team-card__role">Studio manager</p>
        <p class="team-card__bio">Runs commissions end to end: briefs, timelines, framing decisions and the shipping paperwork your customs broker will ask for.</p>
        <div class="team-card__social"><a class="social-link" href="https://www.linkedin.com" aria-label="Mariam Aslam on LinkedIn">${ICON.frame}</a></div>
      </article>
      <article class="team-card reveal">
        <span class="team-card__avatar" aria-hidden="true">BZ</span>
        <h3 class="team-card__name">Bilal Zafar</h3>
        <p class="team-card__role">Editions and printmaking</p>
        <p class="team-card__bio">Calibrates every giclee run against the original canvas so the printed colour holds up beside the painting it came from.</p>
        <div class="team-card__social"><a class="social-link" href="https://www.x.com" aria-label="Bilal Zafar on X">${ICON.frame}</a></div>
      </article>
    </div>
  </div>
</section>`

    case 'blogs':
      return `<section class="section" id="blogs">
  <div class="container">
    <div class="section-header reveal">
      <p class="section-header__eyebrow">Journal</p>
      <h2 class="section-header__title">Notes from the studio</h2>
      <p class="section-header__lead">Materials, hanging advice and what actually happens inside a commission. Written by the people doing the work.</p>
    </div>
    <div class="grid grid--3">
${blogCards()}
    </div>
  </div>
</section>`

    case 'contact-form':
      return `<section class="section" id="contact-form">
  <div class="container">
    <div class="contact-layout">
      <form class="form reveal" data-validate novalidate>
        <div class="form-grid">
          <div class="form-field">
            <label class="form-label" for="name">Full name</label>
            <input class="form-input" id="name" name="name" type="text" autocomplete="name" placeholder="Ayesha Rehman" required>
            <span class="form-error" data-error-for="name"></span>
          </div>
          <div class="form-field">
            <label class="form-label" for="email">Email address</label>
            <input class="form-input" id="email" name="email" type="email" autocomplete="email" placeholder="ayesha@studio.example" required>
            <span class="form-error" data-error-for="email"></span>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" for="subject">What are you after?</label>
          <input class="form-input" id="subject" name="subject" type="text" placeholder="Commission for a hotel lobby" required>
          <span class="form-error" data-error-for="subject"></span>
        </div>
        <div class="form-field">
          <label class="form-label" for="message">Tell us about the space</label>
          <textarea class="form-textarea" id="message" name="message" rows="6" placeholder="The wall is 3.4 metres wide with north light, and we are looking for something warm and large-format." required></textarea>
          <span class="form-error" data-error-for="message"></span>
        </div>
        <div class="form-actions">
          <button class="btn btn--primary btn--lg" type="submit">Send enquiry</button>
          <span class="form-hint">The studio replies within one working day.</span>
        </div>
        <p class="form-success" role="status">Thank you — your enquiry reached the studio. Mariam will reply within one working day with next steps.</p>
      </form>
      <div class="contact-info reveal">
        <div class="info-card"><span class="info-card__icon">${ICON.mail}</span><h3 class="info-card__title">Email</h3><p class="info-card__text">studio@shahzaib.art</p></div>
        <div class="info-card"><span class="info-card__icon">${ICON.phone}</span><h3 class="info-card__title">Studio phone</h3><p class="info-card__text">+92 42 3577 0148</p></div>
      </div>
    </div>
  </div>
</section>`

    case 'contact-info':
      return `<section class="section section--alt" id="contact-info">
  <div class="container">
    <div class="contact-info reveal">
      <div class="info-card"><span class="info-card__icon">${ICON.phone}</span><h3 class="info-card__title">Call the studio</h3><p class="info-card__text">+92 42 3577 0148</p></div>
      <div class="info-card"><span class="info-card__icon">${ICON.pin}</span><h3 class="info-card__title">Studio address</h3><p class="info-card__text">14 Gulberg II, Lahore 54660, Pakistan</p></div>
      <div class="info-card"><span class="info-card__icon">${ICON.check}</span><h3 class="info-card__title">Opening hours</h3><p class="info-card__text">Thursday and Saturday, 11am to 6pm, by appointment.</p></div>
      <div class="map-block"><span class="map-block__pin"></span></div>
    </div>
  </div>
</section>`

    default:
      return ''
  }
}
