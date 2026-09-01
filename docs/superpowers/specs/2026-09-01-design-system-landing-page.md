# Design System + Landing Page: Design Spec

**Date:** 2026-09-01
**Status:** Approved for implementation planning

## Context

leather-nest has grown five working tools this project (core nesting,
photo digitization, skin-matching, die library, blotch-matching) with no
shared visual design — each page is unstyled HTML. A design handoff
(`design_handoff_leather_nest_ui/`, delivered 2026-09-01) specifies a
complete visual system, "Organic," plus six screens re-imagining the app.
That handoff is large enough to need its own decomposition into
sub-projects (recorded in project memory); this is the first and smallest
one: wire the design system itself into the codebase, and build the one
new screen that needs no engineering — the public landing page.

The handoff's own README was written against a stale snapshot of the repo
(pre-persistence) and names concepts — "Hides," "Patterns" — that this
project already has under different names — skins, dies. That
reconciliation belongs to the sub-projects that touch those libraries, not
this one; this sub-project touches no page-specific data model.

## Goals

- Copy the bundled `styles.css` (the Organic design system: colour/type/
  space/radius/shadow tokens plus `.btn`/`.tag`/`.card`/`.input`/etc.
  component classes) into `public/`, unmodified, as the one shared
  stylesheet every current and future page links.
- Load the two required fonts (Caprasimo, Figtree) from Google Fonts.
- Swap what `/` serves: today it's the working nest tool
  (`public/index.html`); going forward `/` is the new public landing page,
  and the nest tool moves to `/app.html`.
- Build the landing page per the handoff's section 1f: header, hero,
  three-step explainer — using real content and links (GitHub, LightBurn),
  not mockup placeholders, except where a real asset doesn't exist yet
  (see Non-goals).

## Non-goals

- Re-skinning any other existing page (`app.html`/former `index.html`,
  `dies.html`, `digitize.html`, `match-skins.html`, `match-blotches.html`)
  — each is its own later sub-project.
- The "Watch a 90s nest →" ghost button from the mockup — no demo video
  exists. Omitted entirely for now, not rendered disabled or as a dead
  link. Trivial to add back (one button, one link) once a real video
  exists — not a design decision that needs revisiting, just an asset
  that doesn't exist yet.
- A shared header/nav partial or any templating mechanism. This codebase
  has no build step and no page-composition system today — each page is a
  standalone `.html` file with its own full `<head>`. The landing page
  follows that same pattern (own `<head>`, own inline nav markup) rather
  than introducing a new abstraction for what is, after this sub-project,
  still only two pages needing a nav.
- Reconciling "Hides"/"Patterns" terminology with skins/dies, or any other
  page's data model — out of scope for a page with no data.
