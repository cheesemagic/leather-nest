# Design System + Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the "Organic" design system stylesheet into the app, and
replace `public/index.html` with a real public landing page — moving the
current nest tool to `/app.html` in the process.

**Architecture:** Two independent tasks. Task 1 copies the design-system
stylesheet into `public/styles.css` (no page links it yet). Task 2 moves
the current nest tool's markup to `public/app.html` unchanged, then writes
a new `public/index.html` as the landing page, linking the stylesheet from
Task 1. `server.js` needs no changes — its static-file handler already
serves whatever `public/index.html`/`public/app.html` contain.

**Tech Stack:** Plain HTML/CSS, no build step, no new dependencies —
matches the rest of this project.

**Spec:** `docs/superpowers/specs/2026-09-01-design-system-landing-page.md`

## Global Constraints

- No new dependencies, no new server routes, no new persistence.
- Every colour, font, space, radius, and shadow comes from
  `public/styles.css`'s CSS variables and component classes (`.btn`,
  `.tag`) — never a hard-coded hex or px value the tokens already carry.
- No shared header/nav partial or templating mechanism — each page keeps
  its own full `<head>` and inline markup, matching this codebase's
  existing pattern (no build step, no framework).
- The "Watch a 90s nest →" button from the mockup is omitted entirely (no
  real video exists yet) — not rendered disabled, not a dead link.
- `server.js` is not modified in this plan — its static handler already
  covers both files once they exist.

---

## Task 1: Design system stylesheet

**Files:**
- Create: `public/styles.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `public/styles.css`, a static asset. Defines CSS custom
  properties (`--color-bg`, `--color-accent`, `--color-accent-2`,
  `--color-neutral-100`...`900`, `--color-accent-100`...`900`,
  `--color-accent-2-100`...`900`, `--font-heading`, `--font-body`,
  `--space-1`...`8`, `--radius-sm`/`md`/`lg`, `--shadow-sm`/`md`/`lg`) and
  component classes (`.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`/
  `.btn-block`, `.tag`/`.tag-accent`/`.tag-accent-2`/`.tag-neutral`/
  `.tag-outline`, `.card`, `.input`, `.table`, `.dialog`, `.washed`, `.nav`,
  `.seg`/`.seg-opt`, `.radio`, `.hr`). Task 2 links this file and uses
  these classes/variables directly.

- [ ] **Step 1: Create `public/styles.css`**

```css
/* Organic — design-system tokens and component classes. This file is the source of truth for the system's look; retune it here and see readme.md. */
@import url('https://fonts.googleapis.com/css2?family=Caprasimo:wght@400&family=Figtree:wght@400;600;700&display=swap');

