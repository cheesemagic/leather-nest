export function attachCalibration(container, imgSrc, onComplete) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';

  const img = document.createElement('img');
  img.src = imgSrc;
  img.style.display = 'block';
  img.style.maxWidth = '100%';

  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.cursor = 'crosshair';

  wrapper.appendChild(img);
  wrapper.appendChild(overlay);
  container.appendChild(wrapper);

  const form = document.createElement('div');
  form.style.marginTop = '8px';
  form.style.display = 'none';
  form.innerHTML = `
    <label>
      Real-world distance between the two points (mm):
      <input type="number" id="real-distance-input" min="0.01" step="any" />
    </label>
    <button type="button" id="calibration-submit">Use this calibration</button>
  `;
  container.appendChild(form);

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

  function resizeOverlay() {
    overlay.width = img.clientWidth;
    overlay.height = img.clientHeight;
    drawMarkers();
  }

  img.addEventListener('load', resizeOverlay);
  window.addEventListener('resize', resizeOverlay);

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
    onComplete({
      p1x: points[0].x,
      p1y: points[0].y,
      p2x: points[1].x,
      p2y: points[1].y,
      realDistanceMm,
    });
  });
}
