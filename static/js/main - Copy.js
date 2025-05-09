window.addEventListener('load', function() {
    // This is a fallback in case DOMContentLoaded doesn't work properly
    console.log("Window load event triggered");
    if (document.getElementById('containers-list').innerHTML === '') {
        console.log("Container list is empty, refreshing...");
        refreshContainers();
    }
});

// Global variables
let currentComposeFile = '';
let currentEnvFile = '';
let currentCaddyFile = '';
let refreshTimer = null;

// Theme handling
function setTheme(theme) {
    console.log(`Setting theme to: ${theme}`);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    const themeSelector = document.getElementById('theme-selector');
    const themeSelectorMobile = document.getElementById('theme-selector-mobile');
    
    if (themeSelector) themeSelector.value = theme;
    if (themeSelectorMobile) themeSelectorMobile.value = theme;
    
    // Force a repaint to apply the theme
    document.body.style.display = 'none';
    document.body.offsetHeight; // This triggers a reflow
    document.body.style.display = '';
    
    console.log(`Theme set to: ${theme}`);
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'refined-dark';
    setTheme(savedTheme);
}

// UI helpers
function toggleFilterMenu() {
    const menu = document.getElementById('filter-menu');
    menu.classList.toggle('active');
    console.log('Toggle filter menu'); // Add this line for debugging

}

function toggleStats() {
    const stats = document.querySelector('.system-stats');
    stats.classList.toggle('expanded');
}

function syncFilters(sourceId, targetId) {
    const source = document.getElementById(sourceId);
    const target = document.getElementById(targetId);
    target.value = source.value;
}

function showMessage(type, text) {
    const message = document.getElementById('message');
    message.className = `message ${type}`;
    message.textContent = text;
    message.style.display = 'block';
    setTimeout(() => message.style.display = 'none', 3000);
}

function setLoading(isLoading, message = 'Loading...') {
    let spinner = document.getElementById('loading-spinner');
    if (!spinner && isLoading) {
        spinner = document.createElement('div');
        spinner.id = 'loading-spinner';
        spinner.className = 'loading-spinner';
        spinner.innerHTML = message;
        document.querySelector('.container').appendChild(spinner);
    } else if (spinner && !isLoading) {
        spinner.remove();
    }
}

// Tab switching
function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    if (tabName === 'containers') {
        refreshContainers();
    } else if (tabName === 'config') {
        switchSubTab('compose');
    } else if (tabName === 'images') {
        loadImages();
    }
    
    if (document.getElementById('batch-actions')) {
        document.getElementById('batch-actions').classList.toggle('visible', 
            tabName === 'containers' && document.getElementById('containers-list').classList.contains('batch-mode'));
    }
}

function switchSubTab(subtabName) {
    document.querySelectorAll('.subtab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.subtab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`.subtab[onclick="switchSubTab('${subtabName}')"]`).classList.add('active');
    document.getElementById(`${subtabName}-subtab`).classList.add('active');
    
    if (subtabName === 'compose') {
        loadComposeFiles();
    } else if (subtabName === 'env') {
        scanEnvFiles();
    } else if (subtabName === 'caddy') {
        loadCaddyFile();
    }
}

// System Stats
function loadSystemStats() {
    fetch('/api/system')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                document.getElementById('total-containers').textContent = data.total_containers || '--';
                document.getElementById('total-containers-grid').textContent = data.total_containers || '--';
                document.getElementById('running-containers').textContent = data.running_containers || '--';
                document.getElementById('cpu-count').textContent = data.cpu_count || '--';
                document.getElementById('cpu-count-grid').textContent = data.cpu_count || '--';
                document.getElementById('memory-usage').textContent = data.memory_used || '--';
                document.getElementById('memory-usage-grid').textContent = data.memory_used || '--';
                document.getElementById('memory-total').textContent = data.memory_total || '--';
                document.getElementById('memory-total-grid').textContent = data.memory_total || '--';
                document.getElementById('memory-progress').style.width = `${data.memory_percent || 0}%`;
            } else {
                console.error('System stats error:', data.message);
                showMessage('error', data.message || 'Failed to load system stats');
            }
        })
        .catch(error => {
            console.error('Failed to load system stats:', error);
            showMessage('error', 'Failed to load system stats');
        });
}

// Container functionality
function startStatsUpdater() {
    console.log("Starting stats updater...");
    
    setInterval(() => {
        if (document.getElementById('loading-spinner')) {
            return;
        }
        
        fetch('/api/containers?nocache=' + Date.now())
            .then(response => response.json())
            .then(containers => {
                containers.forEach(container => {
                    const card = document.querySelector(`[data-id="${container.id}"]`);
                    if (card) {
                        if (container.cpu_percent > 0) {
                            card.dataset.cpu = container.cpu_percent;
                        }
                        if (container.memory_usage > 0) {
                            card.dataset.memory = container.memory_usage;
                        }
                        
                        const statsEl = card.querySelector('.container-stats');
                        if (statsEl) {
                            statsEl.textContent = `CPU: ${card.dataset.cpu}% | Memory: ${card.dataset.memory} MB`;
                        }
                        
                        const popupCpu = document.getElementById(`popup-cpu-${container.id}`);
                        const popupMemory = document.getElementById(`popup-memory-${container.id}`);
                        
                        if (popupCpu) popupCpu.textContent = card.dataset.cpu;
                        if (popupMemory) popupMemory.textContent = card.dataset.memory;
                    }
                });
            })
            .catch(error => {
                console.error('Stats update failed:', error);
            });
    }, 5000);
}

