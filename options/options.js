import { getRokus, saveRokus, validateRoku, YOUTUBE_ORIGINS } from '../lib/storage.js';
import { testRoku } from '../lib/roku.js';
import { testLabel } from '../lib/messages.js';

const list = document.getElementById('roku-list');
const empty = document.getElementById('empty');
const form = document.getElementById('roku-form');
const formTitle = document.getElementById('form-title');
const idInput = document.getElementById('roku-id');
const nameInput = document.getElementById('roku-name');
const hostInput = document.getElementById('roku-host');
const formError = document.getElementById('form-error');
const cancelEdit = document.getElementById('cancel-edit');
const youtubeNotice = document.getElementById('youtube-notice');
const youtubeGrant = document.getElementById('youtube-grant');

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function button(label, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function rowFor(roku) {
  const status = cell('', 'status');
  const actions = cell('', 'actions');
  actions.append(
    button('Test', async () => {
      status.textContent = 'Testing…';
      status.textContent = testLabel(await testRoku(roku.host, (...args) => fetch(...args)));
    }),
    button('Edit', () => {
      idInput.value = roku.id;
      nameInput.value = roku.name;
      hostInput.value = roku.host;
      formTitle.textContent = `Edit ${roku.name}`;
      cancelEdit.hidden = false;
      nameInput.focus();
    }),
    button('Remove', async () => {
      await saveRokus((await getRokus()).filter((r) => r.id !== roku.id));
      if (idInput.value === roku.id) resetForm();
      await render();
    }),
  );
  const tr = document.createElement('tr');
  tr.append(cell(roku.name), cell(roku.host), status, actions);
  return tr;
}

async function render() {
  const rokus = await getRokus();
  list.replaceChildren(...rokus.map(rowFor));
  empty.hidden = rokus.length > 0;
}

function resetForm() {
  form.reset();
  idInput.value = '';
  formTitle.textContent = 'Add a Roku';
  formError.textContent = '';
  cancelEdit.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  const result = validateRoku({ name: nameInput.value, host: hostInput.value });
  if (!result.ok) {
    formError.textContent = result.error;
    return;
  }
  // permissions.request must be the first await so it still counts as a user action.
  let granted;
  try {
    granted = await browser.permissions.request({ origins: [`http://${result.value.host}/*`] });
  } catch {
    formError.textContent = "That doesn't look like a valid IP address or hostname.";
    return;
  }
  if (!granted) {
    formError.textContent = 'Firefox needs permission to talk to this Roku. Click Save again and choose Allow.';
    return;
  }
  const rokus = await getRokus();
  const editingId = idInput.value;
  const next = editingId
    ? rokus.map((r) => (r.id === editingId ? { ...r, ...result.value } : r))
    : [...rokus, { id: crypto.randomUUID(), ...result.value }];
  await saveRokus(next);
  resetForm();
  await render();
});

cancelEdit.addEventListener('click', resetForm);

async function refreshYouTubeNotice() {
  youtubeNotice.hidden = await browser.permissions.contains({ origins: YOUTUBE_ORIGINS });
}

youtubeGrant.addEventListener('click', async () => {
  await browser.permissions.request({ origins: YOUTUBE_ORIGINS });
  await refreshYouTubeNotice();
});

render();
refreshYouTubeNotice();
