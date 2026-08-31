import { attachCalibration } from './calibration-ui.js';
import { boundingBox, polygonToSVGPoints } from './nesting/geometry.js';

const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const resultEl = document.getElementById('result');

let selectedFile = null;

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedFile = file;
  resultEl.textContent = '';

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, async (calibration) => {
    resultEl.textContent = 'Digitizing…';

    const formData = new FormData();
    formData.append('photo', selectedFile);
    formData.append('p1x', calibration.p1x);
    formData.append('p1y', calibration.p1y);
    formData.append('p2x', calibration.p2x);
    formData.append('p2y', calibration.p2y);
    formData.append('realDistanceMm', calibration.realDistanceMm);

    const response = await fetch('/digitize', { method: 'POST', body: formData });
    const body = await response.json();

    if (!response.ok) {
      resultEl.textContent = `Error: ${body.error}`;
      return;
    }

    const bounds = boundingBox(body.polygon);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    resultEl.innerHTML = `
      <p>${width.toFixed(1)}mm &times; ${height.toFixed(1)}mm</p>
      <svg width="300" height="${(300 * height) / width}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
        <polygon points="${polygonToSVGPoints(body.polygon)}" stroke="#FF0000" stroke-width="${width / 300}" fill="none" />
      </svg>
    `;
  });
});