:root {
  --color-bg: #f5ead8;
  --color-surface: #ebddc5;
  --color-text: #201e1d;
  --color-accent: #c67139;
  --color-accent-2: #7a8a5e;
  --color-divider: color-mix(in srgb, #201e1d 16%, transparent);

  /* Tonal ramps — generated in OKLCH on one shared lightness scale, so the
     same step of any role matches the others in visual value. */
  --color-neutral-100: #f9f4ed;
  --color-neutral-200: #eee7db;
  --color-neutral-300: #dcd3c4;
  --color-neutral-400: #c0b6a5;
  --color-neutral-500: #a19786;
  --color-neutral-600: #82796a;
  --color-neutral-700: #645c50;
  --color-neutral-800: #474238;
  --color-neutral-900: #2e2b25;

  --color-accent-100: #fff2eb;
  --color-accent-200: #ffe1d0;
  --color-accent-300: #ffc6a5;
  --color-accent-400: #f6a06b;
  --color-accent-500: #d67f48;
  --color-accent-600: #b2622d;
  --color-accent-700: #8c491a;
  --color-accent-800: #643312;
  --color-accent-900: #402310;

  --color-accent-2-100: #f0fae1;
  --color-accent-2-200: #e1eecc;
  --color-accent-2-300: #ccdbb2;
  --color-accent-2-400: #aebf92;
  --color-accent-2-500: #8fa073;
  --color-accent-2-600: #728157;
  --color-accent-2-700: #56633f;
  --color-accent-2-800: #3d472b;
  --color-accent-2-900: #272e1b;

  --font-heading: "Caprasimo", system-ui, sans-serif;
  --font-heading-weight: 400;
  --font-body: "Figtree", system-ui, sans-serif;

  --space-1: 4.4px;
  --space-2: 8.8px;
  --space-3: 13.2px;
  --space-4: 17.6px;
  --space-6: 26.4px;
  --space-8: 35.2px;

  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 28px;

  /* Elevation — derived from the ground: soft ink-tinted shadows on a
     light theme, a hairline edge + ambient darkness on a dark one. */
  --shadow-sm: 0 1px 2px color-mix(in srgb, #2e2b25 14%, transparent);
  --shadow-md: 0 3px 10px color-mix(in srgb, #2e2b25 16%, transparent);
  --shadow-lg: 0 12px 32px color-mix(in srgb, #2e2b25 22%, transparent);
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
}
h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: var(--font-heading-weight); }

.washed{filter:saturate(0.6) contrast(0.85) brightness(1.1) opacity(0.94)}

/* ══════════════════════════════════════════════════════════════════════════
   Components — built with the tokens above. Plain CSS
   on plain HTML: no JavaScript, no build step. Each class is documented in
   readme.md and demonstrated in foundations/ and components/.
   ══════════════════════════════════════════════════════════════════════ */

*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-size: 15px; line-height: 1.55; font-weight: 400; }
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 var(--space-2);
}
h1 { font-size: 42px; }
h2 { font-size: 32px; }
h3 { font-size: 25px; }
h4 { font-size: 20px; }
h5 { font-size: 16px; }
h6 { font-size: 13px; }
h6 { letter-spacing: 0.08em; text-transform: uppercase; }
p { margin: 0 0 var(--space-3); }
a { color: var(--color-accent); text-underline-offset: 3px; }
img { display: block; max-width: 100%; }
figure { margin: 0; }
figcaption {
  font-size: 11px; margin-top: var(--space-1);
  color: color-mix(in srgb, var(--color-text) 55%, transparent);
}
.text-muted { color: color-mix(in srgb, var(--color-text) 55%, transparent); }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
::selection { background: color-mix(in srgb, var(--color-accent) 30%, transparent); }

/* — rules — */
.hr {
  height: 1px; border: 0; margin: var(--space-4) 0;
  background: var(--color-divider);
}

/* — buttons — */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  cursor: pointer; text-decoration: none;
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  font-size: 14px; line-height: 1.2; color: var(--color-text); /* matches the .input's 14px —
     the pair sits side by side in sign-up rows */
  background: transparent; border: 1px solid transparent;
  padding: var(--space-2) calc(var(--space-3) * 1.2);
  border-radius: var(--radius-md);
}
.btn svg { display: block; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: var(--color-accent); color: var(--color-bg); }
.btn-primary:hover { background: var(--color-accent-600); }
.btn-primary:active { background: var(--color-accent-700); }
.btn-secondary { border-color: var(--color-divider); }
.btn-secondary:hover { background: color-mix(in srgb, var(--color-text) 7%, transparent); }
.btn-secondary:active { background: color-mix(in srgb, var(--color-text) 14%, transparent); }
.btn-ghost { color: var(--color-accent); padding-inline: var(--space-1); }
.btn-ghost:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
.btn-ghost:active { background: color-mix(in srgb, var(--color-accent) 18%, transparent); }
.btn-icon { width: 36px; height: 36px; padding: 0; }
.btn-block { width: 100%; margin-top: var(--space-2); }