function updateTagFilterOptions(tags) {
    const tagFilter = document.getElementById('tag-filter');
    const tagFilterMobile = document.getElementById('tag-filter-mobile');
    const currentValue = tagFilter.value || tagFilterMobile.value;
    
    tagFilter.innerHTML = '<option value="">All Tags</option>';
    tagFilterMobile.innerHTML = '<option value="">All Tags</option>';
    
    const tagFiltersArea = document.getElementById('tag-filters');
    if (tagFiltersArea) {
        tagFiltersArea.innerHTML = '';
    }
    
    tags.sort().forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        if (tag === currentValue) {
            option.selected = true;
        }
        tagFilter.appendChild(option);
        
        const optionMobile = document.createElement('option');
        optionMobile.value = tag;
        optionMobile.textContent = tag;
        if (tag === currentValue) {
            optionMobile.selected = true;
        }
        tagFilterMobile.appendChild(optionMobile);
    });
}

function filterByTag(tag) {
    document.getElementById('tag-filter').value = tag;
    document.getElementById('tag-filter-mobile').value = tag;
    refreshContainers();
}

function renderContainers(containers) {
    const list = document.getElementById('containers-list');
    const noContainers = document.getElementById('no-containers');
    const isBatchMode = list.classList.contains('batch-mode');
    const tagFilter = document.getElementById('tag-filter').value || document.getElementById('tag-filter-mobile').value;
    const stackFilter = document.getElementById('stack-filter').value || document.getElementById('stack-filter-mobile').value;
    const group = document.getElementById('group-filter').value || document.getElementById('group-filter-mobile').value || 'none';
    const sort = document.getElementById('sort-filter').value || document.getElementById('sort-filter-mobile').value || 'name';
    
    list.innerHTML = '';
    
    if (!Array.isArray(containers) || !containers.length) {
        noContainers.style.display = 'block';
        return;
    }
    
    noContainers.style.display = 'none';
    
    let allTags = new Set();
    let allStacks = new Set();
    let filteredContainers = [...containers]; // Create a copy to filter
    
    // Apply filters
    if (tagFilter) {
        filteredContainers = filteredContainers.filter(container => 
            container.tags && container.tags.includes(tagFilter));
    }
    
    if (stackFilter) {
        filteredContainers = filteredContainers.filter(container => 
            extractStackName(container) === stackFilter);
    }
    
    // Collect all tags and stacks for the filter dropdowns
    filteredContainers.forEach(container => {
        if (container.tags && Array.isArray(container.tags)) {
            container.tags.forEach(tag => allTags.add(tag));
        }
        allStacks.add(extractStackName(container));
    });
    
    // Choose rendering method based on grouping
    if (group === 'stack') {
        renderContainersByStack(filteredContainers);
        return;
    } else if (group === 'tag' || sort === 'tag') {
        renderContainersByTag(filteredContainers);
        return;
    }
    
    // Sort containers
    if (sort === 'name') {
        filteredContainers.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'cpu') {
        filteredContainers.sort((a, b) => (b.cpu_percent || 0) - (a.cpu_percent || 0));
    } else if (sort === 'memory') {
        filteredContainers.sort((a, b) => (b.memory_usage || 0) - (a.memory_usage || 0));
    } else if (sort === 'uptime') {
        filteredContainers.sort((a, b) => {
            const aMinutes = a.uptime ? a.uptime.minutes : 0;
            const bMinutes = b.uptime ? b.uptime.minutes : 0;
            return bMinutes - aMinutes;
        });
    }
    
    // Render containers
    filteredContainers.forEach(container => {
        renderSingleContainer(container, list);
    });
    
    // Update filter options
    updateTagFilterOptions(Array.from(allTags));
    updateStackFilterOptions(Array.from(allStacks));
}

function renderContainersByTag(containers) {
    const list = document.getElementById('containers-list');
    const noContainers = document.getElementById('no-containers');
    
    list.innerHTML = '';
    list.className = 'container-grid';
    
    if (!Array.isArray(containers) || !containers.length) {
        noContainers.style.display = 'block';
        return;
    }
    
    noContainers.style.display = 'none';
    
    let allTags = new Set();
    
    containers.sort((a, b) => {
        const tagA = a.tags && a.tags.length ? a.tags[0] : '';
        const tagB = b.tags && b.tags.length ? b.tags[0] : '';
        return tagA.localeCompare(tagB) || a.name.localeCompare(b.name);
    });
    
    containers.forEach(container => {
        if (container.tags && Array.isArray(container.tags)) {
            container.tags.forEach(tag => allTags.add(tag));
        }
        renderSingleContainer(container, list);
    });
    
    updateTagFilterOptions(Array.from(allTags));
}

