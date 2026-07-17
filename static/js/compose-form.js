// Compose service field-form editor: a structured alternative to the raw
// YAML textarea for the compose subtab. Select a compose file -> pick a
// service -> edit its common fields (image/tag, restart, ports, volumes,
// environment, networks, depends_on, labels) without hand-editing YAML.
// Anything the form doesn't model round-trips through a raw "extras" box
// (see set_service_fields in functions.py for the save-side contract).

let composeFormCurrentService = null;
let composeFormServiceData = null;

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

// --- View switching (Services / Raw YAML tabs) ---

function showComposeServicesView() {
    const servicesView = document.getElementById('compose-services-view');
    const rawView = document.getElementById('compose-raw-view');
    const servicesBtn = document.getElementById('compose-services-tab-btn');
    const rawBtn = document.getElementById('compose-raw-tab-btn');
    const rawSaveBtn = document.getElementById('compose-raw-save-btn');
    if (!servicesView || !rawView) return;

    servicesView.style.display = '';
    rawView.style.display = 'none';
    if (servicesBtn) servicesBtn.classList.add('active');
    if (rawBtn) rawBtn.classList.remove('active');
    if (rawSaveBtn) rawSaveBtn.style.display = 'none';
}

function showComposeRawView() {
    const servicesView = document.getElementById('compose-services-view');
    const rawView = document.getElementById('compose-raw-view');
    const servicesBtn = document.getElementById('compose-services-tab-btn');
    const rawBtn = document.getElementById('compose-raw-tab-btn');
    const rawSaveBtn = document.getElementById('compose-raw-save-btn');
    if (!servicesView || !rawView) return;

    servicesView.style.display = 'none';
    rawView.style.display = '';
    if (servicesBtn) servicesBtn.classList.remove('active');
    if (rawBtn) rawBtn.classList.add('active');
    if (rawSaveBtn) rawSaveBtn.style.display = '';

    if (window.refreshCodeMirrorEditor) {
        setTimeout(() => window.refreshCodeMirrorEditor('compose-editor'), 50);
    }
}

function onComposeFileLoaded() {
    const toggle = document.getElementById('compose-view-toggle');
    if (!currentComposeFile) {
        if (toggle) toggle.style.display = 'none';
        return;
    }
    if (toggle) toggle.style.display = '';
    showComposeServicesView();
    loadComposeServicePicker(currentComposeFile);
}