/* — forms — */
.field > label {
  display: block; font-size: 12px; margin-bottom: 5px;
  color: color-mix(in srgb, var(--color-text) 70%, transparent);
}
.input {
  width: 100%; min-height: 36px; padding: 6px 10px; font: inherit;
  font-size: 14px; color: var(--color-text); caret-color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid var(--color-divider); border-radius: var(--radius-md);
}
.input:hover { border-color: color-mix(in srgb, var(--color-text) 45%, transparent); }
.input:focus-visible { border-color: var(--color-accent); outline-offset: 0; }
textarea.input { min-height: 90px; resize: vertical; }
.radio { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; }
.radio input, .seg-opt input {
  position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;
}
.radio .dot {
  width: 16px; height: 16px; flex: none; border-radius: 50%;
  border: 1.5px solid var(--color-divider);
}
.radio:hover .dot { border-color: var(--color-accent); }
.radio input:checked + .dot {
  border-color: var(--color-accent); background: var(--color-accent);
  box-shadow: inset 0 0 0 4px var(--color-bg);
}
.radio input:focus-visible + .dot { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.seg {
  display: inline-flex; overflow: hidden;
  border: 1px solid var(--color-divider); border-radius: var(--radius-md);
}
.seg-opt {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; font-size: 13px; cursor: pointer;
}
.seg-opt + .seg-opt { border-left: 1px solid var(--color-divider); }
.seg-opt:has(input:checked) { background: var(--color-accent); color: var(--color-bg); }
.seg-opt:not(:has(input:checked)):hover { background: color-mix(in srgb, var(--color-text) 7%, transparent); }
.seg-opt:has(input:focus-visible) { outline: 2px solid var(--color-accent); outline-offset: -2px; }

/* — cards — */
.card {
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface);
}
.card-kicker { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent); }
.card-title {
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  font-size: 17px; line-height: 1.2;
}
.card-body { margin: 0; font-size: 13px; opacity: 0.8; flex: 1; }
.card-meta {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
  color: color-mix(in srgb, var(--color-text) 50%, transparent);
}
.elev-sm { box-shadow: var(--shadow-sm); }
.elev-md { box-shadow: var(--shadow-md); }
.elev-lg { box-shadow: var(--shadow-lg); }

/* — tags — */
.tag {
  display: inline-flex; align-items: center; font-size: 11px;
  letter-spacing: 0.02em; padding: 3px 10px;
  border-radius: calc(var(--radius-md) * 0.75);
}
.tag-accent { background: var(--color-accent-100); color: var(--color-accent-800); }
.tag-accent-2 { background: var(--color-accent-2-100); color: var(--color-accent-2-800); }
.tag-neutral { background: var(--color-neutral-100); color: var(--color-neutral-800); }
.tag-outline { border: 1px solid var(--color-accent); color: var(--color-accent); }

/* — navigation — */
.nav {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-bottom: none;
}
.nav-brand {
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  font-size: 18px; margin-right: auto;
}
.nav a { color: inherit; text-decoration: none; font-size: 14px; }
.nav a:hover, .nav a[aria-current='page'] { color: var(--color-accent); }

/* — tables — */
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th {
  text-align: left; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: color-mix(in srgb, var(--color-text) 60%, transparent);
  padding: var(--space-2); border-bottom: 1px solid var(--color-divider);
}
.table td {
  padding: var(--space-2);
  border-bottom: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
}
.table tbody tr:hover { background: color-mix(in srgb, var(--color-text) 4%, transparent); }

/* — dialog — */
.dialog-backdrop {
  position: fixed; inset: 0; display: grid; place-items: center;
  padding: var(--space-4);
  background: color-mix(in srgb, var(--color-neutral-900) 50%, transparent);
}
.dialog {
  width: min(440px, 100%); display: flex; flex-direction: column; gap: var(--space-3);
  padding: var(--space-4); border-radius: var(--radius-lg);
  background: var(--color-surface); box-shadow: var(--shadow-lg);
}
.dialog-title {
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  font-size: 20px;
}
.dialog-body { font-size: 14px; opacity: 0.85; }
.dialog-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }

/* — rounded frame: everything softens, small controls go pill — */
.card, .dialog { border-radius: calc(var(--radius-lg) * 1.15); }
.btn, .tag, .seg, .input { border-radius: 999px; }
.input { padding-inline: 14px; }
```

- [ ] **Step 2: Verify the file was written correctly**

Run: `wc -l public/styles.css`
Expected: `257 public/styles.css`

Run: `grep -c -- "--color-accent: #c67139" public/styles.css`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "feat: add Organic design system stylesheet"
```

