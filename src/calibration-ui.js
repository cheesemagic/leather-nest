import { attachImageOverlay } from './image-overlay.js';

// A saved calibration is only valid for a photo taken with the exact same
// framing it was captured on -- p1x/p1y are pixel positions, and a photo of
// different dimensions (different phone, different zoom, different crop)
// would silently point them at the wrong spot. Checked against the new
// photo's own pixel size before it's ever offered as a shortcut.
async function fetchSavedCalibrations() {
  try {
    const response = await fetch('/calibrations');
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

function saveCalibration(calibration, name, photoWidth, photoHeight) {
  return fetch('/calibrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...calibration, name, photoWidth, photoHeight }),
  }).catch(() => {});
}

export function attachCalibration(container, imgSrc, onComplete) {
  const { img, overlay } = attachImageOverlay(container, imgSrc, () => drawMarkers());

  // attachImageOverlay wipes the container before building the image/overlay,
  // so this has to be inserted after that call, not before it.
  const savedSection = document.createElement('div');
  savedSection.style.marginBottom = '8px';
  savedSection.innerHTML = `
    <label>
      Saved calibration:
      <select id="saved-calibration-select"><option value="">-- Calibrate manually below --</option></select>
    </label>
    <div id="saved-calibration-status" style="font-size: 0.85em;"></div>
  `;
  container.insertBefore(savedSection, container.firstChild);
  const savedSelect = savedSection.querySelector('#saved-calibration-select');
  const savedStatus = savedSection.querySelector('#saved-calibration-status');

  fetchSavedCalibrations().then((saved) => {
    for (const calibration of saved) {
      const option = document.createElement('option');
      option.value = calibration.id;
      option.textContent = calibration.name;
      savedSelect.appendChild(option);
    }

    savedSelect.addEventListener('change', () => {
      savedStatus.textContent = '';
      const calibration = saved.find((c) => c.id === savedSelect.value);
      if (!calibration) return;

      if (calibration.photoWidth !== img.naturalWidth || calibration.photoHeight !== img.naturalHeight) {
        savedStatus.textContent =
          `This photo is ${img.naturalWidth}x${img.naturalHeight}px; "${calibration.name}" was captured ` +
          `at ${calibration.photoWidth}x${calibration.photoHeight}px, so it would point at the wrong spot. ` +
          `Calibrate manually below instead.`;
        savedSelect.value = '';
        return;
      }

      onComplete({
        p1x: calibration.p1x,
        p1y: calibration.p1y,
        p2x: calibration.p2x,
        p2y: calibration.p2y,
        realDistanceMm: calibration.realDistanceMm,
      });
    });
  });

  const form = document.createElement('div');
  form.style.marginTop = '8px';
  form.style.display = 'none';
  form.innerHTML = `
    <label>
      Real-world distance between the two points (mm):
      <input type="number" id="real-distance-input" min="0.01" step="any" />
    </label>
    <button type="button" id="calibration-submit">Use this calibration</button>
    <div style="margin-top: 4px;">
      <label><input type="checkbox" id="save-calibration-checkbox" /> Save this calibration to reuse on future photos from this same setup</label>
      <input type="text" id="save-calibration-name" placeholder="Name this setup (e.g. desk rig)" style="display: none;" />
    </div>
  `;
  container.appendChild(form);

  const saveCheckbox = form.querySelector('#save-calibration-checkbox');
  const saveNameInput = form.querySelector('#save-calibration-name');
  saveCheckbox.addEventListener('change', () => {
    saveNameInput.style.display = saveCheckbox.checked ? 'inline-block' : 'none';
  });

  let points = [];

  function drawMarkers() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const scaleX = overlay.width / img.naturalWidth;
    const scaleY = overlay.height / img.naturalHeight;
    ctx.fillStyle = '#FF3B30';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * scaleX, p.y * scaleY, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (points.length === 2) {
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
      ctx.lineTo(points[1].x * scaleX, points[1].y * scaleY);
      ctx.stroke();
    }
  }

  overlay.addEventListener('click', (event) => {
    if (points.length >= 2) {
      points = [];
      form.style.display = 'none';
    }

    const rect = overlay.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const naturalX = (displayX / overlay.width) * img.naturalWidth;
    const naturalY = (displayY / overlay.height) * img.naturalHeight;

    points.push({ x: naturalX, y: naturalY });
    drawMarkers();

    if (points.length === 2) {
      form.style.display = 'block';
    }
  });

  form.querySelector('#calibration-submit').addEventListener('click', () => {
    const realDistanceMm = Number(form.querySelector('#real-distance-input').value);
    if (points.length !== 2 || !(realDistanceMm > 0)) {
      return;
    }
    const calibration = {
      p1x: points[0].x,
      p1y: points[0].y,
      p2x: points[1].x,
      p2y: points[1].y,
      realDistanceMm,
    };

    if (saveCheckbox.checked && saveNameInput.value.trim()) {
      saveCalibration(calibration, saveNameInput.value.trim(), img.naturalWidth, img.naturalHeight);
    }

    onComplete(calibration);
  });
}
