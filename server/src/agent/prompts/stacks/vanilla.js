export const vanillaPrompt = `Stack: HTML5, CSS3 and vanilla JavaScript only. No frameworks, no build tools, no CSS or JS libraries, no npm packages, no external scripts. Icons are inline SVG. Never use a remote image URL (they break) — use inline SVG illustrations, CSS gradients and CSS shapes. The ONLY allowed CDN is Google Fonts: at most two families via a <link> plus a system font fallback stack.

PLAN FIRST: every explicit requirement of the task becomes one short line in plan.requirements, and the plan also fixes the design system up front — the brand (name, tagline, industry), the palette hex values (--bg, --surface, --text, --muted, --primary, --accent, --border), the one or two Google Fonts, the spacing scale, and the section list of every page in plan.pages. Reuse that checklist in your final summary and confirm every line as done or as substituted.

WRITE ORDER — finish one file completely before starting the next:
1. css/style.css (variables, reset, layout, components, responsive breakpoints)
2. index.html
3. the other pages, reusing the EXACT same header/nav/footer markup as index.html
4. js/main.js (mobile nav toggle, active link, smooth scroll, form validation when a form exists, small interactions)

CHUNKING — the rule that keeps a build cheap:
- A file under about 250 lines MUST be written in ONE create_file call. Most pages and stylesheets fit in one call; prefer one call.
- Only a genuinely larger file is split, into at most 3 parts: create_file for part 1, then append_to_file for parts 2 and 3. Every part is a complete logical block of at least ~80 lines (a whole HTML section or a whole set of CSS rules), never cut mid-tag or mid-rule.
- NEVER send a series of 10-line snippets, and NEVER call create_file twice on the same path — create_file overwrites the file and destroys every earlier part. Use append_to_file or edit_file to extend a file you already wrote.

STRUCTURE: pages at the workspace root (index.html, about.html, contact.html plus anything else requested), css/style.css, js/main.js, all linked with relative paths.
NAV RULE: every nav item must work. A requested item with no page of its own becomes a section with that id on the home page and is linked as index.html#services from every page. No dead links, no href="#".
SECTION IDS (use exactly): home — hero, services, features, testimonials, blogs, faq, cta; about — page-hero, story, mission, vision, values, stats, team; contact — page-hero, contact-form, contact-info.
HOME: hero (eyebrow badge, h1 with a gradient-highlighted keyword, subheading, two CTAs, an inline SVG or CSS visual, a trust stats row); services (6 cards: SVG icon, title, two sentences, link); features (3-4 rows or an icon list); testimonials (3 cards: quote, initials avatar, name, role, 5-star SVG rating); blogs (3 cards: gradient thumbnail, category tag, title, excerpt, date within the last 6 months of today, read time); faq (6 items in an accessible accordion: button plus panel, aria-expanded, aria-controls, one open at a time); cta (full-width gradient banner with heading, text and button).
ABOUT: page hero; 4-milestone story timeline ending in the current year; mission and vision cards; 4 values; 4 animated stat counters; 4-member team grid (initials avatar, role, short bio, social icons).
CONTACT: page hero; two columns — a form (name, email, subject, message, submit) with labels, autocomplete attributes, inline validation errors and an in-page success message (never alert()), plus info cards (email, phone, address, working hours) and a stylized CSS/SVG map block.
NAVBAR: inline SVG brand mark plus name, all requested links, and a hamburger button (aria-label, aria-expanded, aria-controls) that toggles the mobile menu below 900px; sticky with blur and shadow after scroll; closes on link click, outside click and Escape.
FOOTER: brand blurb, Quick Links, Contact, at least 4 labelled social SVG icons, and a bottom bar with (c) <span id="year">current year</span> plus the brand name.
QUALITY: semantic landmarks, exactly one h1 per page, logical heading order, unique <title> per page, alt text or aria-label on every icon and control, visible :focus-visible, a skip link, mobile-first responsive layout, and one consistent look across all pages. Write specific, benefit-driven, realistic English copy — never lorem ipsum, TODO or "coming soon". Add short helpful comments marking each section of the generated code.
NO OVER-ENGINEERING: no build step, no bundler, no framework, and no file beyond what the task and the design system need.`

export const vanillaDesignSystem = `DESIGN SYSTEM in the :root of css/style.css — color tokens (--bg, --surface, --text, --muted, --primary, --primary-600, --accent, --border), a spacing scale, radii, shadows, fluid type with clamp(), a container width and transition timings. Pick ONE cohesive palette that fits the brand (not default blue and white), support prefers-color-scheme dark through those variables, and keep contrast at least 4.5:1. Modern touches: gradient hero with soft blurred shapes, glass navbar, card lift and shadow on hover, gradient buttons with visible focus rings, 5-7rem desktop section padding, consistent radii, scroll reveal via IntersectionObserver adding .in-view, and every animation disabled under prefers-reduced-motion. Mentioned dark mode or theme in the task means a navbar theme toggle persisted in localStorage, with an inline head script that avoids the flash.
RESPONSIVE: mobile-first, breakpoints 480, 768, 1024 and 1280, grids built with repeat(auto-fit, minmax(260px, 1fr)), no horizontal scroll at 360px, touch targets at least 44px.
JS in js/main.js, everything inside DOMContentLoaded and each feature guarded by element existence: hamburger toggle, sticky header state, active link, smooth scroll with header offset, reveal on scroll, accordion, count-up stats, form validation (required, email regex, message at least 10 characters, inline errors, success message, reset), footer year via new Date().getFullYear(), back-to-top button.`

export const vanillaCompactPrompt = vanillaPrompt
export const vanillaCompactDesignSystem = vanillaDesignSystem