function renderSingleContainer(container, parentElement) {
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    const card = document.createElement('div');
    card.className = 'container-card';
    card.dataset.id = container.id;
    card.dataset.cpu = container.cpu_percent;
    card.dataset.memory = container.memory_usage;
    const uptimeDisplay = container.uptime && container.uptime.display ? container.uptime.display : 'N/A';
    const uptimeLong = uptimeDisplay.includes('d') ? 'uptime-long' : '';
    
    // Create tags HTML
    let tagsHtml = '';
    if (container.tags && container.tags.length) {
        tagsHtml = '<div class="container-tags">';
        container.tags.forEach(tag => {
            tagsHtml += `<span class="tag-badge" onclick="filterByTag('${tag}')">${tag}</span>`;
        });
        tagsHtml += '</div>';
    } else {
        tagsHtml = '<div class="container-tags"></div>';
    }
    
    card.innerHTML = `
        <div class="container-header">
            <span class="container-name" onclick="openCustomContainerURL('${container.id}')" title="${container.name}">${container.name}</span>
            <div class="container-header-right">
                <span class="container-status status-${container.status === 'running' ? 'running' : 'stopped'}">${container.status}</span>
                <span class="uptime-badge ${uptimeLong}">${uptimeDisplay}</span>
                <button class="btn btn-primary" style="padding: 2px 5px; font-size: 10px; min-width: auto;" onclick="showContainerPopup('${container.id}', '${container.name}')">⋮</button>
            </div>
        </div>
        <div class="container-body">
            ${tagsHtml}
            <div class="container-stats">
                CPU: ${container.cpu_percent}% | Memory: ${container.memory_usage} MB
            </div>
            <div class="actions">
                <button class="btn btn-success" onclick="containerAction('${container.id}', 'start')" ${container.status === 'running' ? 'disabled' : ''}>Start</button>
                <button class="btn btn-error" onclick="containerAction('${container.id}', 'stop')" ${container.status !== 'running' ? 'disabled' : ''}>Stop</button>
                <button class="btn btn-primary" onclick="containerAction('${container.id}', 'restart')" ${container.status !== 'running' ? 'disabled' : ''}>Restart</button>
            </div>
        </div>
    `;
    
    parentElement.appendChild(card);
    
    if (isBatchMode) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'container-select';
        checkbox.addEventListener('change', (e) => {
            card.classList.toggle('selected', e.target.checked);
        });
        card.appendChild(checkbox);
    }
}

async function refreshContainers() {
    try {
        setLoading(true, 'Loading containers...');
        
        const search = document.getElementById('search-input').value || '';
        const status = document.getElementById('status-filter').value || document.getElementById('status-filter-mobile').value || '';
        const tag = document.getElementById('tag-filter').value || document.getElementById('tag-filter-mobile').value || '';
        const stack = document.getElementById('stack-filter').value || document.getElementById('stack-filter-mobile').value || '';
        
        const url = `/api/containers?search=${encodeURIComponent(search)}&status=${status}&tag=${encodeURIComponent(tag)}&stack=${encodeURIComponent(stack)}&nocache=${Date.now()}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const containers = await response.json();
        renderContainers(containers);
        
        loadSystemStats();
        
        if (containers.some(c => c.status === 'running')) {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
            }
            refreshTimer = setTimeout(() => {
                refreshContainers();
            }, 30000);
        }
        
    } catch (error) {
        console.error('Failed to refresh containers:', error);
        showMessage('error', 'Failed to refresh containers');
        document.getElementById('no-containers').style.display = 'block';
    } finally {
        setLoading(false);
    }
}

async function containerAction(id, action) {
    try {
        const response = await fetch(`/api/container/${id}/${action}`, { method: 'POST' });
        const result = await response.json();
        if (result.status === 'success') {
            showMessage('success', `Container ${action}ed successfully`);
            refreshContainers();
        } else {
            showMessage('error', result.message);
        }
    } catch (error) {
        showMessage('error', 'Failed to perform action');
    }
}

function openCustomContainerURL(id) {
    fetch(`/api/container/${id}/custom_url`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success' && data.url) {
                window.open(data.url, '_blank');
            } else {
                openContainerPort(id);
            }
        })
        .catch(error => {
            console.error('Error getting custom URL:', error);
            openContainerPort(id);
        });
}

function openContainerPort(id) {
    fetch(`/api/container/${id}/inspect`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                const portBindings = data.data.HostConfig.PortBindings;
                if (!portBindings || Object.keys(portBindings).length === 0) {
                    showMessage('error', 'No exposed ports for this container');
                    return;
                }
                
                let hostPort = null;
                for (const containerPort in portBindings) {
                    if (portBindings[containerPort] && 
                        portBindings[containerPort][0] && 
                        portBindings[containerPort][0].HostPort) {
                        hostPort = portBindings[containerPort][0].HostPort;
                        break;
                    }
                }
                
                if (hostPort) {
                    const isSSL = hostPort === '443' || hostPort === '8443';
                    const protocol = isSSL ? 'https' : 'http';
                    const host = window.location.hostname;
                    window.open(`${protocol}://${host}:${hostPort}`, '_blank');
                } else {
                    showMessage('error', 'Could not determine a port for this container');
                }
            } else {
                showMessage('error', data.message || 'Failed to inspect container');
            }
        })
        .catch(error => {
            console.error('Error inspecting container:', error);
            showMessage('error', 'Failed to access container information');
        });
}

