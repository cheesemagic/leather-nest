const summaryEl = document.getElementById('products-summary');
const gridEl = document.getElementById('product-grid');
const openAddButton = document.getElementById('open-add-product');
const cancelAddButton = document.getElementById('cancel-add');
const submitButton = document.getElementById('submit-product');
const addPanel = document.getElementById('add-panel');
const nameInput = document.getElementById('name-input');
const demandInput = document.getElementById('demand-input');
const partPickerEl = document.getElementById('part-picker');
const addStatus = document.getElementById('add-status');

let products = [];
let parts = [];
// partId -> quantity, for parts currently checked in the add form.
let selectedParts = {};

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function partName(id) {
  return parts.find((p) => p.id === id)?.name || id;
}

function resetAddForm() {
  nameInput.value = '';
  demandInput.value = '0';
  selectedParts = {};
  addStatus.textContent = '';
  renderPartPicker();
}

function renderPartPicker() {
  partPickerEl.innerHTML = '';
  for (const part of parts) {
    const row = document.createElement('div');
    row.className = 'part-picker-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = part.id in selectedParts;

    const label = document.createElement('label');
    label.textContent = part.name || part.id;

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.step = '1';
    qty.value = selectedParts[part.id] ?? 1;
    qty.disabled = !checkbox.checked;

    checkbox.addEventListener('change', () => {
      qty.disabled = !checkbox.checked;
      if (checkbox.checked) {
        selectedParts[part.id] = parseInt(qty.value, 10) || 1;
      } else {
        delete selectedParts[part.id];
      }
    });
    qty.addEventListener('change', () => {
      const value = parseInt(qty.value, 10);
      qty.value = Number.isInteger(value) && value > 0 ? value : 1;
      if (checkbox.checked) selectedParts[part.id] = parseInt(qty.value, 10);
    });

    row.appendChild(checkbox);
    row.appendChild(label);
    row.appendChild(qty);
    partPickerEl.appendChild(row);
  }
}

openAddButton.addEventListener('click', () => {
  addPanel.hidden = false;
});

cancelAddButton.addEventListener('click', () => {
  addPanel.hidden = true;
  resetAddForm();
});

submitButton.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const partEntries = Object.entries(selectedParts);

  if (!name || partEntries.length === 0) {
    addStatus.textContent = 'Name and at least one part are required.';
    return;
  }

  addStatus.textContent = 'Adding…';

  try {
    const response = await fetch('/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        parts: partEntries.map(([partId, quantity]) => ({ partId, quantity })),
        demand: parseInt(demandInput.value, 10) || 0,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    addPanel.hidden = true;
    resetAddForm();
    await loadProducts();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

function renderSummary() {
  summaryEl.textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
}

function renderGrid() {
  gridEl.innerHTML = products
    .map((product) => {
      const partLines = product.parts
        .map((p) => `<li>${p.quantity}x ${escapeHtml(partName(p.partId))}</li>`)
        .join('');
      return `
    <div class="card product-card elev-sm">
      <div class="card-title">
        <span>${escapeHtml(product.name)}${product.demand > 0 ? ` <span class="tag tag-accent">need ${product.demand}</span>` : ''}</span>
        <span class="tag tag-outline">${product.id.slice(0, 8)}</span>
      </div>
      <ul class="product-parts">${partLines}</ul>
      <div class="product-actions">
        <button type="button" class="btn btn-secondary" data-delete="${product.id}">Delete</button>
      </div>
    </div>
  `;
    })
    .join('');
}

gridEl.addEventListener('click', async (event) => {
  const id = event.target.dataset.delete;
  if (!id) return;
  await fetch(`/products/${id}`, { method: 'DELETE' });
  await loadProducts();
});

async function loadProducts() {
  const response = await fetch('/products');
  products = await response.json();
  renderSummary();
  renderGrid();
}

async function init() {
  try {
    const partsResp = await fetch('/parts');
    parts = await partsResp.json();
    renderPartPicker();
    await loadProducts();
  } catch (err) {
    console.error('Failed to initialize:', err);
    gridEl.innerHTML = '<p style="color: red;">Failed to load data.</p>';
  }
}

init();
