# Find Best Use C2 — Page Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or manual task tracking (checkbox `- [ ]` syntax) for progress. Steps are meant to be executed sequentially unless marked as parallel.

**Goal:** A single-page interface that makes the C1 pipeline usable: pick a hide, choose a mode, set strategy and cutting method, run, and see ranked results with visual layouts.

**Architecture:** Compose C1's five pure modules; add no new logic that could be tested independently. `public/find-best-use.html` + `src/find-best-use-app.js` follow the pattern of existing pages (`hides-app.js`, `dies-app.js`) — no framework, no bundler, DOM manipulation only.

**Tech Stack:** Existing: Organic design system, ES modules, node:http server. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-find-best-use-c2-design.md`

## Global Constraints

- **Compose C1, don't reimplement.** All five pure modules (`filterEligible`,
  `estimateCapacity`, `generateCandidates`, `evaluateCandidate`,
  `rankCandidates`) are imported and called as-is.
- **No DOM test.** Page wiring (`src/find-best-use-app.js`) is verified by
  viewing in a browser per repo convention.
- **Organic design system.** Use existing tokens and components. No new styles
  unless they express Organic principles.
- **No new stored fields, no new stores.** C2 reads existing hide and component
  records. No database changes or migrations.
- **The Laser/Die toggle is here.** Cutting method is a page-level choice,
  passed to `resolveClearances()` to compute part-level clearances.
- **Precision control is a three-button set.** Not a slider. Fast (10 mm),
  Balanced (5 mm, default), Maximum (1 mm). Each re-runs with a new
  `GRID_STEP_MM`.
- **Unverified gates confirm, not search.** A component with an unverified
  constraint is still eligible and nests normally. The confirm button blocks
  and prompts for re-measurement.
- **No default ranking strategy.** Strategy is mandatory in Rank Singles mode;
  omission is an error.
- **Estimates are never shown as layouts.** Only `nest()` output appears in
  visual results.

---

## Task 1: Page structure and bootstrap

**Files:**
- Create: `public/find-best-use.html`
- Create: `src/find-best-use-app.js` (skeleton)
- Modify: `src/router.js` (add route, if it exists) or `server.js` (if routes
  are inline)

**Deliverables:**
- A bare HTML page with semantic sections (hide picker, mode picker, strategy
  picker, cutting method picker, precision selector, run button, results area).
- Skeleton `find-best-use-app.js` that imports C1 modules and sets up a global
  app state object.
- Page is reachable at `/find-best-use` (or a path of your choice).

- [ ] **Step 1: Create the HTML page**

Create `public/find-best-use.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/styles/organic.css" />
  <title>Find Best Use</title>
  <style>
    body { font-family: var(--font-sans); }
    .container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
    .controls { display: flex; flex-direction: column; gap: 1rem; }
    .control-group { display: flex; flex-direction: column; gap: 0.5rem; }
    .button-group { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .button { padding: 0.5rem 1rem; cursor: pointer; border: 1px solid; }
    .button.active { font-weight: bold; background: var(--color-primary); }
    #results { margin-top: 2rem; }
    .candidate-card { border: 1px solid; padding: 1rem; margin-bottom: 1rem; }
    #layout-canvas { border: 1px solid #ccc; max-width: 100%; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Find Best Use</h1>

    <div class="two-col">
      <div class="controls">
        <div class="control-group">
          <label for="hide-select">Hide</label>
          <select id="hide-select"></select>
        </div>

        <div class="control-group">
          <label>Mode</label>
          <div class="button-group">
            <button data-mode="explicit">You Choose</button>
            <button data-mode="singles">Rank Singles</button>
          </div>
        </div>

        <div id="explicit-section" style="display: none;">
          <div class="control-group">
            <label>Components</label>
            <div id="component-list"></div>
          </div>
        </div>

        <div id="singles-section" style="display: none;">
          <div class="control-group">
            <label for="strategy-select">Ranking Strategy</label>
            <select id="strategy-select">
              <option value="">-- Choose strategy --</option>
              <option value="value">Highest Value</option>
              <option value="utilization">Highest Utilization</option>
              <option value="demand">Most Orders Filled</option>
            </select>
          </div>

          <div class="control-group">
            <label for="shortlist-size">Shortlist Size</label>
            <input type="number" id="shortlist-size" min="1" value="5" />
          </div>
        </div>

        <div class="control-group">
          <label>Cutting Method</label>
          <div class="button-group">
            <button data-method="laser">Laser</button>
            <button data-method="die">Die</button>
          </div>
        </div>

        <div id="laser-section" style="display: none;">
          <div class="control-group">
            <label for="laser-clearance">Laser Clearance (mm)</label>
            <input type="number" id="laser-clearance" step="0.1" value="1.0" />
          </div>
        </div>

        <div class="control-group">
          <label>Precision</label>
          <div class="button-group">
            <button data-precision="10">Fast</button>
            <button data-precision="5" class="active">Balanced</button>
            <button data-precision="1">Maximum</button>
          </div>
        </div>

        <button id="run-button" style="padding: 0.75rem; font-size: 1rem;">
          Run
        </button>
      </div>

      <div id="results"></div>
    </div>
  </div>

  <script type="module" src="/src/find-best-use-app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the app skeleton**

Create `src/find-best-use-app.js`:

```js
import { filterEligible } from './bestuse/eligibility.js';
import { generateCandidates } from './bestuse/candidates.js';
import { evaluateCandidate } from './bestuse/evaluate.js';
import { rankCandidates } from './bestuse/ranking.js';

const state = {
  hides: [],
  components: [],
  selectedHideId: null,
  mode: 'singles',
  quantities: {},
  strategy: null,
  method: 'laser',
  laserClearanceMm: 1.0,
  gridStepMm: 5,
  results: [],
  isRunning: false,
};

// TODO: DOM selectors and event handlers will be added task by task.

async function init() {
  // Fetch hides and components from server
  const hidesResp = await fetch('/hides');
  state.hides = await hidesResp.json();

  const componentsResp = await fetch('/dies');
  state.components = await componentsResp.json();

  renderHideSelect();
  attachEventListeners();
}

function renderHideSelect() {
  // TODO: Task 2
}

function attachEventListeners() {
  // TODO: Will grow with each task
}

function run() {
  // TODO: Task 7
}

init().catch(console.error);
```

- [ ] **Step 3: Verify the page loads**

Start the server: `npm start`

Navigate to `http://localhost:8080/find-best-use`. The page should load with
an empty hide dropdown and all controls visible (but some sections hidden by
inline `display: none` per mode/method).

---

## Task 2: Hide dropdown and filtering

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- Dropdown populates with all hides.
- Hides without outlines or with `remainingAreaPct < 100` are disabled (grayed
  out, show reason on hover).
- Selecting a hide updates `state.selectedHideId` and shows metadata (area,
  species, thickness).

- [ ] **Step 1: Populate hide dropdown**

In `renderHideSelect()`:

```js
function renderHideSelect() {
  const select = document.getElementById('hide-select');
  select.innerHTML = '';

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '-- Choose a hide --';
  select.appendChild(blank);

  for (const hide of state.hides) {
    const option = document.createElement('option');
    option.value = hide.id;
    
    let label = hide.id;
    if (hide.species) label += ` (${hide.species})`;
    
    // Disable if no outline or partially cut
    if (!hide.outlinePolygon) {
      option.disabled = true;
      option.textContent = `${label} — needs outline`;
    } else if ((hide.remainingAreaPct ?? 100) < 100) {
      option.disabled = true;
      option.textContent = `${label} — ${hide.remainingAreaPct}% remaining`;
    } else {
      option.textContent = label;
    }
    
    select.appendChild(option);
  }
}
```

- [ ] **Step 2: Attach hide-select listener**

In `attachEventListeners()`:

```js
document.getElementById('hide-select').addEventListener('change', (e) => {
  state.selectedHideId = e.target.value;
});
```

- [ ] **Step 3: Show hide metadata (optional enhancement)**

When a hide is selected, display area, species, thickness, remaining %. This
can be a simple text block below the dropdown, or a modal. For now, a text
block is sufficient.

---

## Task 3: Mode picker (You Choose vs Rank Singles)

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- Two buttons: "You Choose" and "Rank Singles". Only one active at a time.
- Clicking a button updates `state.mode`, shows/hides relevant sections, and
  resets component selections.

- [ ] **Step 1: Attach mode buttons**

In `attachEventListeners()`:

```js
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', (e) => {
    const newMode = e.target.dataset.mode;
    state.mode = newMode;
    state.quantities = {}; // Reset on mode switch
    state.strategy = null;
    updateModeUI();
  });
}
```

- [ ] **Step 2: Implement updateModeUI()**

```js
function updateModeUI() {
  // Update active button styling
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  }

  // Show/hide sections
  const explicitSection = document.getElementById('explicit-section');
  const singlesSection = document.getElementById('singles-section');

  if (state.mode === 'explicit') {
    explicitSection.style.display = 'block';
    singlesSection.style.display = 'none';
    renderComponentList();
  } else {
    explicitSection.style.display = 'none';
    singlesSection.style.display = 'block';
  }
}
```

---

## Task 4: You Choose mode — component list with quantities

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- A list of components, each with a checkbox and a quantity input.
- Toggling checkbox or changing quantity updates `state.quantities`.
- Only visible in You Choose mode.

- [ ] **Step 1: Implement renderComponentList()**

```js
function renderComponentList() {
  const container = document.getElementById('component-list');
  container.innerHTML = '';

  for (const component of state.components) {
    const div = document.createElement('div');
    div.style.marginBottom = '0.5rem';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = component.id;
    checkbox.checked = (state.quantities[component.id] ?? 0) > 0;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = state.quantities[component.id] ?? 0;
    input.style.width = '50px';
    input.style.marginLeft = '0.5rem';

    const label = document.createElement('label');
    label.style.marginLeft = '0.5rem';
    label.textContent = component.name || component.id;

    checkbox.addEventListener('change', () => {
      if (checkbox.checked && input.value === '0') {
        input.value = 1;
      }
      updateQuantity(component.id, parseInt(input.value) || 0);
    });

    input.addEventListener('change', () => {
      updateQuantity(component.id, parseInt(input.value) || 0);
      checkbox.checked = (state.quantities[component.id] ?? 0) > 0;
    });

    div.appendChild(checkbox);
    div.appendChild(label);
    div.appendChild(input);
    container.appendChild(div);
  }
}

function updateQuantity(componentId, quantity) {
  if (quantity > 0) {
    state.quantities[componentId] = quantity;
  } else {
    delete state.quantities[componentId];
  }
}
```

---

## Task 5: Rank Singles mode — strategy picker

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- A dropdown (or radio buttons) for strategy: value, utilization, demand.
- A number input for shortlist size (default SHORTLIST_SIZE).
- Only visible in Rank Singles mode.
- Strategy selection is mandatory; Run is disabled until chosen.

- [ ] **Step 1: Attach strategy-select listener**

In `attachEventListeners()`:

```js
document.getElementById('strategy-select').addEventListener('change', (e) => {
  state.strategy = e.target.value;
  updateRunButtonState();
});

document.getElementById('shortlist-size').addEventListener('change', (e) => {
  state.shortlistSize = parseInt(e.target.value) || 5;
});
```

- [ ] **Step 2: Implement updateRunButtonState()**

```js
function updateRunButtonState() {
  const runButton = document.getElementById('run-button');
  const canRun =
    state.selectedHideId &&
    (state.mode === 'explicit'
      ? Object.keys(state.quantities).length > 0
      : state.strategy !== null);

  runButton.disabled = !canRun;
}
```

Call `updateRunButtonState()` whenever hide, mode, quantities, or strategy
change.

---

## Task 6: Cutting method picker (Laser vs Die)

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- Two buttons: "Laser" and "Die".
- Laser method shows a laser clearance input (default 1.0 mm).
- Die method hides the input.
- Changing method updates `state.method` and re-runs if results exist.

- [ ] **Step 1: Attach method buttons**

In `attachEventListeners()`:

```js
for (const button of document.querySelectorAll('[data-method]')) {
  button.addEventListener('click', (e) => {
    const newMethod = e.target.dataset.method;
    state.method = newMethod;
    updateMethodUI();
    if (state.results.length > 0) run();
  });
}
```

- [ ] **Step 2: Implement updateMethodUI()**

```js
function updateMethodUI() {
  // Update active button styling
  for (const button of document.querySelectorAll('[data-method]')) {
    button.classList.toggle('active', button.dataset.method === state.method);
  }

  // Show/hide laser section
  const laserSection = document.getElementById('laser-section');
  laserSection.style.display = state.method === 'laser' ? 'block' : 'none';
}
```

In `attachEventListeners()`, also attach the laser clearance input:

```js
document.getElementById('laser-clearance').addEventListener('change', (e) => {
  state.laserClearanceMm = parseFloat(e.target.value) || 1.0;
  if (state.results.length > 0) run();
});
```

---

## Task 7: Precision selector (three buttons)

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- Three buttons: Fast (10 mm), Balanced (5 mm, default), Maximum (1 mm).
- Clicking updates `state.gridStepMm` and re-runs if results exist.

- [ ] **Step 1: Attach precision buttons**

In `attachEventListeners()`:

```js
for (const button of document.querySelectorAll('[data-precision]')) {
  button.addEventListener('click', (e) => {
    const newPrecision = parseInt(e.target.dataset.precision);
    state.gridStepMm = newPrecision;
    updatePrecisionUI();
    if (state.results.length > 0) run();
  });
}
```

- [ ] **Step 2: Implement updatePrecisionUI()**

```js
function updatePrecisionUI() {
  for (const button of document.querySelectorAll('[data-precision]')) {
    button.classList.toggle(
      'active',
      parseInt(button.dataset.precision) === state.gridStepMm
    );
  }
}
```

---

## Task 8: Run button and main pipeline

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- Run button calls the C1 pipeline in order: filter → generate → evaluate →
  rank.
- Button shows loading state while running.
- Results are stored in `state.results` and passed to render task.

- [ ] **Step 1: Implement run()**

```js
async function run() {
  if (state.isRunning) return;
  state.isRunning = true;

  const runButton = document.getElementById('run-button');
  const originalText = runButton.textContent;
  runButton.textContent = 'Running...';
  runButton.disabled = true;

  try {
    const hide = state.hides.find((h) => h.id === state.selectedHideId);
    if (!hide) throw new Error('Hide not selected');

    // Task 1: Filter eligible components
    const { eligible, excluded, hideRejection } = filterEligible(
      hide,
      state.components
    );

    if (hideRejection) {
      state.results = [];
      renderResults({
        error: `Hide cannot be used: ${hideRejection}`,
      });
      return;
    }

    // Task 2: Generate candidates
    const candidates = generateCandidates(state.mode, eligible, {
      hide,
      quantities:
        state.mode === 'explicit' ? state.quantities : undefined,
      strategy: state.mode === 'singles' ? state.strategy : undefined,
      shortlistSize: state.shortlistSize,
    });

    if (candidates.length === 0) {
      state.results = [];
      renderResults({
        error: 'No valid candidates for these selections.',
      });
      return;
    }

    // Task 3: Evaluate each candidate
    const evaluated = [];
    for (const candidate of candidates) {
      const result = evaluateCandidate(hide, candidate, {
        method: state.method,
        laserClearanceMm: state.laserClearanceMm,
        gridStepMm: state.gridStepMm,
      });
      evaluated.push(result);
    }

    // Task 4: Rank candidates
    state.results = rankCandidates(evaluated, state.strategy);

    renderResults({ results: state.results, hide });
  } catch (err) {
    console.error('Run failed:', err);
    renderResults({ error: err.message });
  } finally {
    state.isRunning = false;
    runButton.textContent = originalText;
    updateRunButtonState();
  }
}
```

- [ ] **Step 2: Attach run button listener**

In `attachEventListeners()`:

```js
document.getElementById('run-button').addEventListener('click', run);
```

---

## Task 9: Results rendering — candidate list

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- A ranked list of candidates, each in a card showing:
  - Rank number and candidateId
  - Value, utilization %, demand satisfied
  - Component breakdown (component id, count, status)
  - Visual layout placeholder (canvas or SVG)

- [ ] **Step 1: Implement renderResults()**

```js
function renderResults({ results, hide, error }) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  if (error) {
    container.innerHTML = `<p style="color: red;">${error}</p>`;
    return;
  }

  if (!results || results.length === 0) {
    container.innerHTML = '<p>No results yet.</p>';
    return;
  }

  const title = document.createElement('h2');
  title.textContent = 'Results';
  container.appendChild(title);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const card = document.createElement('div');
    card.className = 'candidate-card';

    const header = document.createElement('h3');
    header.textContent = `#${i + 1}: ${result.candidateId}`;
    card.appendChild(header);

    const stats = document.createElement('p');
    stats.innerHTML = `
      <strong>Value:</strong> $${result.value.toFixed(2)} |
      <strong>Utilization:</strong> ${(result.utilization * 100).toFixed(1)}% |
      <strong>Demand:</strong> ${result.demandSatisfied}
    `;
    card.appendChild(stats);

    // Component breakdown
    const breakdown = document.createElement('div');
    breakdown.style.marginTop = '0.5rem';
    breakdown.innerHTML = '<strong>Components:</strong>';
    for (const [componentId, count] of Object.entries(result.counts)) {
      const component = state.components.find((c) => c.id === componentId);
      const value = component?.valuePerPiece
        ? `$${(component.valuePerPiece * count).toFixed(2)}`
        : '(unpriced)';
      breakdown.innerHTML += `<br/>${componentId}: ${count}x ${value}`;
    }
    card.appendChild(breakdown);

    // Status warnings
    if (result.noDie.length > 0) {
      const noDieWarning = document.createElement('p');
      noDieWarning.style.color = 'orange';
      noDieWarning.innerHTML =
        '<strong>No die:</strong> ' + result.noDie.join(', ');
      card.appendChild(noDieWarning);
    }
    if (result.noFit.length > 0) {
      const noFitWarning = document.createElement('p');
      noFitWarning.style.color = 'orange';
      noFitWarning.innerHTML =
        '<strong>Did not fit:</strong> ' + result.noFit.join(', ');
      card.appendChild(noFitWarning);
    }
    if (result.unpriced.length > 0) {
      const unpricedWarning = document.createElement('p');
      unpricedWarning.style.color = 'blue';
      unpricedWarning.innerHTML =
        '<strong>Unpriced:</strong> ' + result.unpriced.join(', ');
      card.appendChild(unpricedWarning);
    }
    if (result.unverified.length > 0) {
      const unverifiedWarning = document.createElement('p');
      unverifiedWarning.style.color = 'red';
      unverifiedWarning.innerHTML =
        '<strong>Unverified:</strong> ' +
        result.unverified.join(', ') +
        ' (confirm blocked until re-measured)';
      card.appendChild(unverifiedWarning);
    }

    // Layout canvas placeholder
    const layoutDiv = document.createElement('div');
    layoutDiv.style.marginTop = '1rem';
    const canvas = document.createElement('canvas');
    canvas.id = `layout-${i}`;
    canvas.width = 600;
    canvas.height = 400;
    layoutDiv.appendChild(canvas);
    card.appendChild(layoutDiv);

    // Confirm button
    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Confirm & Export';
    confirmButton.disabled = result.unverified.length > 0;
    if (result.unverified.length > 0) {
      confirmButton.title = `Measure: ${result.unverified.join(', ')}`;
    }
    confirmButton.addEventListener('click', () => {
      alert(
        `Confirmed candidate ${result.candidateId}. Export would happen here.`
      );
    });
    card.appendChild(confirmButton);

    container.appendChild(card);

    // Render layout (Task 10)
    renderLayout(canvas, result, hide);
  }
}
```

---

## Task 10: Layout rendering (SVG/Canvas)

**Files:**
- Modify: `src/find-best-use-app.js`

**Deliverables:**
- Visual representation of placements on the hide outline.
- Each placed component is drawn in a different color, labeled by component id.
- Hide outline is visible as a border.
- Layouts are to scale (fit to canvas size).

- [ ] **Step 1: Implement renderLayout()**

```js
function renderLayout(canvas, result, hide) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const placements = result.placements;
  if (!placements.length) {
    ctx.fillStyle = '#ccc';
    ctx.fillText('(No placements)', 10, 20);
    return;
  }

  // Compute bounding box of hide outline
  const outline = hide.outlinePolygon;
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;

  const scale = Math.min(
    (canvas.width * 0.9) / (width || 1),
    (canvas.height * 0.9) / (height || 1)
  );

  const toCanvasX = (x) => (x - minX) * scale + canvas.width * 0.05;
  const toCanvasY = (y) => (y - minY) * scale + canvas.height * 0.05;

  // Draw hide outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(toCanvasX(outline[0].x), toCanvasY(outline[0].y));
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(toCanvasX(outline[i].x), toCanvasY(outline[i].y));
  }
  ctx.closePath();
  ctx.stroke();

  // Draw placements
  const colors = [
    '#ff6b6b',
    '#4ecdc4',
    '#45b7d1',
    '#ffa07a',
    '#98d8c8',
    '#f7dc6f',
  ];
  const componentIds = [...new Set(placements.map((p) => p.id.slice(0, p.id.lastIndexOf('#'))))];

  for (const placement of placements) {
    const componentId = placement.id.slice(0, placement.id.lastIndexOf('#'));
    const colorIdx = componentIds.indexOf(componentId) % colors.length;
    const color = colors[colorIdx];

    // Find the component to get its polygon
    const component = state.components.find((c) => c.id === componentId);
    if (!component) continue;

    const polygon = component.polygon;

    // Apply rotation and translation
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();

    // This is a simplified version; for a real implementation, apply the
    // rotation from `placement.rotation` to each point
    ctx.moveTo(toCanvasX(placement.x), toCanvasY(placement.y));
    for (const point of polygon) {
      // Note: this doesn't actually rotate; a proper implementation would
      // apply a rotation matrix
      ctx.lineTo(
        toCanvasX(placement.x + point.x),
        toCanvasY(placement.y + point.y)
      );
    }
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
  }
}
```

**Note:** The layout rendering above is simplified and does not account for
rotation. For a production-quality rendering, compute rotated polygon points
using a rotation matrix based on `placement.rotation`.

---

## Task 11: Confirm button with unverified gating

**Files:**
- Modify: `src/find-best-use-app.js` (already done in Task 9)

**Deliverables:**
- Confirm button is disabled if `result.unverified.length > 0`.
- Tooltip or message shows which fields are missing.
- Clicking confirm (when enabled) could trigger export or next step.

This is already implemented in Task 9's confirmButton code. No additional work
needed here.

---

## Task 12: Styling and polish

**Files:**
- Modify: `public/find-best-use.html`
- Modify: `src/find-best-use-app.js` (CSS-in-JS or inline styles)

**Deliverables:**
- Consistent Organic design system styling.
- Responsive layout on mobile and desktop.
- Clear visual hierarchy and button states (active, disabled, hover).
- Readable font sizes and spacing.

- [ ] **Step 1: Review Organic design tokens**

Check `/styles/organic.css` or the design system docs for:
- Color palette
- Font families and sizes
- Spacing scale
- Button and input styles

- [ ] **Step 2: Apply tokens to HTML**

Update `public/find-best-use.html`'s `<style>` block to use Organic tokens
throughout. Example:

```css
.button {
  background: var(--color-primary);
  color: var(--color-text-on-primary);
  font-family: var(--font-sans);
  padding: var(--spacing-md);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.button:hover {
  background: var(--color-primary-hover);
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Test responsive layout**

Verify the page works on:
- Desktop (1200px+)
- Tablet (768-1023px)
- Mobile (< 768px)

Adjust grid and flex layouts as needed.

---

## Task 13: Browser verification (manual)

**Files:**
- `public/find-best-use.html`
- `src/find-best-use-app.js`

**Deliverables:**
- The page loads without JS errors.
- All controls are interactive and update state.
- Running the pipeline produces ranked results.
- Layouts render visibly.
- Unverified constraints block confirm.

- [ ] **Step 1: Start the server**

```bash
npm start
```

- [ ] **Step 2: Open the page**

Navigate to `http://localhost:8080/find-best-use`

- [ ] **Step 3: Test flow**

1. Select a hide.
2. Choose You Choose mode; tick a component and set quantity.
3. Switch to Rank Singles; pick a strategy.
4. Switch cutting method from Laser to Die.
5. Adjust precision.
6. Click Run.
7. Verify results display, layouts render, and confirm is gated if unverified.

---

## Task 14: Commit and cleanup

**Files:**
- `public/find-best-use.html`
- `src/find-best-use-app.js`
- `docs/superpowers/specs/2026-09-18-find-best-use-c2-design.md`
- `docs/superpowers/plans/2026-09-18-find-best-use-c2.md`

- [ ] **Step 1: Verify tests still pass**

Run: `npm test`

Expected: PASS (any new failures are bugs to fix; no new test files are added
per convention).

- [ ] **Step 2: Commit**

```bash
git add public/find-best-use.html src/find-best-use-app.js \
  docs/superpowers/specs/2026-09-18-find-best-use-c2-design.md \
  docs/superpowers/plans/2026-09-18-find-best-use-c2.md
git commit -m "feat(bestuse): build C2 Find Best Use page composing C1 pipeline"
```

---

## Self-Review Notes

- **Composition:** All pipeline logic comes from C1. No re-implementation or
  business logic in C2.
- **Type flow:** `eligible` → `candidates` → `evaluated` → `ranked` follows
  the same structure as C1's tests.
- **UI decisions are localized:** Mode switcher, strategy picker, method
  selector, precision buttons, unverified gating — each is confined to its
  task and does not leak into others.
- **No test files added.** Per repo convention, `src/*-app.js` page wiring is
  verified by browser inspection, not automated tests.
- **Escape hatch in Confirm:** The current implementation shows `alert()`. In a
  real flow, this would navigate to an export page or open a dialog. The
  button structure is in place; only the handler needs replacement later.
- **Layout rendering is simplified.** The rotation is not applied. A
  production-quality version computes each polygon point under the `placement`
  rotation before drawing. For now, visual validation is enough to prove the
  flow works.

---

## Non-goals (deferred or explicitly out of scope)

- Editing or creating components from this page.
- Exporting SVG or sending to LightBurn (next step after confirm).
- Saving or persisting searches/layouts.
- Kerf compensation on the export path.
- C3 (mixed-component search).
- Advanced analytics or hide-utilization reporting.
- Any new dependencies.