function showContainerPopup(id, name) {
    fetch(`/api/container/${id}/get_tags`)
        .then(response => response.json())
        .then(tagData => {
            const tags = tagData.tags || [];
            
            fetch(`/api/container/${id}/custom_url`)
                .then(response => response.json())
                .then(urlData => {
                    const customUrl = urlData.url || '';
                    
                    const popup = document.createElement('div');
                    popup.className = 'logs-modal';
                    popup.innerHTML = `
                        <div class="modal-header">
                            <h3>${name}</h3>
                            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
                        </div>
                        <div class="container-stats" style="margin-bottom: 1rem;">
                            CPU: <span id="popup-cpu-${id}">Loading...</span>% | Memory: <span id="popup-memory-${id}">Loading...</span> MB
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <label>Tags (comma separated):</label>
                            <input type="text" id="container-tags-${id}" class="url-input" value="${tags.join(', ')}">
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <label>Custom Launch URL:</label>
                            <input type="text" id="container-url-${id}" class="url-input" value="${customUrl}" placeholder="http://example.com:8080">
                        </div>
                        <div class="actions" style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
                            <button class="btn btn-primary" onclick="saveContainerSettings('${id}', '${name}')">Save Settings</button>
                        </div>
                        <div class="actions" style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                            <button class="btn btn-primary" onclick="viewContainerLogs('${id}')">Logs</button>
                            <button class="btn btn-primary" onclick="inspectContainer('${id}')">Inspect</button>
                            <button class="btn btn-primary" onclick="showContainerImage('${id}')">Image</button>
                            <button class="btn btn-primary" onclick="repullContainer('${id}')">Repull</button>
                            <button class="btn btn-error" onclick="removeContainer('${id}', '${name}')">Remove</button>
                        </div>
                    `;
                    document.body.appendChild(popup);
                    
                    const container = document.querySelector(`[data-id="${id}"]`);
                    if (container) {
                        document.getElementById(`popup-cpu-${id}`).textContent = container.dataset.cpu;
                        document.getElementById(`popup-memory-${id}`).textContent = container.dataset.memory;
                    }
                });
        })
        .catch(error => {
            console.error('Error getting container settings:', error);
            showMessage('error', 'Failed to load container settings');
        });
}

function saveContainerSettings(id, name) {
    const tagsInput = document.getElementById(`container-tags-${id}`);
    const urlInput = document.getElementById(`container-url-${id}`);
    
    if (!tagsInput || !urlInput) {
        showMessage('error', 'Failed to find input fields');
        return;
    }
    
    const tagsText = tagsInput.value;
    const tags = tagsText.split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    
    const customUrl = urlInput.value.trim();
    
    fetch(`/api/container/${id}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tags: tags,
            custom_url: customUrl
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            showMessage('success', 'Container settings saved');
            document.querySelectorAll('.logs-modal').forEach(modal => modal.remove());
            refreshContainers();
        } else {
            showMessage('error', data.message || 'Failed to save settings');
        }
    })
    .catch(error => {
        console.error('Error saving container settings:', error);
        showMessage('error', 'Failed to save container settings');
    });
}

async function viewContainerLogs(id) {
    try {
        const response = await fetch(`/api/container/${id}/logs`);
        const result = await response.json();
        if (result.status === 'success') {
            const modal = document.createElement('div');
            modal.className = 'logs-modal';
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>Logs for Container ${id}</h3>
                    <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
                </div>
                <div class="logs-content">${result.logs}</div>
            `;
            document.body.appendChild(modal);
        } else {
            showMessage('error', result.message);
        }
    } catch (error) {
        showMessage('error', 'Failed to get container logs');
    }
}

async function inspectContainer(id) {
    try {
        const response = await fetch(`/api/container/${id}/inspect`);
        const result = await response.json();
        if (result.status === 'success') {
            const modal = document.createElement('div');
            modal.className = 'logs-modal';
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>Inspect for Container ${id}</h3>
                    <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
                </div>
                <div class="logs-content">${JSON.stringify(result.data, null, 2)}</div>
            `;
            document.body.appendChild(modal);
        } else {
            showMessage('error', result.message);
        }
    } catch (error) {
        showMessage('error', 'Failed to inspect container');
    }
}

async function showContainerImage(id) {
    try {
        const response = await fetch(`/api/container/${id}/inspect`);
        const result = await response.json();
        if (result.status === 'success') {
            const image = result.data.Config.Image || 'Unknown';
            alert(`Container Image:\n${image}`);
        } else {
            showMessage('error', result.message);
        }
    } catch (error) {
        showMessage('error', 'Failed to get container image');
    }
}

function removeContainer(id, name) {
    if (confirm(`Are you sure you want to remove container ${name}? This action cannot be undone.`)) {
        fetch(`/api/container/${id}/remove`, {
            method: 'POST'
        })
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success') {
                showMessage('success', `Container ${name} removed successfully`);
                const popups = document.querySelectorAll('.logs-modal');
                popups.forEach(popup => popup.remove());
                refreshContainers();
            } else {
                showMessage('error', result.message || 'Failed to remove container');
            }
        })
        .catch(error => {
            console.error('Error removing container:', error);
            showMessage('error', 'Failed to remove container');
        });
    }
}

async function repullContainer(id) {
    if (!confirm('Are you sure you want to repull this container? This will stop and remove the current container and start a new one with the latest image.')) {
        return;
    }
    
    try {
        setLoading(true, 'Repulling container...');
        const response = await fetch(`/api/container/${id}/repull`, {
            method: 'POST'
        });
        const result = await response.json();
        if (result.status === 'success') {
            showMessage('success', result.message);
            refreshContainers();
        } else {
            showMessage('error', result.message);
        }
    } catch (error) {
        showMessage('error', 'Failed to repull container');
    } finally {
        setLoading(false);
    }
}

// Batch mode functions
function toggleBatchMode() {
    const containersList = document.getElementById('containers-list');
    const batchActions = document.getElementById('batch-actions');
    const toggleButton = document.getElementById('toggle-batch-mode');
    
    const isBatchMode = containersList.classList.toggle('batch-mode');
    
    if (isBatchMode) {
        toggleButton.textContent = 'Exit Batch';
        batchActions.classList.add('visible');
        
        document.querySelectorAll('.container-card').forEach(card => {
            if (!card.querySelector('.container-select')) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'container-select';
                checkbox.addEventListener('change', (e) => {
                    card.classList.toggle('selected', e.target.checked);
                });
                card.appendChild(checkbox);
            }
        });
    } else {
        toggleButton.textContent = 'Batch';
        batchActions.classList.remove('visible');
        
        document.querySelectorAll('.container-select').forEach(checkbox => {
            checkbox.checked = false;
        });
        document.querySelectorAll('.container-card').forEach(card => {
            card.classList.remove('selected');
        });
    }
}

function toggleAllContainers() {
    const checkboxes = document.querySelectorAll('.container-select');
    const allSelected = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = !allSelected;
        checkbox.dispatchEvent(new Event('change'));
    });
}

function batchAction(action) {
    const selectedCards = document.querySelectorAll('.container-card.selected');
    if (selectedCards.length === 0) {
        showMessage('error', 'No containers selected');
        return;
    }
    
    let confirmMessage = '';
    switch(action) {
        case 'start': confirmMessage = 'Start all selected containers?'; break;
        case 'stop': confirmMessage = 'Stop all selected containers?'; break;
        case 'restart': confirmMessage = 'Restart all selected containers?'; break;
        case 'remove': confirmMessage = 'Remove all selected containers? This cannot be undone!'; break;
    }
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    setLoading(true, `Processing ${selectedCards.length} containers...`);
    
    // Get all selected container IDs
    const containerIds = Array.from(selectedCards).map(card => card.dataset.id);
    
    // Call the batch API endpoint
    fetch(`/api/batch/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ containers: containerIds })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success' || result.status === 'partial') {
            showMessage('success', result.message);
            refreshContainers();
        } else {
            showMessage('error', result.message || `Failed to ${action} containers`);
        }
    })
    .catch(error => {
        setLoading(false);
        console.error(`Error during batch ${action}:`, error);
        showMessage('error', `Failed to ${action} containers`);
    });
}