// Wrap loadCompose (defined in main.js) rather than duplicating file-load
// logic - this covers every path that loads a compose file (direct select,
// scan-then-auto-load of a pending file, the immich fallback path), not just
// the <select> onchange handler.
(function wrapLoadCompose() {
    const original = window.loadCompose;
    if (typeof original !== 'function') return;
    window.loadCompose = async function(...args) {
        const result = await original.apply(this, args);
        onComposeFileLoaded();
        return result;
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    const fileSelect = document.getElementById('compose-files');
    if (fileSelect) {
        fileSelect.addEventListener('change', () => {
            if (!fileSelect.value) {
                const toggle = document.getElementById('compose-view-toggle');
                if (toggle) toggle.style.display = 'none';
                resetComposeServiceForm();
            }
        });
    }
});

// --- Service picker ---

function resetComposeServiceForm() {
    composeFormCurrentService = null;
    composeFormServiceData = null;
    const form = document.getElementById('compose-service-form');
    const picker = document.getElementById('compose-service-picker');
    if (form) {
        form.style.display = 'none';
        form.innerHTML = '';
    }
    if (picker) picker.style.display = '';
}

function loadComposeServicePicker(file, preserveForm = false) {
    if (!preserveForm) resetComposeServiceForm();
    const picker = document.getElementById('compose-service-picker');
    if (!picker) return;
    if (!preserveForm) picker.innerHTML = '<p class="compose-empty-hint">Loading services...</p>';

    fetch(`/api/compose/services?file=${encodeURIComponent(file)}`)
        .then(response => response.json())
        .then(data => {
            if (data.status !== 'success') {
                if (!preserveForm) picker.innerHTML = `<p class="compose-empty-hint">${escapeHtml(data.message || 'Failed to load services')}</p>`;
                return;
            }
            if (!data.services.length) {
                if (!preserveForm) picker.innerHTML = '<p class="compose-empty-hint">No services found in this file.</p>';
                return;
            }
            picker.innerHTML = data.services.map(svc => `
                <button type="button" class="compose-service-card" data-service="${escapeHtml(svc.name)}">
                    <span class="compose-service-card-name">${escapeHtml(svc.name)}</span>
                    <span class="compose-service-card-image">${escapeHtml(svc.image || 'no image set')}</span>
                    <span class="compose-service-card-meta">
                        ${svc.restart ? `<span class="compose-service-badge">${escapeHtml(svc.restart)}</span>` : ''}
                        ${svc.port_count ? `<span class="compose-service-badge">${svc.port_count} port${svc.port_count === 1 ? '' : 's'}</span>` : ''}
                    </span>
                </button>
            `).join('');
            picker.querySelectorAll('.compose-service-card').forEach(card => {
                card.addEventListener('click', () => selectComposeService(file, card.dataset.service));
            });
        })
        .catch(error => {
            console.error('Failed to load compose services:', error);
            picker.innerHTML = '<p class="compose-empty-hint">Failed to load services.</p>';
        });
}

// --- Service field form ---

function splitImageRef(image) {
    if (!image) return { repo: '', tag: '' };
    const lastColon = image.lastIndexOf(':');
    if (lastColon === -1) return { repo: image, tag: '' };
    const tagCandidate = image.slice(lastColon + 1);
    if (tagCandidate.includes('/')) return { repo: image, tag: '' };
    return { repo: image.slice(0, lastColon), tag: tagCandidate };
}

function selectComposeService(file, serviceName) {
    const picker = document.getElementById('compose-service-picker');
    const form = document.getElementById('compose-service-form');
    if (!form) return;
    form.style.display = '';
    form.innerHTML = '<p class="compose-empty-hint">Loading...</p>';

    fetch(`/api/compose/service?file=${encodeURIComponent(file)}&service=${encodeURIComponent(serviceName)}`)
        .then(response => response.json())
        .then(data => {
            if (data.status !== 'success') {
                form.innerHTML = `<p class="compose-empty-hint">${escapeHtml(data.message || 'Failed to load service')}</p>`;
                return;
            }
            composeFormCurrentService = serviceName;
            composeFormServiceData = data;
            if (picker) picker.style.display = 'none';
            renderComposeServiceForm(file, data);
        })
        .catch(error => {
            console.error('Failed to load service fields:', error);
            form.innerHTML = '<p class="compose-empty-hint">Failed to load service.</p>';
        });
}

function backToComposeServiceList() {
    const form = document.getElementById('compose-service-form');
    const picker = document.getElementById('compose-service-picker');
    if (form) { form.style.display = 'none'; form.innerHTML = ''; }
    if (picker) picker.style.display = '';
    composeFormCurrentService = null;
    composeFormServiceData = null;
}

function renderListRows(items, placeholder) {
    const rows = (items && items.length ? items : ['']);
    return rows.map(value => `
        <div class="compose-form-row">
            <input type="text" class="compose-list-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
            <button type="button" class="btn btn-sm btn-secondary" onclick="this.parentElement.remove()">✕</button>
        </div>
    `).join('');
}

function renderKvRows(items, keyPlaceholder, valuePlaceholder) {
    const rows = (items && items.length ? items : ['']);
    return rows.map(item => {
        const eq = item.indexOf('=');
        const key = eq === -1 ? item : item.slice(0, eq);
        const value = eq === -1 ? '' : item.slice(eq + 1);
        return `
        <div class="compose-form-row compose-form-row-kv">
            <input type="text" class="compose-kv-key" value="${escapeHtml(key)}" placeholder="${escapeHtml(keyPlaceholder)}">
            <span class="compose-kv-eq">=</span>
            <input type="text" class="compose-kv-value" value="${escapeHtml(value)}" placeholder="${escapeHtml(valuePlaceholder)}">
            <button type="button" class="btn btn-sm btn-secondary" onclick="this.parentElement.remove()">✕</button>
        </div>
    `;
    }).join('');
}

function addComposeListRow(containerId, placeholder) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.insertAdjacentHTML('beforeend', renderListRows([''], placeholder));
}

