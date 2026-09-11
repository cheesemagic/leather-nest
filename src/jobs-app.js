const summaryEl = document.getElementById('jobs-summary');
const gridEl = document.getElementById('job-grid');

let jobs = [];
let hidesById = new Map();

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusOf(job) {
  return job.status || 'draft';
}

function hideLabel(job) {
  if (!job.hideId) return '—';
  const hide = hidesById.get(job.hideId);
  return hide ? hide.label : '(deleted hide)';
}

function render() {
  const cutCount = jobs.filter((j) => statusOf(j) === 'cut').length;
  summaryEl.textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'} · ${cutCount} cut`;

  gridEl.innerHTML = jobs
    .map((job) => {
      const status = statusOf(job);
      const isCut = status === 'cut';
      return `
    <div class="card job-card elev-sm">
      <img class="washed" src="/sessions/${job.id}/photo" alt="Job ${escapeHtml(job.id.slice(0, 8))}" />
      <div class="card-title">
        <span>${escapeHtml(hideLabel(job))}</span>
        <span class="tag ${isCut ? 'tag-accent' : 'tag-neutral'}">${status}</span>
      </div>
      <p class="card-body">${job.placements.length} placement${job.placements.length === 1 ? '' : 's'}</p>
      <div class="card-meta">
        started ${new Date(job.createdAt).toLocaleDateString()}${job.cutAt ? ` · cut ${new Date(job.cutAt).toLocaleDateString()}` : ''}
      </div>
      <div class="job-actions">
        <button type="button" class="btn btn-primary" data-status-id="${job.id}" data-next="${isCut ? 'draft' : 'cut'}">
          ${isCut ? 'Un-cut' : 'Mark as cut'}
        </button>
        <button type="button" class="btn btn-secondary" data-delete-id="${job.id}">Delete</button>
      </div>
    </div>
  `;
    })
    .join('');
}

async function load() {
  const [jobsResponse, hidesResponse] = await Promise.all([fetch('/sessions'), fetch('/skins')]);
  jobs = await jobsResponse.json();
  hidesById = new Map((await hidesResponse.json()).map((h) => [h.id, h]));
  render();
}

gridEl.addEventListener('click', async (event) => {
  const statusId = event.target.dataset.statusId;
  if (statusId) {
    const button = event.target;
    button.disabled = true;
    try {
      const response = await fetch(`/sessions/${statusId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: button.dataset.next }),
      });
      const body = await response.json();
      if (!response.ok) {
        summaryEl.textContent = `Error: ${body.error}`;
        button.disabled = false;
        return;
      }
      await load();
    } catch {
      summaryEl.textContent = 'Error: could not reach the server. Please try again.';
      button.disabled = false;
    }
    return;
  }

  const deleteId = event.target.dataset.deleteId;
  if (deleteId) {
    const button = event.target;
    button.disabled = true;
    try {
      const response = await fetch(`/sessions/${deleteId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json();
        summaryEl.textContent = `Error: ${body.error}`;
        button.disabled = false;
        return;
      }
      await load();
    } catch {
      summaryEl.textContent = 'Error: could not reach the server. Please try again.';
      button.disabled = false;
    }
  }
});

load();
