export const vanillaPrompt = `Stack: HTML5, CSS3 and vanilla JavaScript only. No frameworks, no build tools, no CSS or JS libraries, no npm packages, no external scripts. Icons are inline SVG. Never use a remote image URL (they break) — use inline SVG illustrations, CSS gradients and CSS shapes. The ONLY allowed CDN is Google Fonts: at most two families via a <link> plus a system font fallback stack.

FILE STRUCTURE — one SHARED stylesheet plus one stylesheet PER PAGE:
- css/base.css: design tokens (:root variables), reset, typography, layout utilities (container, grid), header/nav, footer, buttons, cards, forms, shared components and the responsive rules.
- css/<page>.css for EVERY page: index.html -> css/index.css, about.html -> css/about.css, contact.html -> css/contact.css. It holds ONLY that page's own sections and never restates base rules.
- js/main.js: shared behaviour, only if the request needs it.
- Pages live at the workspace root; all asset paths are RELATIVE, never a leading "/".

WORK IN THIS EXACT ORDER — one file at a time:

1. PLAN: reply with the plan JSON only (schema in your system prompt). list every page the user asked for, turn every explicit requirement into one short line in plan.requirements, and FIX THE DESIGN SYSTEM there: brand name + tagline + industry, the palette as tokens (--bg, --surface, --surface-2, --text, --muted, --primary, --primary-600, --accent, --border), one heading font + one body font (Google Fonts), a fluid type scale with clamp(), an 8px spacing scale, radius and shadow tokens. Reuse that checklist in your final summary.

2. CSS BASE FIRST — one create_file for css/base.css with the :root tokens and every shared component (header/nav + hamburger, footer, buttons, cards, badges, forms, section rhythm, container, grids, reveal animation).

3. HTML — one complete page per create_file call, in plan order (index.html, then each other requested page). Each page is the FULL document: <!DOCTYPE html>, <head> (charset, viewport, unique <title>, meta description, the Google Fonts link, <link rel="stylesheet" href="css/base.css"> and then <link rel="stylesheet" href="css/<page>.css">), the shared <header> with nav + hamburger button, a <main> whose first section is a page hero, the shared <footer>, and <script src="js/main.js" defer></script> before </body>. Copy the header/nav/footer markup IDENTICALLY on every page (only class="active" and aria-current="page" change) and list ALL the site's nav links on every page. Write real, specific, benefit-driven English copy — never lorem ipsum, TODO or "coming soon". Use clear, consistent class names because the page stylesheet must style exactly those classes.

4. PAGE CSS — one create_file per page (css/<page>.css) that styles EXACTLY the classes and ids that page uses: its page hero and each of its sections. Add only NEW rules; never rewrite or contradict base.css. The server checks that every class and id used in the HTML has a rule in the CSS linked from that page.

5. JS LAST — one create_file for js/main.js if the request needs interaction (mobile nav toggle, sticky header state, active link, smooth scroll, reveal-on-scroll, accordion, count-up stats, form validation, footer year, back-to-top). Every feature is guarded by element existence.

6. VERIFY — cheap server checks run after every page and again when you finish: missing files, broken links, root-absolute paths, classes and ids with no CSS rule, nav links missing on a page, JS selectors with no matching element. Fix exactly what they report, then end with a short summary that confirms each checklist item.

CHUNKING — the rule that keeps a build cheap:
- A file under about 250 lines MUST be written in ONE create_file call. Most pages, base.css and every page stylesheet fit in one call; prefer one call.
- Only a genuinely larger file is split, into at most 3 parts: create_file for part 1, then append_to_file for parts 2 and 3. Every part is a complete logical block of at least ~80 lines, never cut mid-tag or mid-rule.
- NEVER send a series of 10-line snippets, and NEVER call create_file twice on the same path — create_file overwrites the file and destroys every earlier part. Use append_to_file or edit_file to extend a file you already wrote.
- NEVER call a write tool with empty content or with a placeholder such as "[written: 248 lines]", "TODO: content" or "..." — the server rejects it and the file is not written. Always send the real, full content.

ASSET PATHS (one convention, every page): <link rel="stylesheet" href="css/base.css"> then <link rel="stylesheet" href="css/<page>.css"> in <head>, and <script src="js/main.js" defer></script> before </body>. NEVER start an asset path with "/" — "/css/base.css" is fetched from the server root instead of the project and 404s, which is exactly why a generated page renders unstyled. Do not use "./" or "../" on root pages.
NAV RULE: every page must be reachable from the nav of every other page. An item with no page of its own becomes a section with that id on the home page, linked as index.html#services from every page. No dead links, no href="#".
SECTION IDS (use exactly): home — hero, services, features, stats, testimonials, blogs, faq, cta; about — page-hero, story, mission, vision, values, stats, team; contact — page-hero, contact-form, contact-info.
HOME composition: hero (eyebrow badge, h1 with a gradient-highlighted keyword, subheading, two CTAs, an inline SVG or CSS visual, a trust stats row); services (6 cards: SVG icon, title, two sentences, link); features (3-4 icon rows); testimonials (3 cards: quote, initials avatar, name, role, 5-star SVG rating); blogs (3 cards: gradient thumbnail, category tag, title, excerpt, date within the last 6 months of today, read time); faq (6 items in an accessible accordion: button plus panel, aria-expanded, aria-controls, one open at a time); cta (full-width gradient banner with heading, text and button).
ABOUT composition: page hero; a 4-milestone story timeline ending in the current year; mission and vision cards; 4 values; 4 animated stat counters; a 4-member team grid (initials avatar, role, short bio, social icons).
CONTACT composition: page hero; two columns — a form (name, email, subject, message, submit) with labels, autocomplete attributes, inline validation errors and an in-page success message (never alert()), plus info cards (email, phone, address, working hours) and a stylized CSS/SVG map block.

DESIGN QUALITY CHECKLIST (what makes it look modern and professional, not old):
- Sticky translucent header (backdrop blur + border) with a hamburger that really opens the mobile menu below ~900px and closes on link click, outside click and Escape.
- Strong hero: eyebrow badge, big clamp() headline with a gradient-highlighted word, one-line subheadline, two CTAs, a gradient or inline-SVG visual, and a stats/proof strip.
- Cards in CSS grid (repeat(auto-fit, minmax(260px, 1fr))), generous whitespace on an 8px rhythm, max-width containers, subtle borders and shadows, card lift + shadow on hover, gradient accents, alternating section backgrounds (--bg / --surface), section padding 5-7rem on desktop.
- Consistent radius, type scale and spacing tokens; visible :focus-visible rings; 44px touch targets; no horizontal scroll at 360px; animations disabled under prefers-reduced-motion.
- Multi-column footer (brand blurb, quick links, contact, at least 4 labelled social icons drawn as inline SVG) plus a bottom bar with the current year.
- Real, specific copy about the business (no lorem ipsum, no generic filler), unique <title> and meta description per page, semantic landmarks, exactly one h1 per page, alt text or aria-label on every icon and control, a skip link.
- Go beyond the minimum on polish and useful extras (FAQ accordion, back-to-top, active nav state, reveal-on-scroll) when they fit the request — but no build step, no framework, and no file the request does not need.

FOLLOW-UP TASK (the project already exists — extend it, never rebuild it):
- The PROJECT SNAPSHOT in your system prompt is the source of truth: it holds the file list, each page's title and linked css/js, the EXACT header/nav and footer markup, the nav/footer link lists, the :root tokens and the shared class names. Read only files whose content you still need.
- Reuse the snapshot's <header> nav markup and <footer> markup byte-identically (only class="active" and aria-current change). create_file on a file that already exists is rejected: change existing pages with edit_file and extend stylesheets with append_to_file.
- Add every new nav link to the nav of ALL pages (edit_file on each existing page) and to the footer link lists so every page can reach every other page.
- New pages link the SAME base stylesheet as the existing pages, plus their own new css/<page>.css. Keep base.css exactly as it is; add only the new rules your new sections need.
- If the project still uses ONE stylesheet (css/style.css) keep using it: never create a second shared stylesheet for an existing project.
- The link/style connection check runs automatically when you finish; fix exactly what it reports.
NO OVER-ENGINEERING: no build step, no bundler, no framework, and no file beyond what the task and the design system need.`