function addComposeKvRow(containerId, keyPlaceholder, valuePlaceholder) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.insertAdjacentHTML('beforeend', renderKvRows([''], keyPlaceholder, valuePlaceholder));
}

function collectListValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.compose-list-input'))
        .map(input => input.value.trim())
        .filter(v => v !== '');
}

function collectKvValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.compose-form-row-kv'))
        .map(row => {
            const key = row.querySelector('.compose-kv-key').value.trim();
            const value = row.querySelector('.compose-kv-value').value.trim();
            return key ? `${key}=${value}` : '';
        })
        .filter(v => v !== '');
}

function renderComposeServiceForm(file, data) {
    const form = document.getElementById('compose-service-form');
    if (!form) return;
    const fields = data.fields || {};
    const { repo, tag } = splitImageRef(fields.image || '');

    form.innerHTML = `
        <div class="compose-form-header">
            <button type="button" class="btn btn-sm btn-secondary" onclick="backToComposeServiceList()">← All services</button>
            <h4>${escapeHtml(data.name)}</h4>
        </div>

        <div class="compose-form-field">
            <label>Image</label>
            <div class="compose-form-row">
                <input type="text" id="cf-image-repo" value="${escapeHtml(repo)}" placeholder="e.g. vansmak/episeerr" style="flex: 2;">
                <span class="compose-kv-eq">:</span>
                <input type="text" id="cf-image-tag" value="${escapeHtml(tag)}" placeholder="tag" style="flex: 1;">
            </div>
        </div>

        <div class="compose-form-field-row">
            <div class="compose-form-field">
                <label for="cf-container-name">Container name</label>
                <input type="text" id="cf-container-name" value="${escapeHtml(fields.container_name || '')}">
            </div>
            <div class="compose-form-field">
                <label for="cf-restart">Restart policy</label>
                <input type="text" id="cf-restart" list="cf-restart-options" value="${escapeHtml(fields.restart || '')}">
                <datalist id="cf-restart-options">
                    <option value="no">
                    <option value="always">
                    <option value="on-failure">
                    <option value="unless-stopped">
                </datalist>
            </div>
        </div>

        <div class="compose-form-field">
            <label>Ports <span class="compose-form-hint">host:container</span></label>
            <div id="cf-ports" class="compose-form-list">${renderListRows(fields.ports, '8080:80')}</div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addComposeListRow('cf-ports', '8080:80')">+ Add port</button>
        </div>

        <div class="compose-form-field">
            <label>Volumes <span class="compose-form-hint">host:container</span></label>
            <div id="cf-volumes" class="compose-form-list">${renderListRows(fields.volumes, './data:/data')}</div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addComposeListRow('cf-volumes', './data:/data')">+ Add volume</button>
        </div>

        <div class="compose-form-field">
            <label>Environment</label>
            <div id="cf-environment" class="compose-form-list">${renderKvRows(fields.environment, 'KEY', 'value')}</div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addComposeKvRow('cf-environment', 'KEY', 'value')">+ Add variable</button>
        </div>

        <div class="compose-form-field">
            <label>Networks</label>
            <div id="cf-networks" class="compose-form-list">${renderListRows(fields.networks, 'network name')}</div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addComposeListRow('cf-networks', 'network name')">+ Add network</button>
        </div>

        <div class="compose-form-field">
            <label>Depends on</label>
            <div id="cf-depends_on" class="compose-form-list">${renderListRows(fields.depends_on, 'service name')}</div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addComposeListRow('cf-depends_on', 'service name')">+ Add dependency</button>
        </div>

        <div class="compose-form-field">
            <label>Labels</label>
            <div id="cf-labels" class="compose-form-list">${renderKvRows(fields.labels, 'key', 'value')}</div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addComposeKvRow('cf-labels', 'key', 'value')">+ Add label</button>
        </div>

        <div class="compose-form-field">
            <label for="cf-extras">Other settings <span class="compose-form-hint">raw YAML - anything not covered above (healthcheck, deploy, etc.)</span></label>
            <textarea id="cf-extras" class="compose-extras-textarea" spellcheck="false">${escapeHtml(data.extras_yaml || '')}</textarea>
        </div>

        <div class="compose-form-actions">
            <button type="button" id="compose-save-service-btn" class="btn btn-primary">Save service</button>
            <button type="button" id="compose-save-deploy-service-btn" class="btn btn-success">Save &amp; Deploy 🚀</button>
        </div>
    `;

    document.getElementById('compose-save-service-btn').addEventListener('click', () => saveComposeServiceForm(file, false));
    document.getElementById('compose-save-deploy-service-btn').addEventListener('click', () => saveComposeServiceForm(file, true));
}