---

## Task 2: Root swap + landing page

**Files:**
- Modify (move): `public/index.html` → `public/app.html` (content unchanged)
- Create: `public/index.html` (new landing page)

**Interfaces:**
- Consumes: `public/styles.css` from Task 1 (linked via `<link rel="stylesheet">`), its CSS variables and `.btn`/`.tag` classes.
- Produces: nothing consumed by a later task — this plan has only 2 tasks.

- [ ] **Step 1: Move the current nest tool to `app.html`**

```bash
git mv public/index.html public/app.html
```

- [ ] **Step 2: Verify the move preserved content**

Run: `grep -c "leather-nest v0" public/app.html`
Expected: `1`

Run: `test -f public/index.html && echo EXISTS || echo GONE`
Expected: `GONE`

- [ ] **Step 3: Create the new `public/index.html` landing page**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>leather-nest — nest your patterns onto the hide you actually have</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/public/styles.css" />
    <style>
      .landing-header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        padding: 16px var(--space-8);
        border-bottom: 1px solid var(--color-divider);
      }
      .landing-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: var(--font-heading);
        font-size: 18px;
        color: var(--color-text);
        text-decoration: none;
      }
      .landing-ring {
        width: 24px;
        height: 24px;
        border-radius: 999px;
        background: var(--color-accent);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
      }
      .landing-ring::after {
        content: "";
        width: 11px;
        height: 11px;
        border-radius: 999px;
        background: var(--color-bg);
      }
      .landing-nav {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin-left: auto;
        font-size: 13px;
        color: var(--color-neutral-700);
      }
      .landing-nav a { color: inherit; text-decoration: none; }
      .landing-nav a:hover { color: var(--color-accent); }

      .hero {
        display: grid;
        grid-template-columns: 1.05fr .95fr;
        gap: var(--space-8);
        align-items: center;
        padding: var(--space-8) var(--space-8) var(--space-6);
      }
      .hero h1 {
        font-size: 58px;
        line-height: 1.02;
        text-wrap: pretty;
        margin: 16px 0 18px;
      }
      .hero p {
        font-size: 16px;
        line-height: 1.65;
        color: var(--color-neutral-800);
        max-width: 46ch;
        text-wrap: pretty;
      }
      .hero-actions { display: flex; align-items: center; gap: 11px; }
      .hero-actions .btn { font-size: 15px; padding: 13px 26px; }

      .hero-photo {
        aspect-ratio: 1;
        border-radius: 999px;
        background: var(--color-accent-2-200);
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .hero-photo-hatch {
        position: absolute;
        inset: 0;
        background-image: repeating-linear-gradient(
          45deg,
          color-mix(in srgb, var(--color-accent-2-700) 22%, transparent) 0 2px,
          transparent 2px 9px
        );
      }
      .hero-photo svg { position: relative; width: 88%; }
      .hero-outline { fill: none; stroke: var(--color-accent-900); stroke-width: 3; }
      .hero-piece { fill: var(--color-accent-500); fill-opacity: 0.3; stroke: var(--color-accent-600); stroke-width: 3; }

      .steps {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-4);
        padding: 0 var(--space-8) var(--space-8);
      }
      .step { display: flex; gap: 14px; }
      .step-num {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 999px;
        background: var(--color-accent-200);
        color: var(--color-accent-800);
        font-family: var(--font-heading);
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .step h3 { font-size: 17px; margin: 0 0 6px; }
      .step p { font-size: 13px; line-height: 1.55; color: var(--color-neutral-700); margin: 0; }

      @media (max-width: 860px) {
        .hero { grid-template-columns: 1fr; }
        .hero-photo { max-width: 320px; margin: 0 auto; }
        .steps { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header class="landing-header">
      <a class="landing-brand" href="/">
        <span class="landing-ring" aria-hidden="true"></span>
        leather-nest
      </a>
      <nav class="landing-nav">
        <a href="#how-it-works">How it works</a>
        <a href="https://lightburnsoftware.com" target="_blank" rel="noopener">LightBurn</a>
        <a class="btn btn-secondary" href="https://github.com/cheesemagic/leather-nest" target="_blank" rel="noopener">GitHub</a>
      </nav>
    </header>

    <section class="hero">
      <div>
        <span class="tag tag-accent-2">Open source · runs on your machine</span>
        <h1>Nest your patterns onto the hide you actually have.</h1>
        <p>
          Photograph an exotic offcut, calibrate it against a ruler, and
          leather-nest maps its true outline in millimetres — then packs
          your pattern pieces around the scars and exports a cut file
          straight to LightBurn.
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="/app.html">Get it running</a>
        </div>
      </div>
      <div class="hero-photo">
        <div class="hero-photo-hatch washed" aria-hidden="true"></div>
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <path class="hero-outline" d="M30 60 Q20 120 60 160 Q120 190 160 140 Q185 90 150 50 Q100 15 30 60 Z" />
          <rect class="hero-piece" x="70" y="70" width="42" height="30" rx="4" />
          <rect class="hero-piece" x="95" y="105" width="34" height="46" rx="4" />
        </svg>
      </div>
    </section>

    <section class="steps" id="how-it-works">
      <div class="step">
        <span class="step-num">1</span>
        <div>
          <h3>Photograph</h3>
          <p>Any phone shot with a ruler in frame. Two taps set the scale.</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <div>
          <h3>Nest</h3>
          <p>Pieces pack around the real edges and the scars you flag, with kerf and grain honoured.</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <div>
          <h3>Cut</h3>
          <p>Export a millimetre-true SVG that opens in LightBurn ready for the Nova 51.</p>
        </div>
      </div>
    </section>
  </body>
</html>
```

- [ ] **Step 4: Verify structural content**

Run: `grep -c 'href="/public/styles.css"' public/index.html`
Expected: `1`

Run: `grep -c 'href="/app.html"' public/index.html`
Expected: `1`

Run: `grep -c 'href="https://github.com/cheesemagic/leather-nest"' public/index.html`
Expected: `1`

Run: `grep -c 'id="how-it-works"' public/index.html`
Expected: `1`

Run: `grep -c "Watch a 90s nest" public/index.html`
Expected: `0`

- [ ] **Step 5: Verify live in a browser**

Start the dev server (`npm start` or `node server.js`), then:
1. Navigate to `http://localhost:8080/`.
2. Confirm the page renders: header with brand mark + nav + GitHub button, hero with tag/heading/body/"Get it running" button and the circular photo placeholder, three numbered steps below.
3. Check the browser console for errors (font/stylesheet 404s, CSS parse errors).
4. Click "How it works" — confirm it scrolls to the steps section.
5. Click "Get it running" — confirm it navigates to `/app.html` and the original nest tool (title "leather-nest v0", digitize link, export button) still works exactly as before.
6. Resize the viewport below 860px — confirm the hero stacks to one column and the steps stack to one column.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: replace root with a public landing page, move nest tool to /app.html"
```

---

## Self-Review Notes

- **Spec coverage:** stylesheet copy (Task 1), root swap via `git mv`
  (Task 2 Step 1), landing page header/hero/steps content matching the
  handoff's section 1f copy verbatim (Task 2 Step 3), omitted "Watch a 90s
  nest" button (verified absent in Task 2 Step 4), real GitHub/LightBurn
  links, `server.js` untouched (no task modifies it) — all covered.
- **Placeholder scan:** no TBD/TODO; both tasks contain complete file
  content, not descriptions.
- **Type/name consistency:** Task 2's `<link href="/public/styles.css">`
  matches the exact path Task 1 creates. The `.tag-accent-2`, `.btn-primary`,
  `.btn-secondary` classes used in Task 2's HTML are all defined in Task 1's
  stylesheet (verified against the embedded CSS above — `.tag-accent-2` at
  the tags section, `.btn-primary`/`.btn-secondary` at the buttons section).