// Compose files functions
function loadComposeFiles() {
    fetch('/api/compose/files')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('compose-files');
            select.innerHTML = '<option value="">Select a compose file...</option>';
            if (data.files && data.files.length) {
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file;
                    option.textContent = file;
                    select.appendChild(option);
                });
                if (currentComposeFile) {
                    select.value = currentComposeFile;
                }
            } else {
                console.warn('No compose files found');
                showMessage('warning', 'No compose files found. Try scanning or check the server configuration.');
            }
        })
        .catch(error => {
            console.error('Failed to load compose files:', error);
            showMessage('error', `Failed to load compose files: ${error.message}`);
        });
}

function scanComposeFiles() {
    setLoading(true, 'Scanning for compose files...');
    fetch('/api/compose/scan')
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            const select = document.getElementById('compose-files');
            select.innerHTML = '<option value="">Select a compose file...</option>';
            if (data.files && data.files.length) {
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file;
                    option.textContent = file;
                    select.appendChild(option);
                });
                showMessage('success', `Found ${data.files.length} compose files`);
            } else {
                console.warn('No compose files found during scan');
                showMessage('warning', 'No compose files found during scan. Ensure files exist in configured directories.');
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to scan compose files:', error);
            showMessage('error', `Failed to scan compose files: ${error.message}`);
        });
}

function loadSelectedFile() {
    const select = document.getElementById('compose-files');
    currentComposeFile = select.value;
    if (currentComposeFile) {
        loadCompose();
    }
}