// Keeps the raw YAML tab's CodeMirror instance in sync after a form save -
// otherwise it silently shows pre-save content until the page is reloaded,
// since the raw editor only fetches file content when a file is first
// selected, not on every subsequent form save.
function refreshComposeRawEditor(file) {
    fetch(`/api/compose?file=${encodeURIComponent(file)}`)
        .then(response => response.json())
        .then(result => {
            if (result.content !== undefined && window.updateCodeMirrorContent) {
                window.updateCodeMirrorContent('compose-editor', result.content);
            }
        })
        .catch(error => console.error('Failed to refresh raw editor:', error));
}

// Recreates just this one service (not the whole stack) after a form save,
// pulling the image first only if the form actually changed it - a plain
// 'up -d' won't refresh an already-present local tag (e.g. :latest pointing
// at newer upstream content), so a tag change needs an explicit pull to take
// effect, but every other field change just needs a recreate.
function redeployComposeService(file, service, pull) {
    const hostSelect = document.getElementById('compose-host-select');
    const host = hostSelect ? hostSelect.value : 'local';
    setLoading(true, `${pull ? 'Pulling and redeploying' : 'Redeploying'} ${service}...`);
    fetch('/api/service/redeploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, service, pull, host }),
    })
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                showMessage('success', data.message || `${service} redeployed`);
                if (typeof refreshContainers === 'function') refreshContainers();
            } else {
                showMessage('error', data.message || `Failed to redeploy ${service}`);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to redeploy service:', error);
            showMessage('error', `Failed to redeploy ${service}`);
        });
}

function saveComposeServiceForm(file, deployAfter = false) {
    if (!composeFormCurrentService || !composeFormServiceData) return;

    const originalImage = composeFormServiceData.fields.image || '';
    const repo = document.getElementById('cf-image-repo').value.trim();
    const tag = document.getElementById('cf-image-tag').value.trim();
    const image = tag ? `${repo}:${tag}` : repo;
    const imageChanged = image !== originalImage;

    const fields = {
        image: image,
        container_name: document.getElementById('cf-container-name').value.trim(),
        restart: document.getElementById('cf-restart').value.trim(),
        ports: collectListValues('cf-ports'),
        volumes: collectListValues('cf-volumes'),
        environment: collectKvValues('cf-environment'),
        networks: collectListValues('cf-networks'),
        depends_on: collectListValues('cf-depends_on'),
        labels: collectKvValues('cf-labels'),
    };
    const extrasYaml = document.getElementById('cf-extras').value;
    const style = composeFormServiceData.style || {};

    setLoading(true, `Saving ${composeFormCurrentService}...`);
    fetch('/api/compose/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            file: file,
            service: composeFormCurrentService,
            fields: fields,
            style: style,
            extras_yaml: extrasYaml,
        }),
    })
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                const serviceName = composeFormCurrentService;
                showMessage('success', `Saved ${serviceName}`);
                refreshComposeRawEditor(file);
                selectComposeService(file, serviceName);
                loadComposeServicePicker(file, true);
                if (deployAfter) {
                    redeployComposeService(file, serviceName, imageChanged);
                }
            } else {
                showMessage('error', data.message || 'Failed to save service');
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to save service:', error);
            showMessage('error', 'Failed to save service');
        });
}