export const vanillaDesignSystem = `DESIGN SYSTEM in the :root of css/base.css — color tokens (--bg, --surface, --surface-2, --text, --muted, --primary, --primary-600, --accent, --border), a spacing scale, radii, shadows, fluid type with clamp(), a container width and transition timings. Pick ONE cohesive palette that fits the brand (not default blue and white), support prefers-color-scheme dark through those variables, and keep contrast at least 4.5:1. Modern touches: gradient hero with soft blurred shapes, glass navbar, card lift and shadow on hover, gradient buttons with visible focus rings, 5-7rem desktop section padding, consistent radii, scroll reveal via IntersectionObserver adding .in-view, and every animation disabled under prefers-reduced-motion. Mentioned dark mode or theme in the task means a navbar theme toggle persisted in localStorage, with an inline head script that avoids the flash.
RESPONSIVE: mobile-first, breakpoints 640, 900 and 1200, grids built with repeat(auto-fit, minmax(260px, 1fr)), no horizontal scroll at 360px, touch targets at least 44px.
CSS SPLIT: base.css holds the tokens and every shared component; css/<page>.css holds only the sections of that page and never repeats a base rule.
JS in js/main.js, everything inside DOMContentLoaded and each feature guarded by element existence: hamburger toggle, sticky header state, active link, smooth scroll with header offset, reveal on scroll, accordion, count-up stats, form validation (required, email regex, message at least 10 characters, inline errors, success message, reset), footer year via new Date().getFullYear(), back-to-top button.`

export const vanillaCompactPrompt = vanillaPrompt
export const vanillaCompactDesignSystem = vanillaDesignSystem