async function loadCompose() {
    if (!currentComposeFile) {
        showMessage('error', 'No compose file selected');
        setLoading(false);
        return;
    }
    try {
        setLoading(true, `Loading ${currentComposeFile}...`);
        const url = `/api/compose?file=${encodeURIComponent(currentComposeFile)}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        if (result.content) {
            document.getElementById('compose-editor').value = result.content;
            currentComposeFile = result.file;
            document.getElementById('compose-files').value = currentComposeFile;
            showMessage('success', `Loaded compose file: ${currentComposeFile}`);
        } else {
            console.error('Failed to load compose file:', result.message);
            showMessage('error', result.message || 'Failed to load compose file');
        }
    } catch (error) {
        console.error('Failed to load compose file:', error);
        showMessage('error', `Failed to load compose file: ${error.message}`);
    } finally {
        setLoading(false);
    }
}

async function saveCompose() {
    if (!currentComposeFile) {
        showMessage('error', 'Please select a compose file');
        return;
    }
    try {
        setLoading(true, 'Saving compose file...');
        const content = document.getElementById('compose-editor').value;
        const response = await fetch('/api/compose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content, file: currentComposeFile })
        });
        const result = await response.json();
        if (result.status === 'success') {
            showMessage('success', 'Compose file saved successfully');
        } else {
            showMessage('error', result.message);
        }
    } catch (error) {
        console.error('Failed to save compose file:', error);
        showMessage('error', 'Failed to save compose file');
    } finally {
        setLoading(false);
    }
}

function extractEnvVarsToClipboard() {
    if (!currentComposeFile) {
        showMessage('error', 'Please select a compose file');
        return;
    }
    setLoading(true, 'Extracting environment variables...');
    fetch('/api/compose/extract-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            compose_file: currentComposeFile,
            modify_compose: false,
            save_directly: false
        })
    })
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                const textarea = document.createElement('textarea');
                textarea.value = data.content;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showMessage('success', 'Environment variables copied to clipboard! To use them: 1) Create a .env file in the same directory as your compose file, 2) Paste the variables, 3) Add env_file: .env to your compose file');
            } else {
                showMessage('error', data.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to extract environment variables:', error);
            showMessage('error', 'Failed to extract environment variables');
        });
}

// Replace the existing composeAction function with this one
function composeAction(action) {
    if (!currentComposeFile) {
        showMessage('error', 'Please select a compose file');
        return;
    }
    
    if (action !== 'restart') {
        showMessage('error', 'Only restart action is supported');
        return;
    }
    
    // Create a modal for the pull option instead of using confirm
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Restart ${currentComposeFile}</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <p>Do you want to pull the latest images before restarting?</p>
            <div class="actions" style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
                <button class="btn btn-success" onclick="executeComposeRestart(true)">Yes, pull latest images</button>
                <button class="btn btn-primary" onclick="executeComposeRestart(false)">No, use existing images</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function executeComposeRestart(pullImages) {
    // Close any open modals
    document.querySelectorAll('.logs-modal').forEach(modal => modal.remove());
    
    setLoading(true, `Restarting compose services...`);
    fetch('/api/compose/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            file: currentComposeFile,
            action: 'restart',
            pull: pullImages
        })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message);
            refreshContainers();
        } else {
            showMessage('error', result.message);
        }
    })
    .catch(error => {
        setLoading(false);
        console.error(`Failed to restart compose:`, error);
        showMessage('error', `Failed to restart compose: ${error.message}`);
    });
}

// Env files functions
function scanEnvFiles() {
    setLoading(true, 'Scanning for .env files...');
    fetch('/api/env/files')
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            const select = document.getElementById('env-files');
            select.innerHTML = '<option value="">Select an .env file...</option>';
            if (data.files && data.files.length) {
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file;
                    option.textContent = file;
                    select.appendChild(option);
                });
                showMessage('success', `Found ${data.files.length} .env files`);
            } else {
                showMessage('info', 'No .env files found. Create one by extracting variables from a compose file.');
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to scan .env files:', error);
            showMessage('error', 'Failed to scan .env files');
        });
}

function loadEnvFile() {
    const select = document.getElementById('env-files');
    currentEnvFile = select.value;
    if (!currentEnvFile) {
        showMessage('error', 'Please select an .env file');
        return;
    }
    setLoading(true, `Loading ${currentEnvFile}...`);
    fetch(`/api/env/file?path=${encodeURIComponent(currentEnvFile)}`)
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                document.getElementById('env-editor').value = data.content;
                showMessage('success', `Loaded .env file: ${currentEnvFile}`);
            } else {
                document.getElementById('env-editor').value = `# Failed to load ${currentEnvFile}\n# Error: ${data.message}\n\n# You can create a new .env file here`;
                showMessage('error', data.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to load .env file:', error);
            document.getElementById('env-editor').value = `# Failed to load ${currentEnvFile}\n# Error: ${error}\n\n# You can create a new .env file here`;
            showMessage('error', 'Failed to load .env file');
        });
}

function saveEnvFile() {
    if (!currentEnvFile) {
        showMessage('error', 'No .env file selected');
        return;
    }
    setLoading(true, 'Saving .env file...');
    const content = document.getElementById('env-editor').value;
    fetch('/api/env/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentEnvFile, content })
    })
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                showMessage('success', 'Environment file saved successfully');
            } else {
                showMessage('error', data.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to save .env file:', error);
            showMessage('error', 'Failed to save .env file');
        });
}

// Caddy file functions
function loadCaddyFile() {
    setLoading(true, 'Loading Caddyfile...');
    fetch('/api/caddy/file')
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                document.getElementById('caddy-editor').value = data.content;
                currentCaddyFile = data.file;
                showMessage('success', `Loaded Caddyfile: ${currentCaddyFile}`);
            } else {
                showMessage('error', data.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to load Caddyfile:', error);
            showMessage('error', 'Failed to load Caddyfile');
        });
}

function saveCaddyFile() {
    setLoading(true, 'Saving Caddyfile...');
    const content = document.getElementById('caddy-editor').value;
    fetch('/api/caddy/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    })
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                showMessage('success', 'Caddyfile saved successfully');
            } else {
                showMessage('error', data.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to save Caddyfile:', error);
            showMessage('error', 'Failed to save Caddyfile');
        });
}

function saveCaddyFileAndReload() {
    setLoading(true, 'Saving and reloading Caddyfile...');
    const content = document.getElementById('caddy-editor').value;
    fetch('/api/caddy/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            content: content,
            reload: true  // Make sure this parameter is included
        })
    })
    .then(response => response.json())
    .then(data => {
        setLoading(false);
        if (data.status === 'success') {
            showMessage('success', 'Caddyfile saved and reloaded successfully');
        } else {
            showMessage('error', data.message);
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to save and reload Caddyfile:', error);
        showMessage('error', 'Failed to save and reload Caddyfile');
    });
}

// Images management functions
function loadImages() {
    setLoading(true, 'Loading images...');
    fetch('/api/images')
        .then(response => response.json())
        .then(images => {
            setLoading(false);
            const imagesList = document.getElementById('images-list');
            imagesList.innerHTML = '';
            
            if (!images.length) {
                imagesList.innerHTML = '<div class="no-containers">No images found.</div>';
                return;
            }
            
            images.forEach(image => {
                const imageCard = document.createElement('div');
                imageCard.className = 'image-card';
                
                const isUsed = image.used_by && image.used_by.length > 0;
                
                imageCard.innerHTML = `
                    <div class="image-header">
                        <span class="image-name">${image.name}</span>
                        <span class="image-size">${image.size} MB</span>
                    </div>
                    <div class="image-body">
                        <div class="image-created">Created: ${image.created}</div>
                        <div class="image-tags">${image.tags.join(', ')}</div>
                        <div class="image-used-by">Used by: ${isUsed ? image.used_by.join(', ') : 'None'}</div>
                        <div class="actions">
                            <button onclick="removeImage('${image.id}')" class="btn btn-error" ${isUsed ? 'disabled' : ''}>Remove</button>
                        </div>
                    </div>
                `;
                
                imagesList.appendChild(imageCard);
            });
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to load images:', error);
            showMessage('error', 'Failed to load images');
        });
}

