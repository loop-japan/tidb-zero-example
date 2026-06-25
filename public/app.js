const form = document.querySelector('#connectionForm');
const output = document.querySelector('#jsonOutput');
const statusList = document.querySelector('#statusList');
const statusTemplate = document.querySelector('#statusTemplate');
const envBadge = document.querySelector('#envBadge');
const vectorQuery = document.querySelector('#vectorQuery');
const fullTextQuery = document.querySelector('#fullTextQuery');
const topK = document.querySelector('#topK');
const clearButton = document.querySelector('#clearButton');
const loadDefaultsButton = document.querySelector('#loadDefaultsButton');

const labels = {
  connect: 'Connect / health check',
  initialize: 'Initialize + import',
  'vector-search': 'Vector Search',
  'fulltext-search': 'Full-text Search',
  inspect: 'Inspect table'
};

function formConnection() {
  const data = new FormData(form);
  return {
    host: String(data.get('host') ?? ''),
    port: String(data.get('port') ?? '4000'),
    user: String(data.get('user') ?? ''),
    password: String(data.get('password') ?? ''),
    database: String(data.get('database') ?? ''),
    ssl: data.get('ssl') === 'on'
  };
}

function requestBody(action) {
  const data = new FormData(form);
  return {
    connection: formConnection(),
    reset: data.get('reset') === 'on',
    topK: topK.value,
    vectorQuery: vectorQuery.value,
    fullTextQuery: fullTextQuery.value
  };
}

function markCard(action, state) {
  const card = document.querySelector(`[data-step="${action}"]`);
  if (!card) return;
  card.classList.remove('running', 'success', 'failed');
  if (state) card.classList.add(state);
}

function addStatus(action, state, message) {
  const node = statusTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(state);
  node.querySelector('strong').textContent = labels[action] ?? action;
  node.querySelector('small').textContent = message;
  statusList.prepend(node);
}

function setOutput(value) {
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function loadDefaults() {
  const response = await fetch('/api/defaults');
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.message ?? 'Failed to load defaults');
  const defaults = payload.defaults ?? {};
  for (const [name, value] of Object.entries(defaults)) {
    if (value == null || value === '') continue;
    const field = form.elements.namedItem(name);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value;
  }
  envBadge.textContent = defaults.host ? 'Environment defaults loaded' : 'No TiDB env defaults found';
  vectorQuery.value = payload.dryRun.vectorQuery;
  fullTextQuery.value = payload.dryRun.fullTextQuery;
  setOutput(payload.dryRun);
}

async function runStep(action) {
  if (!form.reportValidity()) return;
  markCard(action, 'running');
  const button = document.querySelector(`[data-action="${action}"]`);
  button.disabled = true;
  button.textContent = '実行中…';
  try {
    const response = await fetch(`/api/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody(action))
    });
    const payload = await response.json();
    if (!payload.ok) throw payload;
    markCard(action, 'success');
    addStatus(action, 'success', 'success');
    setOutput(payload);
  } catch (error) {
    markCard(action, 'failed');
    const message = error?.message ?? 'Request failed';
    addStatus(action, 'failed', message);
    setOutput(error);
  } finally {
    button.disabled = false;
    button.textContent = button.dataset.originalLabel;
  }
}

document.querySelectorAll('[data-action]').forEach((button) => {
  button.dataset.originalLabel = button.textContent;
  button.addEventListener('click', () => runStep(button.dataset.action));
});

clearButton.addEventListener('click', () => {
  statusList.textContent = '';
  setOutput('');
  document.querySelectorAll('.step-card').forEach((card) => card.classList.remove('running', 'success', 'failed'));
});

loadDefaultsButton.addEventListener('click', () => {
  loadDefaults().catch((error) => setOutput({ ok: false, message: error.message }));
});

loadDefaults().catch((error) => {
  envBadge.textContent = 'Defaults failed';
  setOutput({ ok: false, message: error.message });
});
