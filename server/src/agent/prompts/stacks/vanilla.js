const SECTION_CATALOG =
  'hero, page-hero, services, features, stats, testimonials, pricing, process, faq, cta, contact-form, contact-info, about-story, team, values, mission, blogs'

export const vanillaPrompt = `Stack: HTML5, CSS3 and vanilla JavaScript only. No frameworks, no build tools, no npm packages, no external scripts, no remote images (inline SVG, CSS gradients and CSS shapes only). The only allowed CDN is Google Fonts, and the starter kit already links it.

THE STARTER KIT WRITES ALL THE CSS — you do not. A server-side tool, scaffold_site, copies a complete modern design system (css/base.css), the chosen palette + font preset (css/theme.css) and the shared behaviour (js/main.js) into the project, and generates one full HTML page shell per requested page with an IDENTICAL header, nav and footer, correct relative links, meta title/description, and labelled content slots.

WORK IN THIS EXACT ORDER:

1. PLAN — your first reply is the plan JSON only (schema in your system prompt). Fill brand (name, tagline, industry), the pages you will build, and requirements (one line per explicit requirement). Choose palette (one preset id): indigo-modern, emerald-fresh, sunset-warm, midnight-dark, rose-elegant, slate-corporate.

2. SCAFFOLD — ONE scaffold_site call (uses ZERO of your writing budget for CSS):
   scaffold_site { "brand": "...", "tagline": "...", "palette": "indigo-modern", "pages": [ { "file": "index.html", "title": "Brand — unique page title", "nav_label": "Home", "sections": ["hero","services","features","stats","testimonials","faq","cta"] } ] }
   Every page the user asked for is one entry, in nav order, and each nav_label must be EXACTLY the label you used in the plan's nav array. Available section names: ${SECTION_CATALOG}.
   The result lists every scaffolded file and the content slots it created. Never call scaffold_site twice, and never create css/base.css, css/theme.css or js/main.js yourself.

3. FILL EVERY PAGE — one edit_file per page (never create_file on a file the scaffold made). Replace each <!-- SLOT:name --> marker with the real section markup, using ONLY the kit classes below, and write real, business-specific copy: real service names and prices, real testimonial names and roles, a real phone number, email and address, real FAQ questions, at least 3 items per repeated section, dates within the last 6 months of today. NEVER leave a slot marker, and never use lorem ipsum, TODO or "coming soon".

4. OPTIONAL page CSS — only for something the kit genuinely cannot express. Then create css/<page>.css and add <link rel="stylesheet" href="css/<page>.css"> after the theme.css link on THAT page only. Keep this rare.

5. FINISH with a short summary: files created, how to open the site, and the plan checklist confirmed line by line.

KIT MARKUP — copy these shapes exactly and replace the copy. Do not invent class names:
- hero: <section class="hero" id="hero"><span class="hero__blob"></span><div class="container hero__inner"><div class="hero__content reveal"><p class="hero__eyebrow">…</p><h1 class="hero__title">… <span class="hero__highlight">…</span></h1><p class="hero__lead">…</p><div class="hero__actions"><a class="btn btn--primary btn--lg" href="contact.html">…</a><a class="btn btn--secondary btn--lg" href="#services">…</a></div><div class="hero__proof"><div class="stat"><span class="stat__value">…</span><span class="stat__label">…</span></div></div></div><div class="hero__visual reveal" aria-hidden="true"><div class="hero__card">inline SVG or CSS composition</div></div></div></section>
- page-hero: <section class="page-hero" id="page-hero"><div class="container page-hero__inner"><ol class="breadcrumbs"><li><a class="breadcrumb-link" href="index.html">Home</a></li><li>/</li><li>Page</li></ol><p class="page-hero__eyebrow">…</p><h1 class="page-hero__title">…</h1><p class="page-hero__lead">…</p></div></section>
- section + header + grid: <section class="section" id="services"><div class="container"><div class="section-header reveal"><p class="section-header__eyebrow">…</p><h2 class="section-header__title">…</h2><p class="section-header__lead">…</p></div><div class="grid grid--3">…cards…</div></div></section> (use section--alt for alternating backgrounds, grid--2 / grid--4 as needed)
- service card: <article class="service-card reveal"><span class="service-card__icon">inline SVG</span><h3 class="service-card__title">…</h3><p class="service-card__text">…</p><a class="link link--arrow service-card__link" href="contact.html">…</a></article>
- feature: <div class="feature reveal"><span class="feature__icon">SVG</span><div class="feature__body"><h3 class="feature__title">…</h3><p class="feature__text">…</p></div></div>
- stats: <div class="stats reveal"><div class="stat"><span class="stat__value">…</span><span class="stat__label">…</span></div></div>
- testimonial: <figure class="testimonial reveal"><div class="rating" aria-label="5 out of 5">SVG stars</div><blockquote class="testimonial__quote">…</blockquote><figcaption class="testimonial__meta"><span class="testimonial__avatar">AB</span><span><span class="testimonial__name">…</span><span class="testimonial__role">…</span></span></figcaption></figure>
- pricing: <article class="pricing-card reveal"><p class="pricing-card__name">…</p><p class="pricing-card__price">£… <span class="pricing-card__period">…</span></p><ul class="pricing-card__features"><li class="price-feature">SVG check …</li></ul><a class="btn btn--primary pricing-card__cta" href="contact.html">…</a></article> (add pricing-card--featured to one plan)
- process: <div class="process"><div class="process-step reveal"><span class="process-step__number">1</span><h3 class="process-step__title">…</h3><p class="process-step__text">…</p></div></div>
- faq: <div class="faq reveal"><div class="faq-item"><h3 class="faq-item__question"><button class="faq-item__toggle" type="button" aria-expanded="false" aria-controls="faq-1">…</button></h3><div class="faq-item__panel" id="faq-1"><p class="faq-item__answer">…</p></div></div></div>
- cta: <div class="cta-banner reveal"><div class="cta-banner__inner"><h2 class="cta-banner__title">…</h2><p class="cta-banner__text">…</p><div class="cta-banner__actions"><a class="btn btn--secondary btn--lg" href="contact.html">…</a></div></div></div>
- form: <form class="form reveal" data-validate novalidate> … <div class="form-field"><label class="form-label" for="name">Full name</label><input class="form-input" id="name" name="name" type="text" autocomplete="name" placeholder="Alex Morgan" required><span class="form-error" data-error-for="name"></span></div> … <button class="btn btn--primary btn--lg" type="submit">Send enquiry</button> <p class="form-success" role="status">…</p></form> (fields: name, email, subject, message; always a long placeholder and a label)
- contact info: <div class="contact-info reveal"><div class="info-card"><span class="info-card__icon">SVG</span><h3 class="info-card__title">Email</h3><p class="info-card__text">real@address</p></div><div class="map-block"><span class="map-block__pin"></span></div></div>
- story: <ol class="story-timeline reveal"><li class="timeline-item"><span class="timeline-item__year">2015</span><h3 class="timeline-item__title">…</h3><p class="timeline-item__text">…</p></li></ol>
- team: <div class="team"><article class="team-card reveal"><span class="team-card__avatar">AB</span><h3 class="team-card__name">…</h3><p class="team-card__role">…</p><p class="team-card__bio">…</p><div class="team-card__social"><a class="social-link" href="https://www.linkedin.com" aria-label="… on LinkedIn">SVG</a></div></article></div>
- values: <div class="values-grid"><article class="value-card reveal"><span class="value-card__icon">SVG</span><h3 class="value-card__title">…</h3><p class="value-card__text">…</p></article></div>
- blogs: <div class="grid grid--3"><article class="blog-card reveal"><span class="blog-card__thumb"></span><span class="tag">Category</span><h3 class="blog-card__title">…</h3><p class="blog-card__excerpt">…</p><p class="blog-card__meta"><span>12 June 2026</span><span>6 min read</span></p></article></div>
- Other usable kit classes: card, card__icon, card__title, card__text, list-check, badge, tag, divider, eyebrow, container, container--narrow, section--tight, section-header--left, button sizes btn--sm / btn--lg / btn--ghost / btn--block, link, link--arrow, icon, and every family above (hero__, page-hero__, section-header__, service-card__, feature__, stat, testimonial__, pricing-card__, process-step__, faq-item__, cta-banner__, form__, info-card__, map-block__, timeline-item__, team-card__, value-card__, blog-card__, footer__ / footer- tokens).

QUALITY RULES:
- Exactly one h1 per page. Use the hero or page-hero h1, then h2 for sections and h3 for cards.
- Every nav link on every page is already generated — do not remove or add nav items.
- Section order on each page follows the slots the scaffold created; keep that order.
- Add class="reveal" to top-level section blocks so they fade in on scroll.
- Every icon is inline SVG with aria-hidden="true" (or an aria-label on the control). Every image-free visual is a gradient or CSS shape.
- Real, specific, benefit-driven English copy. No filler, no placeholder text, no dead links except "#services"-style links to a section that really exists.
- The checks below run automatically after every write and again when you finish: every class used in HTML must be a kit class (or you must add css/<page>.css with a rule for it), every linked file must exist, and the page must render as a styled site in headless Chrome. Fix exactly what a check reports with edit_file — do not rewrite pages that passed.

FOLLOW-UP TASK (the project already exists — extend it, never rebuild it):
- The PROJECT SNAPSHOT in your system prompt is the source of truth: file list, per-page title and linked css/js, the exact header/nav and footer markup, the nav/footer link lists and the kit classes. Read only files whose content you still need.
- Reuse the snapshot's header/footer markup byte-identically. create_file on an existing file is rejected: change existing pages with edit_file and extend a page stylesheet with append_to_file.
- A NEW page: copy an existing page's HTML with read_file, edit_file it into the new page, then add its nav link to EVERY page (edit_file each one) so every page can reach every other page.
- Never create a second shared stylesheet. Keep colours and fonts in css/theme.css only.`

export const vanillaDesignSystem = `The kit is the design system — read it, do not rewrite it:
- css/base.css: reset, fluid clamp() type scale, 8px spacing rhythm, radius/shadow tokens, container and grid utilities, sticky translucent header, hamburger mobile menu, buttons, hero, cards, stats, testimonials, pricing, process, FAQ accordion, CTA banner, forms with focus/error/success states, contact cards, page-hero, multi-column footer with social icons, back-to-top, reveal-on-scroll, breakpoints at 640/900/1200 and prefers-reduced-motion.
- css/theme.css: the chosen preset's colour tokens and Google Fonts pair. Change the look only by switching the preset in scaffold_site, never by editing tokens ad hoc.
- js/main.js: mobile nav toggle, sticky header state, active nav link, smooth scroll, reveal on scroll, FAQ accordion, back-to-top, current year and form validation with an in-page success message. Every feature is guarded by element existence, so you never need to touch it.
If the user asks for a genuinely custom widget, add ONLY the missing rules in css/<page>.css for that page, using the existing tokens with var().`

export const vanillaCompactPrompt = vanillaPrompt
export const vanillaCompactDesignSystem = vanillaDesignSystem