function pruneImages() {
    if (!confirm('Are you sure you want to prune unused images?')) {
        return;
    }
    
    setLoading(true, 'Pruning images...');
    fetch('/api/images/prune', { method: 'POST' })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', result.message);
                loadImages();
            } else {
                showMessage('error', result.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to prune images:', error);
            showMessage('error', 'Failed to prune images');
        });
}

function removeUnusedImages() {
    if (!confirm('Are you sure you want to remove all unused images?')) {
        return;
    }
    
    const forceRemove = confirm('Force removal? This is needed for images used in multiple repositories.\nOK - Yes, force remove\nCancel - No, only remove non-conflicting images');
    
    setLoading(true, 'Removing unused images...');
    fetch(`/api/images/remove_unused?force=${forceRemove}`, { method: 'POST' })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', result.message);
                loadImages();
            } else {
                showMessage('error', result.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to remove unused images:', error);
            showMessage('error', 'Failed to remove unused images');
        });
}

function removeImage(id) {
    if (!confirm('Are you sure you want to remove this image?')) {
        return;
    }
    
    const forceRemove = confirm('Force removal? This is needed for images used in multiple repositories.');
    
    setLoading(true, 'Removing image...');
    fetch(`/api/images/${id}/remove?force=${forceRemove}`, { method: 'POST' })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', result.message || 'Image removed successfully');
                loadImages();
            } else {
                showMessage('error', result.message || 'Failed to remove image');
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to remove image:', error);
            showMessage('error', 'Failed to remove image');
        });
}

// New function to extract stack name using Docker metadata
function extractStackName(container) {
    try {
        // Use a custom composr.stack label if defined
        if (container.labels && container.labels['composr.stack']) {
            return container.labels['composr.stack'];
        }

        // Use compose_project if available
        if (container.compose_project && container.compose_project.trim()) {
            return container.compose_project;
        }

        // Use compose_file directory or filename as the stack name
        if (container.compose_file) {
            const cleanPath = container.compose_file.replace(/^\/+|\/+$/g, '');
            const parts = cleanPath.split(/[\/\\]/);
            if (parts.length > 1) {
                return parts[0]; // Use the directory name
            }
            return parts[0].replace(/\.(ya?ml|compose)$/, ''); // Use the filename without extension
        }

        // Fallback: Check for a standard Docker Compose project label
        if (container.labels && container.labels['com.docker.compose.project']) {
            return container.labels['com.docker.compose.project'];
        }

        // Fallback: Use the container name as a last resort
        return container.name || 'Unknown';
    } catch (error) {
        console.error('Error extracting stack name:', error);
        return 'Unknown';
    }
}
function updateStackFilterOptions(stacks) {
    try {
        const stackFilter = document.getElementById('stack-filter');
        const stackFilterMobile = document.getElementById('stack-filter-mobile');
        if (!stackFilter || !stackFilterMobile) {
            console.error('Stack filter elements not found');
            return;
        }
        const currentValue = stackFilter.value || stackFilterMobile.value;
        
        stackFilter.innerHTML = '<option value="">All Stacks</option>';
        stackFilterMobile.innerHTML = '<option value="">All Stacks</option>';

        stacks.sort().forEach(stack => {
            const option = document.createElement('option');
            option.value = stack;
            option.textContent = stack;
            if (stack === currentValue) option.selected = true;
            stackFilter.appendChild(option);
            
            const optionMobile = document.createElement('option');
            optionMobile.value = stack;
            optionMobile.textContent = stack;
            if (stack === currentValue) optionMobile.selected = true;
            stackFilterMobile.appendChild(optionMobile);
        });
    } catch (error) {
        console.error('Error updating stack filter options:', error);
    }
}

function renderContainersByStack(containers) {
    try {
        const list = document.getElementById('containers-list');
        const noContainers = document.getElementById('no-containers');
        const isBatchMode = list.classList.contains('batch-mode');

        if (!Array.isArray(containers) || !containers.length) {
            noContainers.style.display = 'block';
            list.innerHTML = '';
            return;
        }

        noContainers.style.display = 'none';
        list.innerHTML = '';

        let allTags = new Set();
        let allStacks = new Set();
        let stackContainers = {};

        containers.forEach(container => {
            const stackName = extractStackName(container);
            allStacks.add(stackName);
            
            if (!stackContainers[stackName]) {
                stackContainers[stackName] = [];
            }
            stackContainers[stackName].push(container);
            
            if (container.tags && Array.isArray(container.tags)) {
                container.tags.forEach(tag => allTags.add(tag));
            }
        });

        // Calculate stats for each stack
        const stackStats = {};
        Object.keys(stackContainers).forEach(stackName => {
            const stackGroup = stackContainers[stackName];
            stackStats[stackName] = {
                total: stackGroup.length,
                running: stackGroup.filter(c => c.status === 'running').length,
                cpu: stackGroup.reduce((sum, c) => sum + (parseFloat(c.cpu_percent) || 0), 0).toFixed(1),
                memory: Math.round(stackGroup.reduce((sum, c) => sum + (parseFloat(c.memory_usage) || 0), 0))
            };
        });

        // Render each stack with its containers
        Object.keys(stackContainers).sort().forEach(stackName => {
            const stats = stackStats[stackName];
            const composeFile = findComposeFileForStack(stackContainers[stackName]);

            // Create stack header
            const stackHeader = document.createElement('div');
            stackHeader.className = 'stack-header';
            stackHeader.innerHTML = `
                <h3>${stackName}</h3>
                <div class="stack-stats">
                    <span title="Container count">${stats.running}/${stats.total} running</span>
                    <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                    <span title="Total memory usage">Mem: ${stats.memory} MB</span>
                </div>
            `;

            if (composeFile) {
                stackHeader.title = "Click to open compose file";
                stackHeader.addEventListener('click', () => openComposeInEditor(composeFile));
            }

            list.appendChild(stackHeader);

            // Render the containers for this stack
            stackContainers[stackName].sort((a, b) => a.name.localeCompare(b.name));
            stackContainers[stackName].forEach(container => {
                renderSingleContainer(container, list, isBatchMode);
            });
        });

        // Update filter options
        updateTagFilterOptions(Array.from(allTags));
        updateStackFilterOptions(Array.from(allStacks));
    } catch (error) {
        console.error('Error rendering containers by stack:', error);
        showMessage('error', 'Failed to render containers by stack');
    }
}
function findComposeFileForStack(containers) {
    for (const container of containers) {
        if (container.compose_file) return container.compose_file;
    }
    return null;
}

