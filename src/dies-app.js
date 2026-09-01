import { attachCalibration } from './calibration-ui.js';
import { boundingBox, polygonToSVGPoints } from './nesting/geometry.js';

const nameInput = document.getElementById('name-input');
const modeRadios = document.querySelectorAll('input[name="add-mode"]');
const svgMode = document.getElementById('svg-mode');
const photoMode = document.getElementById('photo-mode');
const svgInput = document.getElementById('svg-input');
const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const submitButton = document.getElementById('submit-die');
const addStatus = document.getElementById('add-status');
const diesListEl = document.getElementById('dies-list');

let selectedPhoto = null;
let calibration = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

for (const radio of modeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    svgMode.style.display = radio.value === 'svg' ? 'block' : 'none';
    photoMode.style.display = radio.value === 'photo' ? 'block' : 'none';
  });
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedPhoto = file;
  calibration = null;

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, (result) => {
    calibration = result;
  });
});

submitButton.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) {
    addStatus.textContent = 'Name is required.';
    return;
  }

  const mode = document.querySelector('input[name="add-mode"]:checked').value;
  const formData = new FormData();
  formData.append('name', name);

  if (mode === 'svg') {
    const file = svgInput.files[0];
    if (!file) {
      addStatus.textContent = 'Choose an SVG file.';
      return;
    }
    formData.append('svg', file);
  } else {
    if (!selectedPhoto || !calibration) {
      addStatus.textContent = 'Upload a photo and complete calibration first.';
      return;
    }
    formData.append('photo', selectedPhoto);
    formData.append('p1x', calibration.p1x);
    formData.append('p1y', calibration.p1y);
    formData.append('p2x', calibration.p2x);
    formData.append('p2y', calibration.p2y);
    formData.append('realDistanceMm', calibration.realDistanceMm);
  }

  addStatus.textContent = 'Adding…';

  try {
    const response = await fetch('/dies', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    addStatus.textContent = `Added "${body.name}".`;
    nameInput.value = '';
    svgInput.value = '';
    photoInput.value = '';
    calibrationContainer.innerHTML = '';
    selectedPhoto = null;
    calibration = null;
    loadDies();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

async function loadDies() {
  const response = await fetch('/dies');
  const dies = await response.json();
  diesListEl.innerHTML = dies
    .map((die) => {
      const bounds = boundingBox(die.polygon);
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      return `
    <div>
      <svg width="80" height="${(80 * height) / width}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
        <polygon points="${polygonToSVGPoints(die.polygon)}" stroke="#FF0000" stroke-width="${width / 80}" fill="none" />
      </svg>
      <strong>${escapeHtml(die.name)}</strong>
      <button type="button" data-delete-id="${die.id}">Delete</button>
    </div>
  `;
    })
    .join('');
}

diesListEl.addEventListener('click', async (event) => {
  const id = event.target.dataset.deleteId;
  if (!id) return;
  await fetch(`/dies/${id}`, { method: 'DELETE' });
  loadDies();
});

document.getElementById('refresh-dies').addEventListener('click', loadDies);

loadDies();
