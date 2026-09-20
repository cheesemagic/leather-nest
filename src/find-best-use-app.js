import { SHORTLIST_SIZE } from './bestuse/candidates.js';
import { componentIdOf } from './bestuse/evaluate.js';
import { RANKING_STRATEGIES } from './bestuse/ranking.js';
import { runSearch, canRun, strategyForMode } from './bestuse/search.js';
import { DEFAULT_KERF_MM } from './nesting/clearance.js';
import { exportToSVG } from './svg/export.js';

const state = {
  hides: [],
  components: [],
  selectedHideId: null,
  mode: 'singles',
  quantities: {},
  strategy: null,
  method: 'laser',
  laserClearanceMm: 1.0,
  kerfMm: DEFAULT_KERF_MM,
  gridStepMm: 5,
  shortlistSize: SHORTLIST_SIZE,
  results: [],
  isRunning: false,
};

// LightBurn reads plain SVG, so the existing exporter is the whole job. The
// file is named after the hide and the rank, so a folder of them stays
// readable once a few have piled up.
function downloadLayout(filename, svgContent) {
  const url = URL.createObjectURL(new Blob([svgContent], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(text) {
  return (
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'layout'
  );
}

// The pipeline speaks component ids; the operator does not. Every id shown
// to a human goes through here.
function componentName(id) {
  return state.components.find((c) => c.id === id)?.name || id;
}

function componentNames(ids) {
  return ids.map(componentName).join(', ');
}

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

    let label = hide.label || hide.id;
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

function renderComponentList() {
  const container = document.getElementById('component-list');
  container.innerHTML = '';

  for (const component of state.components) {
    const div = document.createElement('div');
    div.style.marginBottom = '0.5rem';
    div.style.padding = '0.5rem';
    div.style.background = 'white';
    div.style.borderRadius = '4px';
    div.style.display = 'flex';
    div.style.gap = '0.5rem';
    div.style.alignItems = 'center';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = component.id;
    checkbox.checked = (state.quantities[component.id] ?? 0) > 0;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = state.quantities[component.id] ?? 0;
    input.style.width = '50px';
    input.style.padding = '0.25rem';
    input.style.border = '1px solid #ccc';
    input.style.borderRadius = '4px';

    const label = document.createElement('label');
    label.style.marginLeft = '0.5rem';
    label.style.flex = '1';
    label.textContent = component.name || component.id;

    checkbox.addEventListener('change', () => {
      if (checkbox.checked && input.value === '0') {
        input.value = 1;
      }
      updateQuantity(component.id, parseInt(input.value) || 0);
      updateRunButtonState();
    });

    input.addEventListener('change', () => {
      updateQuantity(component.id, parseInt(input.value) || 0);
      checkbox.checked = (state.quantities[component.id] ?? 0) > 0;
      updateRunButtonState();
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

function updateModeUI() {
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  }

  const sections = {
    explicit: document.getElementById('explicit-section'),
    singles: document.getElementById('singles-section'),
    mix: document.getElementById('mix-section'),
  };
  for (const [mode, section] of Object.entries(sections)) {
    section.style.display = state.mode === mode ? 'block' : 'none';
  }
  if (state.mode === 'explicit') renderComponentList();
}

function updateMethodUI() {
  for (const button of document.querySelectorAll('[data-method]')) {
    button.classList.toggle('active', button.dataset.method === state.method);
  }

  const laserSection = document.getElementById('laser-section');
  laserSection.style.display = state.method === 'laser' ? 'block' : 'none';
}

function updatePrecisionUI() {
  for (const button of document.querySelectorAll('[data-precision]')) {
    button.classList.toggle(
      'active',
      parseInt(button.dataset.precision) === state.gridStepMm
    );
  }
}

function updateRunButtonState() {
  const runButton = document.getElementById('run-button');
  runButton.disabled = !canRun({
    hideId: state.selectedHideId,
    mode: state.mode,
    strategy: state.strategy,
    quantities: state.quantities,
  });
}

async function run() {
  if (state.isRunning) return;
  state.isRunning = true;

  const runButton = document.getElementById('run-button');
  const originalText = runButton.textContent;
  runButton.textContent = 'Running...';
  runButton.disabled = true;

  try {
    const hide = state.hides.find((h) => h.id === state.selectedHideId);
    const { results, error } = runSearch({
      hide,
      components: state.components,
      mode: state.mode,
      strategy: state.strategy,
      quantities: state.quantities,
      shortlistSize: state.shortlistSize,
      method: state.method,
      laserClearanceMm: state.laserClearanceMm,
      kerfMm: state.kerfMm,
      gridStepMm: state.gridStepMm,
    });

    state.results = results;
    renderResults(error ? { error } : { results, hide });
  } catch (err) {
    console.error('Run failed:', err);
    renderResults({ error: err.message });
  } finally {
    state.isRunning = false;
    runButton.textContent = originalText;
    updateRunButtonState();
  }
}

function renderResults({ results, hide, error }) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  if (error) {
    container.innerHTML = `<p style="color: red; padding: 1rem; background: #ffe6e6; border-radius: 4px;">${error}</p>`;
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
    const titleIds = Object.keys(result.counts).length
      ? Object.keys(result.counts)
      : [...result.noDie, ...result.noFit];
    header.textContent = `#${i + 1}: ${componentNames(titleIds) || '(nothing placed)'}`;
    card.appendChild(header);

    const statsDiv = document.createElement('div');
    statsDiv.className = 'candidate-stats';
    statsDiv.innerHTML = `
      <div class="stat">
        <div class="stat-label">Value</div>
        <div class="stat-value">$${result.value.toFixed(2)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Utilization</div>
        <div class="stat-value">${(result.utilization * 100).toFixed(1)}%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Demand</div>
        <div class="stat-value">${result.demandSatisfied}</div>
      </div>
    `;
    card.appendChild(statsDiv);

    // Component breakdown
    const breakdown = document.createElement('div');
    breakdown.className = 'component-breakdown';
    breakdown.innerHTML = '<strong>Components:</strong>';
    for (const [componentId, count] of Object.entries(result.counts)) {
      const component = state.components.find((c) => c.id === componentId);
      const value = component?.valuePerPiece
        ? `$${(component.valuePerPiece * count).toFixed(2)}`
        : '(unpriced)';
      const item = document.createElement('div');
      item.className = 'component-item';
      item.textContent = `${componentName(componentId)}: ${count}x ${value}`;
      breakdown.appendChild(item);
    }
    card.appendChild(breakdown);

    // Status warnings
    if (result.noDie.length > 0) {
      const warning = document.createElement('div');
      warning.className = 'warning no-die';
      warning.innerHTML =
        '<strong>No die available for:</strong> ' + componentNames(result.noDie);
      card.appendChild(warning);
    }
    if (result.noFit.length > 0) {
      const warning = document.createElement('div');
      warning.className = 'warning no-fit';
      warning.innerHTML =
        '<strong>Did not fit:</strong> ' + componentNames(result.noFit);
      card.appendChild(warning);
    }
    if (result.unpriced.length > 0) {
      const warning = document.createElement('div');
      warning.className = 'warning unpriced';
      warning.innerHTML =
        '<strong>Unpriced:</strong> ' + componentNames(result.unpriced);
      card.appendChild(warning);
    }
    if (result.unverified.length > 0) {
      const warning = document.createElement('div');
      warning.className = 'warning unverified';
      warning.innerHTML =
        '<strong>Unverified (confirm blocked):</strong> ' +
        result.unverified.join(', ');
      card.appendChild(warning);
    }

    // Layout canvas
    const layoutDiv = document.createElement('div');
    layoutDiv.id = 'layout-container';
    const canvas = document.createElement('canvas');
    canvas.id = `layout-${i}`;
    canvas.width = 600;
    canvas.height = 400;
    canvas.className = 'layout-canvas';
    layoutDiv.appendChild(canvas);
    card.appendChild(layoutDiv);

    // Confirm button (Task 11 - unverified gating)
    const confirmButton = document.createElement('button');
    confirmButton.className = 'confirm-button';
    confirmButton.textContent = 'Confirm & Export';
    // A candidate where nothing fit still clears the unverified gate, and
    // exporting it would hand the laser an empty file.
    const nothingPlaced = result.placements.length === 0;
    confirmButton.disabled = result.unverified.length > 0 || nothingPlaced;
    if (result.unverified.length > 0) {
      confirmButton.title = `Measure: ${result.unverified.join(', ')} before confirming`;
    } else if (nothingPlaced) {
      confirmButton.title = 'Nothing was placed, so there is nothing to cut.';
    }
    const rank = i + 1;
    confirmButton.addEventListener('click', () => {
      // exportToSVG wants a part per placement id; evaluateCandidate does not
      // return the parts it built, so map each placement back to the polygon
      // it was cut from.
      const parts = result.placements.map((placement) => ({
        id: placement.id,
        polygon: state.components.find((c) => c.id === componentIdOf(placement.id))
          ?.polygon,
      }));
      downloadLayout(
        `${slug(hide.label)}-${rank}.svg`,
        exportToSVG(hide.outlinePolygon, result.placements, parts, {
          method: state.method,
          kerfMm: state.kerfMm,
        })
      );
    });
    card.appendChild(confirmButton);

    container.appendChild(card);

    // Render layout (Task 10)
    renderLayout(canvas, result, hide);
  }
}

function renderLayout(canvas, result, hide) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const placements = result.placements;
  if (!placements.length) {
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.fillText('(No placements)', 20, 30);
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

  // Draw placements with rotation
  const colors = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#ffa07a', '#98d8c8', '#f7dc6f',
  ];
  const componentIds = [
    ...new Set(placements.map((p) => p.id.slice(0, p.id.lastIndexOf('#')))),
  ];

  for (const placement of placements) {
    const componentId = placement.id.slice(0, placement.id.lastIndexOf('#'));
    const colorIdx = componentIds.indexOf(componentId) % colors.length;
    const color = colors[colorIdx];

    const component = state.components.find((c) => c.id === componentId);
    if (!component) continue;

    const polygon = component.polygon;

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();

    // Apply rotation and translation to each point
    const cosR = Math.cos((placement.rotation * Math.PI) / 180);
    const sinR = Math.sin((placement.rotation * Math.PI) / 180);

    for (let j = 0; j < polygon.length; j++) {
      const px = polygon[j].x;
      const py = polygon[j].y;
      const rotatedX = px * cosR - py * sinR;
      const rotatedY = px * sinR + py * cosR;
      const finalX = toCanvasX(placement.x + rotatedX);
      const finalY = toCanvasY(placement.y + rotatedY);

      if (j === 0) {
        ctx.moveTo(finalX, finalY);
      } else {
        ctx.lineTo(finalX, finalY);
      }
    }
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  // Draw legend
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#000';
  let legendY = 15;
  for (const componentId of componentIds) {
    const colorIdx = componentIds.indexOf(componentId) % colors.length;
    ctx.fillStyle = colors[colorIdx];
    ctx.fillRect(canvas.width - 130, legendY, 12, 12);
    ctx.fillStyle = '#000';
    ctx.fillText(componentName(componentId), canvas.width - 110, legendY + 10);
    legendY += 15;
  }
}

function attachEventListeners() {
  // Task 2: Hide select
  document.getElementById('hide-select').addEventListener('change', (e) => {
    state.selectedHideId = e.target.value;
    updateRunButtonState();
  });

  // Task 3: Mode buttons
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', (e) => {
      const newMode = e.target.dataset.mode;
      state.mode = newMode;
      state.quantities = {};
      state.strategy = strategyForMode(newMode);
      const strategySelect = document.getElementById('strategy-select');
      if (strategySelect) strategySelect.value = state.strategy ?? '';
      updateModeUI();
      updateRunButtonState();
    });
  }

  // Task 5: Strategy select
  document.getElementById('strategy-select').addEventListener('change', (e) => {
    state.strategy = e.target.value;
    updateRunButtonState();
  });

  document.getElementById('kerf-mm').addEventListener('change', (e) => {
    const value = parseFloat(e.target.value);
    state.kerfMm = Number.isFinite(value) && value >= 0 ? value : DEFAULT_KERF_MM;
  });

  document.getElementById('shortlist-size').addEventListener('change', (e) => {
    state.shortlistSize = parseInt(e.target.value) || SHORTLIST_SIZE;
  });

  // Task 6: Method buttons
  for (const button of document.querySelectorAll('[data-method]')) {
    button.addEventListener('click', (e) => {
      const newMethod = e.target.dataset.method;
      state.method = newMethod;
      updateMethodUI();
      if (state.results.length > 0) run();
    });
  }

  // Task 6: Laser clearance
  document.getElementById('laser-clearance').addEventListener('change', (e) => {
    state.laserClearanceMm = parseFloat(e.target.value) || 1.0;
    if (state.results.length > 0) run();
  });

  // Task 7: Precision buttons
  for (const button of document.querySelectorAll('[data-precision]')) {
    button.addEventListener('click', (e) => {
      const newPrecision = parseInt(e.target.dataset.precision);
      state.gridStepMm = newPrecision;
      updatePrecisionUI();
      if (state.results.length > 0) run();
    });
  }

  // Task 8: Run button
  document.getElementById('run-button').addEventListener('click', run);
}

async function init() {
  // Fetch hides (skins) and components (dies) from server
  try {
    const skinsResp = await fetch('/skins');
    state.hides = await skinsResp.json();

    const diesResp = await fetch('/dies');
    state.components = await diesResp.json();

    renderHideSelect();
    attachEventListeners();
  } catch (err) {
    console.error('Failed to initialize:', err);
    document.getElementById('results').innerHTML =
      '<p style="color: red;">Failed to load data.</p>';
  }
}

init();