openComposeInEditor(composeFile) {
    console.log('Opening compose file:', composeFile);
    switchTab('config');
    
    // Refresh the compose files list first
    scanComposeFiles();
    
    setTimeout(() => {
        const composeSelect = document.getElementById('compose-files');
        if (composeSelect) {
            // Extract just the filename from the path if it's a full path
            const fileName = composeFile.split('/').pop();
            console.log('Looking for file name:', fileName);
            
            let found = false;
            for (let i = 0; i < composeSelect.options.length; i++) {
                const optionValue = composeSelect.options[i].value;
                // Check if the option ends with the file name
                if (optionValue.endsWith('/' + fileName) || optionValue === fileName) {
                    composeSelect.value = optionValue;
                    currentComposeFile = optionValue;
                    found = true;
                    break;
                }
            }
            
            if (found) {
                loadCompose();
                showMessage('success', 'Compose file loaded');
            } else {
                showMessage('error', 'Could not find matching compose file: ' + fileName);
            }
        } else {
            console.error('Compose files select not found');
        }
    }, 500); // Wait for scan to complete
}

// Initialize with a more robust approach
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded");
    
    // Initialize theme
    loadTheme();
    
    // Make sure tabs are properly set
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Manually activate the containers tab
    const containersTab = document.querySelector('.tab[onclick="switchTab(\'containers\')"]');
    if (containersTab) containersTab.classList.add('active');
    
    const containersContent = document.getElementById('containers-tab');
    if (containersContent) containersContent.classList.add('active');
    
    // Immediately load containers
    setTimeout(() => {
        console.log("Initializing containers...");
        refreshContainers();
        startStatsUpdater();
    }, 100);
    // Force switch to containers tab to ensure proper initialization
    switchTab('containers');
    
    // Start system stats updater
    startStatsUpdater();
    
    // Helper function to safely add event listeners
    function addEventListenerIfExists(id, event, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            console.warn(`Element with ID "${id}" not found for event listener`);
        }
    }
    
    // Theme handlers
    addEventListenerIfExists('theme-selector', 'change', (e) => setTheme(e.target.value));
    addEventListenerIfExists('theme-selector-mobile', 'change', (e) => setTheme(e.target.value));
    
    // Search input
    addEventListenerIfExists('search-input', 'input', refreshContainers);
    
    // Status filters
    addEventListenerIfExists('status-filter', 'change', () => {
        syncFilters('status-filter', 'status-filter-mobile');
        refreshContainers();
    });
    
    addEventListenerIfExists('status-filter-mobile', 'change', () => {
        syncFilters('status-filter-mobile', 'status-filter');
        refreshContainers();
    });
    
    // Tag filters
    addEventListenerIfExists('tag-filter', 'change', () => {
        syncFilters('tag-filter', 'tag-filter-mobile');
        refreshContainers();
    });
    
    addEventListenerIfExists('tag-filter-mobile', 'change', () => {
        syncFilters('tag-filter-mobile', 'tag-filter');
        refreshContainers();
    });
    
    // Stack filters (new)
    addEventListenerIfExists('stack-filter', 'change', () => {
        syncFilters('stack-filter', 'stack-filter-mobile');
        refreshContainers();
    });
    
    addEventListenerIfExists('stack-filter-mobile', 'change', () => {
        syncFilters('stack-filter-mobile', 'stack-filter');
        refreshContainers();
    });
    
    // Group filters (new)
    addEventListenerIfExists('group-filter', 'change', () => {
        syncFilters('group-filter', 'group-filter-mobile');
        refreshContainers();
    });
    
    addEventListenerIfExists('group-filter-mobile', 'change', () => {
        syncFilters('group-filter-mobile', 'group-filter');
        refreshContainers();
    });
    
    // Sort filters
    addEventListenerIfExists('sort-filter', 'change', () => {
        syncFilters('sort-filter', 'sort-filter-mobile');
        refreshContainers();
    });
    
    addEventListenerIfExists('sort-filter-mobile', 'change', () => {
        syncFilters('sort-filter-mobile', 'sort-filter');
        refreshContainers();
    });
    
    // Refresh button
    addEventListenerIfExists('refresh-btn', 'click', refreshContainers);
    
    console.log('All event listeners initialized');
});