- Icons. Nothing in this screen requires one (the brand mark is a plain
  ring, steps use numbered circles, nav is text links) — Lucide (the
  handoff's suggested icon set) isn't pulled in until a page actually
  needs an icon.

## Architecture

Two independent pieces:

1. **Design system foundation** — `public/styles.css`, copied byte-for-byte
   from the handoff bundle (it is explicitly called out there as "part of
   the deliverable," not a mockup artifact). Every current and future page
   links it with `<link rel="stylesheet" href="/public/styles.css">` and
   the Google Fonts `<link>` from the handoff's README. This sub-project
   only touches the landing page's own `<head>`; other pages pick up the
   stylesheet when their own re-skin sub-project reaches them.
2. **Root swap + landing page** — `server.js`'s `serveStatic` maps
   `req.url` directly to a file under `__dirname` with no route table
   (confirmed by reading it), so it requires **zero changes**: `/` will
   automatically serve whatever `public/index.html` contains once that
   file's content changes, and a new `public/app.html` is served by the
   same generic static lookup already serving `/dies.html` today. The move
   is a file-level operation only: `git mv public/index.html
   public/app.html` (preserves history), then `public/index.html` is
   rewritten as the landing page. No other file references `index.html`
   by name — checked; none of the existing pages link to each other today.

No new dependencies, no new server routes, no new persistence — this is
the smallest sub-project in the project's history.

```
leather-nest/
  public/
    styles.css              # NEW: Organic design system, copied verbatim
    index.html               # REWRITTEN: was the nest tool, now the landing page
    app.html                  # NEW (moved): the nest tool, unchanged content, new filename
  server.js                    # UNCHANGED
```

## Components

### `public/styles.css`

Copied verbatim from the handoff's `styles.css`. Source of truth stays the
handoff bundle for this one-time copy; future token changes happen by
editing this file directly per its own header comment.

### `public/index.html` (landing page)

Structure per handoff section 1f, using real project data instead of
mockup placeholders:

- **Header:** brand mark (26px ring — inline SVG or CSS, no image asset)
  + "leather-nest"; nav links "How it works" (in-page anchor to the steps
  section, `#how-it-works`) and "LightBurn" (external link to
  `https://lightburnsoftware.com`, the laser software this project exports
  for); `.btn.btn-secondary` "GitHub" linking to
  `https://github.com/cheesemagic/leather-nest`.
- **Hero:** `.tag.tag-accent-2` "Open source · runs on your machine"; `<h1>`
  "Nest your patterns onto the hide you actually have."; body copy from
  the handoff verbatim; `.btn.btn-primary` "Get it running" linking to
  `/app.html` (this is the closest thing to a working demo that exists
  today — the actual tool). No ghost "watch a demo" button (see
  Non-goals). Right side: circular photo crop per the handoff's layout —
  since no real hide photograph is bundled with this sub-project either,
  this uses the same kind of hatched placeholder the mockup itself uses,
  wrapped in `.washed`, clearly swappable for a real photo later (same
  non-decision as the video link — an asset gap, not a design question).
- **Three steps:** Photograph / Nest / Cut, copy verbatim from the
  handoff, each a numbered circle + title + body.

All colours, type sizes, spacing, and radii come from `styles.css`'s
variables and component classes (`.btn`, `.tag`) per the handoff's
"do not hard-code a hex or a px value the tokens already carry" rule — no
new CSS file, no inline styles beyond what a one-off layout (grid columns,
the circular crop) genuinely needs and can't get from an existing class.

### `public/app.html` (moved, unchanged)

Exact byte-for-byte move of the current `public/index.html` — the working
nest tool's markup and script tags are untouched. No visual or behavioral
change; it simply lives at a new URL. Re-skinning it is a separate,
later sub-project.

## Error Handling

Nothing new to handle — no user input, no network calls beyond loading
Google Fonts (which degrade to the `system-ui` fallback already declared
in the font stack if the CDN is unreachable, per the CSS's own
`font-family` fallback chain).

## Testing

No automated test — this sub-project is entirely static markup and CSS,
matching this project's established precedent of no automated tests for
browser-only, logic-free pages. Manual verification: open `/` and confirm
the landing page renders with real links working (GitHub, LightBurn,
in-page anchor, "Get it running" → the moved tool); open `/app.html` and
confirm the nest tool still works exactly as before the move.

## Licensing / Attribution

`styles.css` is an original deliverable from this project's own design
handoff (Organic design system), not third-party code — no attribution
required. The two Google Fonts (Caprasimo, Figtree) are loaded via their
standard Google Fonts CDN link, same as any project using them; no local
font files are vendored.

## Future Work (separate design conversations)

- Re-skinning `app.html` (the nest workspace) onto Organic, plus the new
  nesting capabilities the handoff specifies for it (quantity, kerf/
  spacing, manual drag-and-rotate, defect avoidance) — the largest
  remaining sub-project, including real new nesting-engine geometry work.
- Re-skinning the hide library (today's skins library) onto Organic,
  extending its fields (thickness, defects) per the handoff's "Hides"
  screen.
- Re-skinning the pattern library (today's dies library) onto Organic,
  plus new job-history persistence, per the handoff's "Patterns + Jobs"
  screen.
- Re-skinning the phone capture flow (`digitize.html`) onto Organic — the
  handoff notes this needs no new digitize logic, purely visual.
- A real hide photograph and/or a real demo video for the landing page's
  hero, once either exists.
- Deciding whether/how `match-skins.html` and `match-blotches.html` fit
  into the new design and navigation — explicitly deferred by the user
  during this sub-project's brainstorming, not scheduled.
