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
// Make these functions globally available for cross-file access
window.extractStackName = function(container) {
    try {
        // Use compose_project if available
        if (container.compose_project && container.compose_project.trim()) {
            return container.compose_project;
        }

        // Use compose_file directory as the stack name
        if (container.compose_file) {
            const pathParts = container.compose_file.split('/').filter(p => p.length > 0);
            const systemDirs = ['home', 'var', 'opt', 'usr', 'etc', 'mnt', 'srv', 'data', 'app', 'docker'];
            
            for (const part of pathParts) {
                if (!systemDirs.includes(part.toLowerCase())) {
                    return part;
                }
            }
            
            if (pathParts.length > 0) {
                return pathParts[pathParts.length - 2] || pathParts[0];
            }
        }

        // Fallback
        return container.name || 'Unknown';
    } catch (error) {
        console.error('Error extracting stack name:', error);
        return 'Unknown';
    }
};

window.findComposeFileForStack = function(containers) {
    if (!containers || containers.length === 0) return null;
    
    const stackName = window.extractStackName(containers[0]);
    
    // Try to extract compose file directly from container
    for (const container of containers) {
        if (container.compose_file) {
            if (container.compose_file.startsWith('../')) {
                return container.compose_file;
            }
            
            if (!container.compose_file.includes('/') && stackName) {
                return `${stackName}/${container.compose_file}`;
            }
            
            return container.compose_file;
        }
    }
    
    // No compose file found, construct a default path
    if (stackName) {
        return `${stackName}/docker-compose.yaml`;
    }
    
    return null;
};
// Theme handling
// 10. Update setTheme function
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
    
    // Emit theme change event for editors
    window.dispatchEvent(new Event('themeChanged'));
    
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

// Load available Docker hosts on startup
function loadDockerHosts() {
    fetch('/api/docker/hosts')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('docker-host-select');
            select.innerHTML = '';
            
            data.hosts.forEach(host => {
                const option = document.createElement('option');
                option.value = host;
                option.textContent = host;
                if (host === data.current) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Failed to load Docker hosts:', error);
        });
}

// Switch Docker host
function switchDockerHost() {
    const select = document.getElementById('docker-host-select');
    const newHost = select.value;
    
    setLoading(true, `Connecting to ${newHost}...`);
    
    fetch('/api/docker/switch-host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: newHost })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message);
            refreshContainers(); // Reload containers from new host
        } else {
            showMessage('error', result.message);
            // Revert selection if failed
            loadDockerHosts();
        }
    })
    .catch(error => {
        setLoading(false);
        showMessage('error', 'Failed to switch Docker host');
    });
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
    
    // Toggle filter controls visibility
    const filterControls = document.querySelector('.filter-controls');
    if (filterControls) {
        filterControls.style.display = (tabName === 'containers') ? 'flex' : 'none';
    }
    
    // Existing tab-specific logic
    if (tabName === 'containers') {
        refreshContainers();
    } else if (tabName === 'images') {
        loadImages();
    } else if (tabName === 'config') {
        switchSubTab('compose');
        const pendingFile = localStorage.getItem('pendingComposeFile');
        if (pendingFile) {
            console.log('Found pending compose file when switching to config tab:', pendingFile);
        }
    } else if (tabName === 'hosts') {
        loadHostsList();  // Load the hosts management view
    } else if (tabName === 'backup') {
        // NEW: Initialize backup tab when first opened
        initializeBackupTab();
    }

    
    if (document.getElementById('batch-actions')) {
        document.getElementById('batch-actions').classList.toggle('visible', 
            tabName === 'containers' && document.getElementById('containers-list').classList.contains('batch-mode'));
    }
}

// Fix the switchSubTab function in main.js to properly handle create tab state

function switchSubTab(subtabName) {
    document.querySelectorAll('.subtab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.subtab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`.subtab[onclick="switchSubTab('${subtabName}')"]`).classList.add('active');
    document.getElementById(`${subtabName}-subtab`).classList.add('active');
   
    if (subtabName === 'compose') {
        loadComposeFiles();
        // Add this line to load templates when switching to compose tab
        if (window.loadTemplates) window.loadTemplates();
        
        // Re-initialize CodeMirror for compose editor if needed
        if (window.initializeCodeMirrorEditor && !window.codeMirrorEditors?.['compose-editor']) {
            window.initializeCodeMirrorEditor('compose-editor', 'yaml');
        }
    } else if (subtabName === 'env') {
        scanEnvFiles();
        // Re-initialize editor for env editor if needed
        if (window.initializeCodeMirrorEditor && !window.codeMirrorEditors?.['env-editor']) {
            window.initializeCodeMirrorEditor('env-editor', 'ini');
        }
    } else if (subtabName === 'caddy') {
        loadCaddyFile();
        // Re-initialize editor for caddy editor if needed
        if (window.initializeCodeMirrorEditor && !window.codeMirrorEditors?.['caddy-editor']) {
            window.initializeCodeMirrorEditor('caddy-editor', 'text');
        }
    } else if (subtabName === 'create') {
        // FIX: Always show the project creation form when switching to create tab
        const projectCreationForm = document.getElementById('project-creation-form');
        if (projectCreationForm) {
            projectCreationForm.style.display = 'block';
        }
        
        // Initialize project creation
        if (window.loadTemplates) window.loadTemplates();
        if (window.loadProjectLocations) window.loadProjectLocations();
        if (window.goToStep) window.goToStep(1);
        
        // FIX: Initialize CodeMirror editors for create form if not already done
        setTimeout(() => {
            if (window.initializeCodeMirrorEditor) {
                if (!window.codeMirrorEditors?.['compose-content']) {
                    window.initializeCodeMirrorEditor('compose-content', 'yaml');
                }
                if (!window.codeMirrorEditors?.['env-content']) {
                    window.initializeCodeMirrorEditor('env-content', 'ini');
                }
            }
        }, 500);
    }
}

// Replace existing toggleStats function (disabled)
function toggleStats() {
    // No toggling; stats always use .stats-grid
}

// Replace existing loadSystemStats function
function loadSystemStats() {
    fetch('/api/system')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                // Desktop stats (grid)
                const totalContainersGrid = document.getElementById('total-containers-grid');
                const runningContainers = document.getElementById('running-containers');
                const cpuCountGrid = document.getElementById('cpu-count-grid');
                const memoryUsageGrid = document.getElementById('memory-usage-grid');
                const memoryTotalGrid = document.getElementById('memory-total-grid');
                const memoryProgress = document.getElementById('memory-progress');
                
                // Mobile stats (compact)
                const totalContainers = document.getElementById('total-containers');
                const cpuCount = document.getElementById('cpu-count');
                const memoryUsage = document.getElementById('memory-usage');
                const memoryTotal = document.getElementById('memory-total');
                
                // Populate desktop stats
                if (totalContainersGrid) totalContainersGrid.textContent = data.total_containers || '--';
                if (runningContainers) runningContainers.textContent = data.running_containers || '--';
                if (cpuCountGrid) cpuCountGrid.textContent = data.cpu_count || '--';
                if (memoryUsageGrid) memoryUsageGrid.textContent = data.memory_used || '--';
                if (memoryTotalGrid) memoryTotalGrid.textContent = data.memory_total || '--';
                if (memoryProgress) memoryProgress.style.width = `${data.memory_percent || 0}%`;
                
                // Populate mobile stats
                if (totalContainers) totalContainers.textContent = data.total_containers || '--';
                if (cpuCount) cpuCount.textContent = data.cpu_count || '--';
                if (memoryUsage) memoryUsage.textContent = data.memory_used || '--';
                if (memoryTotal) memoryTotal.textContent = data.memory_total || '--';
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
    
    tagFilter.innerHTML = '<option value="">Tags</option>';
    tagFilterMobile.innerHTML = '<option value="">Tags</option>';
    
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
    const gridView = document.getElementById('grid-view');
    const tableView = document.getElementById('table-view');
    const noContainers = document.getElementById('no-containers');
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    
    // Define ALL filter variables
    const search = document.getElementById('search-input').value || '';
    const status = document.getElementById('status-filter').value || document.getElementById('status-filter-mobile').value || '';
    const tag = document.getElementById('tag-filter').value || document.getElementById('tag-filter-mobile').value || '';
    const stack = document.getElementById('stack-filter').value || document.getElementById('stack-filter-mobile').value || '';
    const tagFilter = tag; // for backward compatibility 
    const stackFilter = stack; // for backward compatibility
    const group = document.getElementById('group-filter').value || document.getElementById('group-filter-mobile').value || 'none';
    const sort = document.getElementById('sort-filter').value || document.getElementById('sort-filter-mobile').value || 'name';
    const sortDirection = 'asc'; // Default sort direction
    
    // Clear existing content
    document.getElementById('containers-list').innerHTML = '';
    if (tableView) {
        document.getElementById('table-body').innerHTML = '';
    }

    if (!Array.isArray(containers) || !containers.length) {
        noContainers.style.display = 'block';
        return;
    }

    noContainers.style.display = 'none';

    let allTags = new Set();
    let allStacks = new Set();
    let filteredContainers = [...containers];

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

    // Choose rendering method based on active view
    if (tableView && tableView.classList.contains('active')) {
        renderContainersAsTable(filteredContainers);
    } else {
        if (group === 'stack') {
            renderContainersByStack(filteredContainers);
        } else if (group === 'tag' || sort === 'tag') {
            renderContainersByTag(filteredContainers);
       
        
        } else {
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
                renderSingleContainer(container, document.getElementById('containers-list'));
            });
        }
    }

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
// ADD THIS NEW FUNCTION after renderContainersByTag
function renderContainersByHost(containers) {
    const list = document.getElementById('containers-list');
    const noContainers = document.getElementById('no-containers');
    
    list.innerHTML = '';
    list.className = 'container-grid';
    
    if (!Array.isArray(containers) || !containers.length) {
        noContainers.style.display = 'block';
        return;
    }
    
    noContainers.style.display = 'none';
    
    // Group containers by host
    const hostGroups = {};
    containers.forEach(container => {
        const host = container.host || 'local';
        if (!hostGroups[host]) {
            hostGroups[host] = [];
        }
        hostGroups[host].push(container);
    });
    
    // Render each host group
    Object.keys(hostGroups).sort().forEach(host => {
        const hostContainers = hostGroups[host];
        
        // Create host header
        const hostHeader = document.createElement('div');
        hostHeader.className = 'stack-header';
        const stats = {
            total: hostContainers.length,
            running: hostContainers.filter(c => c.status === 'running').length,
            cpu: hostContainers.reduce((sum, c) => sum + (parseFloat(c.cpu_percent) || 0), 0).toFixed(1),
            memory: Math.round(hostContainers.reduce((sum, c) => sum + (parseFloat(c.memory_usage) || 0), 0))
        };
        
        hostHeader.innerHTML = `
            <h3>${host}</h3>
            <div class="stack-stats">
                <span title="Container count">${stats.running}/${stats.total} running</span>
                <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                <span title="Total memory usage">Mem: ${stats.memory} MB</span>
            </div>
        `;
        
        list.appendChild(hostHeader);
        
        // Render containers for this host
        hostContainers.sort((a, b) => a.name.localeCompare(b.name));
        hostContainers.forEach(container => {
            renderSingleContainer(container, list);
        });
    });
}
function renderSingleContainer(container, parentElement) {
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    const card = document.createElement('div');
    card.className = 'container-card';
    card.dataset.id = container.id;
    card.dataset.cpu = container.cpu_percent;
    card.dataset.memory = container.memory_usage;
    const uptimeDisplay = container.uptime && container.uptime.display ? container.uptime.display : 'N/A';
    // Removed uptimeLong logic to ensure consistent color

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
                <span class="uptime-badge">${uptimeDisplay}</span>
                <button class="btn btn-primary" style="padding: 2px 5px; font-size: 10px; min-width: auto;" onclick="showContainerPopup('${container.id}', '${container.name}')">...</button>
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
// Toggle between grid and table view for images
function toggleImageView() {
    const gridView = document.getElementById('images-grid-view');
    const tableView = document.getElementById('images-table-view');
    const toggleButton = document.getElementById('toggle-image-view');
    
    if (gridView.classList.contains('active')) {
        gridView.classList.remove('active');
        tableView.classList.add('active');
        toggleButton.textContent = '⋮⋮';
        localStorage.setItem('imageViewPreference', 'table');
    } else {
        tableView.classList.remove('active');
        gridView.classList.add('active');
        toggleButton.textContent = '≡';
        localStorage.setItem('imageViewPreference', 'grid');
    }
    
    loadImages(); // Reload images in the new view
}

// Update refreshContainers in main.js
async function refreshContainers(sortKey = null, sortDirection = 'asc') {
    try {
        setLoading(true, 'Loading containers...');

        const tableView = document.getElementById('table-view');
        const filterControls = document.querySelector('.filter-controls');
        
        if (tableView && tableView.classList.contains('active')) {
            if (filterControls) {
                filterControls.style.display = 'none';
            }
            // Ensure controls are in table
            moveControlsToTable();
        }
        
        // GET ALL THE FILTER VALUES HERE (before using them)
        const search = document.getElementById('search-input').value || '';
        const status = document.getElementById('status-filter').value || document.getElementById('status-filter-mobile').value || '';
        const tag = document.getElementById('tag-filter').value || document.getElementById('tag-filter-mobile').value || '';
        const stack = document.getElementById('stack-filter').value || document.getElementById('stack-filter-mobile').value || '';
        const group = document.getElementById('group-filter').value || document.getElementById('group-filter-mobile').value || 'none';
        
        // Use provided sort parameters or fall back to dropdown value
        const sort = sortKey || document.getElementById('sort-filter').value || document.getElementById('sort-filter-mobile').value || 'name';

        // Simplified URL creation - always use standard endpoint
        const url = `/api/containers?search=${encodeURIComponent(search)}&status=${status}&tag=${encodeURIComponent(tag)}&stack=${encodeURIComponent(stack)}&sort=${sort}&direction=${sortDirection}&nocache=${Date.now()}`;

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

        // Add batch actions for table view in batch mode
        if (tableView && tableView.classList.contains('active') && tableView.classList.contains('batch-mode')) {
            // We're in table view and batch mode - make sure batch actions are visible
            const tableBatchActions = document.getElementById('table-batch-actions');
            if (tableBatchActions) {
                tableBatchActions.style.display = 'flex';
                
                // If empty, populate it
                if (tableBatchActions.children.length === 0) {
                    tableBatchActions.innerHTML = `
                        <button class="btn btn-success" onclick="batchAction('start')">Start</button>
                        <button class="btn btn-error" onclick="batchAction('stop')">Stop</button>
                        <button class="btn btn-primary" onclick="batchAction('restart')">Restart</button>
                        <button class="btn btn-error" onclick="batchAction('remove')">Remove</button>
                    `;
                }
            }
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
                            <button class="btn btn-primary" onclick="execIntoContainer('${id}', '${name}')">Terminal</button>
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
function execIntoContainer(id, name) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal terminal-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Terminal: ${name}</h3>
            <span class="close-x" onclick="closeTerminal('${id}')">×</span>
        </div>
        <div class="terminal-container">
            <div id="terminal-${id}" class="terminal-output"></div>
            <div class="terminal-input-line">
                <span class="terminal-prompt">root@${name}:~#</span>
                <input type="text" id="terminal-input-${id}" class="terminal-input" 
                       placeholder="Enter command (e.g., ls -la)" autofocus>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Focus the input
    setTimeout(() => {
        const input = document.getElementById(`terminal-input-${id}`);
        if (input) input.focus();
        
        // Add event listener for command execution
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const command = input.value.trim();
                if (!command) return;
                
                executeCommand(id, command);
                input.value = '';
            }
        });
    }, 100);
}

function executeCommand(id, command) {
    const terminal = document.getElementById(`terminal-${id}`);
    
    // Show the command in the terminal
    const cmdLine = document.createElement('div');
    cmdLine.className = 'terminal-command';
    cmdLine.textContent = `$ ${command}`;
    terminal.appendChild(cmdLine);
    
    // Show "loading" indicator
    const resultLine = document.createElement('div');
    resultLine.className = 'terminal-result';
    resultLine.textContent = 'Executing...';
    terminal.appendChild(resultLine);
    
    // Scroll to bottom
    terminal.scrollTop = terminal.scrollHeight;
    
    // Call API to execute command
    fetch(`/api/container/${id}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            resultLine.innerHTML = result.output.replace(/\n/g, '<br>');
        } else {
            resultLine.innerHTML = `<span class="error">${result.message || 'Command failed'}</span>`;
            
            // Add helpful suggestions for common errors
            if (result.output && result.output.includes('not found')) {
                const suggestionDiv = document.createElement('div');
                suggestionDiv.className = 'command-suggestion';
                
                // Check for Alpine Linux
                if (command === 'ls' || command.startsWith('ls ')) {
                    suggestionDiv.innerHTML = `
                        This appears to be a minimal container (possibly Alpine Linux).
                        <br>To install basic utilities, try:
                        <br><code>apk update && apk add busybox-extras</code>
                    `;
                    terminal.appendChild(suggestionDiv);
                }
                // Other suggestion cases can be added here
            }
        }
        
        // Scroll to bottom again
        terminal.scrollTop = terminal.scrollHeight;
    })
    .catch(error => {
        resultLine.innerHTML = `<span class="error">Error: ${error.message}</span>`;
        terminal.scrollTop = terminal.scrollHeight;
    });
}

function closeTerminal(id) {
    const modal = document.querySelector(`.terminal-modal`);
    if (modal) modal.remove();
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

// Updated toggleBatchMode function
function toggleBatchMode() {
    const containersList = document.getElementById('containers-list');
    const batchActions = document.getElementById('batch-actions');
    const tableBatchActions = document.getElementById('table-batch-actions');
    const tableView = document.getElementById('table-view');
    const toggleButton = document.getElementById('toggle-batch-mode');
    
    // Toggle batch mode class
    const isBatchMode = containersList.classList.toggle('batch-mode');
    
    // Update toggle button appearance
    if (toggleButton) {
        toggleButton.classList.toggle('active', isBatchMode);
    }
    
    // If we're in table view, update the table batch actions
    if (tableView && tableView.classList.contains('active')) {
        // Ensure table view also has batch mode class for styling
        tableView.classList.toggle('batch-mode', isBatchMode);
        
        // Show/hide batch action buttons
        if (tableBatchActions) {
            tableBatchActions.style.display = isBatchMode ? 'flex' : 'none';
        }
    } 
    // Otherwise update grid view batch actions
    else if (batchActions) {
        batchActions.classList.toggle('visible', isBatchMode);
    }
    
    // Add checkboxes to grid items if in batch mode
    if (isBatchMode) {
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
        // Clear selections when leaving batch mode
        document.querySelectorAll('.container-card.selected, #table-view tr.selected').forEach(item => {
            item.classList.remove('selected');
        });
        
        document.querySelectorAll('.container-select, .batch-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });
    }
    
    // Refresh to update the view
    refreshContainers();
}

// Add this function to your main.js
function refreshTableBatchActions() {
    // First, make sure we're in table view and batch mode
    const tableView = document.getElementById('table-view');
    if (!tableView || !tableView.classList.contains('active') || !tableView.classList.contains('batch-mode')) {
        return;
    }
    
    // Find the actions column header (last column)
    const actionsHeader = document.querySelector('#table-headers-row th:last-child');
    if (!actionsHeader) {
        return;
    }
    
    // Check if we already have batch actions
    let batchActions = document.getElementById('table-batch-actions');
    
    // If not, create them
    if (!batchActions) {
        batchActions = document.createElement('div');
        batchActions.id = 'table-batch-actions';
        batchActions.style.display = 'flex';
        batchActions.style.gap = '0.5rem';
        batchActions.style.marginBottom = '0.5rem';
        
        // Add buttons
        batchActions.innerHTML = `
            <button class="btn btn-success" onclick="batchAction('start')">Start</button>
            <button class="btn btn-error" onclick="batchAction('stop')">Stop</button>
            <button class="btn btn-primary" onclick="batchAction('restart')">Restart</button>
            <button class="btn btn-error" onclick="batchAction('remove')">Remove</button>
        `;
        
        // Add to the actions header
        actionsHeader.appendChild(batchActions);
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

// Update batchAction to handle table view selections
function batchAction(action) {
    const gridSelectedCards = document.querySelectorAll('.container-card.selected');
    const tableSelectedRows = document.querySelectorAll('#table-view tr.selected');
    const selectedItems = [...gridSelectedCards, ...tableSelectedRows];

    if (selectedItems.length === 0) {
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

    setLoading(true, `Processing ${selectedItems.length} containers...`);

    const containerIds = Array.from(selectedItems).map(item => item.dataset.id);

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
// Update loadComposeFiles to check for a pending file
function loadComposeFiles() {
    fetch('/api/compose/files')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('compose-files');
            select.innerHTML = '<option value="">Select a compose file...</option>';
          
            
            if (data.files && data.files.length) {
                // Add existing options
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file;
                    option.textContent = file;
                    select.appendChild(option);
                });
               
                // Set current file if it exists
                if (currentComposeFile) {
                    select.value = currentComposeFile;
                }
               
                // Process pending file if exists
                const pendingFile = localStorage.getItem('pendingComposeFile');
                if (pendingFile) {
                    console.log('Found pending compose file to load:', pendingFile);
                   
                    // Clear the pending file first to prevent loops
                    localStorage.removeItem('pendingComposeFile');
                   
                    // Get available options for easier debugging
                    const availableOptions = Array.from(select.options)
                        .map(opt => opt.value)
                        .filter(val => val);
                    console.log('Available options:', availableOptions);
                   
                    // Find the best match
                    let matchedOption = findBestMatchingFile(pendingFile, availableOptions);
                   
                    if (matchedOption) {
                        console.log('Found matching file:', matchedOption);
                        select.value = matchedOption;
                        currentComposeFile = matchedOption;
                        loadCompose();
                        console.log('Successfully loaded pending compose file');
                    } else {
                        console.warn('No matching file found for:', pendingFile);
                       
                        // Try direct load as last resort (removed immich-specific check)
                        directLoadCompose(pendingFile)
                            .catch(() => {
                                // Try with alternate extension
                                const basePathWithoutExt = pendingFile.substring(0, pendingFile.lastIndexOf('.'));
                                const altExt = pendingFile.endsWith('.yml') ? '.yaml' : '.yml';
                                const altPath = basePathWithoutExt + altExt;
                               
                                return directLoadCompose(altPath);
                            })
                            .catch(() => {
                                console.error('All direct load attempts failed');
                                showMessage('error', `Could not load ${pendingFile}`);
                            });
                    }
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

// Helper function to find the best matching file
function findBestMatchingFile(pendingFile, availableOptions) {
    // 1. Exact match
    if (availableOptions.includes(pendingFile)) {
        console.log('Found exact match for pending file:', pendingFile);
        return pendingFile;
    }
    
    // 2. Case-insensitive match
    const lowerPendingFile = pendingFile.toLowerCase();
    for (const option of availableOptions) {
        if (option.toLowerCase() === lowerPendingFile) {
            console.log('Found case-insensitive match:', option);
            return option;
        }
    }
    
    // 3. Match ignoring extension
    if (pendingFile.includes('.')) {
        const pendingBasePath = pendingFile.substring(0, pendingFile.lastIndexOf('.'));
        for (const option of availableOptions) {
            if (option.includes('.')) {
                const optionBasePath = option.substring(0, option.lastIndexOf('.'));
                if (pendingBasePath.toLowerCase() === optionBasePath.toLowerCase()) {
                    console.log('Found match ignoring extension:', option);
                    return option;
                }
            }
        }
    }
    
    // 4. Match by path components
    if (pendingFile.includes('/')) {
        const pendingParts = pendingFile.split('/');
        const pendingFileBaseLower = pendingParts[pendingParts.length - 1].split('.')[0].toLowerCase();
        
        // If the path has at least a directory and file
        if (pendingParts.length >= 2) {
            const pendingDirLower = pendingParts[pendingParts.length - 2].toLowerCase();
            
            for (const option of availableOptions) {
                if (option.includes('/')) {
                    const optionParts = option.split('/');
                    if (optionParts.length >= 2) {
                        const optionDirLower = optionParts[optionParts.length - 2].toLowerCase();
                        const optionFileBaseLower = optionParts[optionParts.length - 1].split('.')[0].toLowerCase();
                        
                        if (pendingDirLower === optionDirLower && pendingFileBaseLower === optionFileBaseLower) {
                            console.log('Found match by path components:', option);
                            return option;
                        }
                    }
                }
            }
        }
        
        // 5. Match by filename only
        for (const option of availableOptions) {
            const optionFileName = option.split('/').pop();
            const pendingFileName = pendingFile.split('/').pop();
            if (optionFileName.toLowerCase() === pendingFileName.toLowerCase()) {
                console.log('Found match by filename only:', option);
                return option;
            }
        }
    }
    
    return null;
}

// Also update the scanComposeFiles function similarly
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
                
                // Check if there's a pending file to load
                const pendingFile = localStorage.getItem('pendingComposeFile');
                if (pendingFile) {
                    console.log('Found pending compose file after scan:', pendingFile);
                    
                    // Clear the pending file to prevent loops
                    localStorage.removeItem('pendingComposeFile');
                    
                    // Use setTimeout to ensure the options are fully rendered
                    setTimeout(() => {
                        // Try to find and load the pending file
                        const availableOptions = Array.from(select.options)
                            .map(opt => opt.value)
                            .filter(val => val);
                        
                        let matchedOption = findBestMatchingFile(pendingFile, availableOptions);
                        
                        if (matchedOption) {
                            select.value = matchedOption;
                            currentComposeFile = matchedOption;
                            loadCompose();
                        } else {
                            // Try direct load as fallback
                            directLoadCompose(pendingFile)
                                .catch(() => {
                                    showMessage('warning', `Could not find ${pendingFile} in available compose files`);
                                });
                        }
                    }, 100);
                } else {
                    showMessage('success', `Found ${data.files.length} compose files`);
                }
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
// 1. Update loadCompose function - COMPLETE VERSION
async function loadCompose() {
    if (!currentComposeFile) {
        showMessage('error', 'No compose file selected');
        setLoading(false);
        return;
    }
    try {
        setLoading(true, `Loading ${currentComposeFile}...`);
        
        // Try to load using the standard API endpoint
        const url = `/api/compose?file=${encodeURIComponent(currentComposeFile)}`;
        console.log(`Loading compose file from: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (result.content) {
            // Use editor if available
            if (window.updateCodeMirrorContent) {
                window.updateCodeMirrorContent('compose-editor', result.content);
            } else {
                document.getElementById('compose-editor').value = result.content;
            }
            currentComposeFile = result.file;
            document.getElementById('compose-files').value = currentComposeFile;
            showMessage('success', `Loaded compose file: ${currentComposeFile}`);
        } else {
            console.error('Failed to load compose file:', result.message);
            showMessage('error', result.message || 'Failed to load compose file');
            
            // If the file has a specific extension, try the alternate extension
            if (currentComposeFile.endsWith('.yml') || currentComposeFile.endsWith('.yaml')) {
                const basePathWithoutExt = currentComposeFile.substring(0, currentComposeFile.lastIndexOf('.'));
                const altExt = currentComposeFile.endsWith('.yml') ? '.yaml' : '.yml';
                const altPath = basePathWithoutExt + altExt;
                
                console.log(`Trying alternate extension: ${altPath}`);
                try {
                    const altUrl = `/api/compose?file=${encodeURIComponent(altPath)}`;
                    const altResponse = await fetch(altUrl);
                    const altResult = await altResponse.json();
                    
                    if (altResult.status === 'success' && altResult.content) {
                        // Use editor if available
                        if (window.updateCodeMirrorContent) {
                            window.updateCodeMirrorContent('compose-editor', altResult.content);
                        } else {
                            document.getElementById('compose-editor').value = altResult.content;
                        }
                        currentComposeFile = altResult.file;
                        document.getElementById('compose-files').value = currentComposeFile;
                        showMessage('success', `Loaded compose file: ${currentComposeFile}`);
                    } else {
                        throw new Error('Alternate extension also failed');
                    }
                } catch (altError) {
                    console.error('Failed with alternate extension:', altError);
                    showMessage('error', 'Failed to load compose file with either extension');
                }
            }
        }
    } catch (error) {
        console.error('Failed to load compose file:', error);
        showMessage('error', `Failed to load compose file: ${error.message}`);
        
        // If this is immich and we're having trouble, try a more direct approach
        if (currentComposeFile.includes('immich')) {
            console.log('Special handling for immich load failure');
            let pathToTry = currentComposeFile;
            
            if (currentComposeFile.startsWith('../')) {
                // Try without the ../
                pathToTry = currentComposeFile.substring(3);
                console.log(`Trying direct path: ${pathToTry}`);
                
                try {
                    const directUrl = `/api/compose?file=${encodeURIComponent(pathToTry)}`;
                    const directResponse = await fetch(directUrl);
                    const directResult = await directResponse.json();
                    
                    if (directResult.status === 'success' && directResult.content) {
                        // Use editor if available
                        if (window.updateCodeMirrorContent) {
                            window.updateCodeMirrorContent('compose-editor', directResult.content);
                        } else {
                            document.getElementById('compose-editor').value = directResult.content;
                        }
                        showMessage('success', `Loaded ${pathToTry} directly`);
                    }
                } catch (directError) {
                    console.error('Direct load also failed:', directError);
                }
            }
        }
    } finally {
        setLoading(false);
    }
}

// 2. Update saveCompose function
async function saveCompose() {
    if (!currentComposeFile) {
        showMessage('error', 'Please select a compose file');
        return;
    }
    try {
        setLoading(true, 'Saving compose file...');
        
        // Get content from editor if available
        const content = window.getCodeMirrorContent ? 
            window.getCodeMirrorContent('compose-editor') : 
            document.getElementById('compose-editor').value;
            
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

function composeAction(action, file = null) {
    // Use provided file or fall back to currentComposeFile
    const composeFile = file || currentComposeFile;
    
    if (!composeFile) {
        showMessage('error', 'Please select a compose file');
        return;
    }
   
    if (action !== 'restart') {
        showMessage('error', 'Only restart action is supported');
        return;
    }
   
    // Create a modal for the pull option
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Restart ${composeFile}</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <p>Do you want to pull the latest images before restarting?</p>
            <div class="actions" style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
                <button class="btn btn-success" onclick="executeComposeRestart(true, '${composeFile}')">Yes, pull latest images</button>
                <button class="btn btn-primary" onclick="executeComposeRestart(false, '${composeFile}')">No, use existing images</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function executeComposeRestart(pullImages, file = null) {
    // Use provided file or fall back to currentComposeFile
    const composeFile = file || currentComposeFile;
    
    // Close any open modals
    document.querySelectorAll('.logs-modal').forEach(modal => modal.remove());
    
    setLoading(true, `Restarting compose services...`);
    fetch('/api/compose/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            file: composeFile,
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
                
                // Check for pending env file
                const pendingEnvFile = sessionStorage.getItem('pendingEnvFile');
                if (pendingEnvFile) {
                    console.log('Found pending env file:', pendingEnvFile);
                    sessionStorage.removeItem('pendingEnvFile');
                    
                    // Try to find and select the file
                    let found = false;
                    for (let i = 0; i < select.options.length; i++) {
                        if (select.options[i].value === pendingEnvFile) {
                            select.value = pendingEnvFile;
                            currentEnvFile = pendingEnvFile;
                            found = true;
                            loadEnvFile();
                            break;
                        }
                    }
                    
                    if (!found) {
                        // Add it if not found
                        const option = document.createElement('option');
                        option.value = pendingEnvFile;
                        option.textContent = pendingEnvFile;
                        select.appendChild(option);
                        select.value = pendingEnvFile;
                        currentEnvFile = pendingEnvFile;
                        loadEnvFile();
                    }
                }
                
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

// 3. Update loadEnvFile function
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
                // Use editor if available
                if (window.updateCodeMirrorContent) {
                    window.updateCodeMirrorContent('env-editor', data.content);
                } else {
                    document.getElementById('env-editor').value = data.content;
                }
                showMessage('success', `Loaded .env file: ${currentEnvFile}`);
            } else {
                const errorContent = `# Failed to load ${currentEnvFile}\n# Error: ${data.message}\n\n# You can create a new .env file here`;
                if (window.updateCodeMirrorContent) {
                    window.updateCodeMirrorContent('env-editor', errorContent);
                } else {
                    document.getElementById('env-editor').value = errorContent;
                }
                showMessage('error', data.message);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to load .env file:', error);
            const errorContent = `# Failed to load ${currentEnvFile}\n# Error: ${error}\n\n# You can create a new .env file here`;
            if (window.updateCodeMirrorContent) {
                window.updateCodeMirrorContent('env-editor', errorContent);
            } else {
                document.getElementById('env-editor').value = errorContent;
            }
            showMessage('error', 'Failed to load .env file');
        });
}

// 4. Update saveEnvFile function
function saveEnvFile() {
    if (!currentEnvFile) {
        showMessage('error', 'No .env file selected');
        return;
    }
    setLoading(true, 'Saving .env file...');
    
    // Get content from editor if available
    const content = window.getCodeMirrorContent ? 
        window.getCodeMirrorContent('env-editor') : 
        document.getElementById('env-editor').value;
        
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

// 5. Update loadCaddyFile function
function loadCaddyFile() {
    setLoading(true, 'Loading Caddyfile...');
    fetch('/api/caddy/file')
        .then(response => response.json())
        .then(data => {
            setLoading(false);
            if (data.status === 'success') {
                // Use editor if available
                if (window.updateCodeMirrorContent) {
                    window.updateCodeMirrorContent('caddy-editor', data.content);
                } else {
                    document.getElementById('caddy-editor').value = data.content;
                }
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

// 6. Update saveCaddyFile function
function saveCaddyFile() {
    setLoading(true, 'Saving Caddyfile...');
    
    // Get content from editor if available
    const content = window.getCodeMirrorContent ? 
        window.getCodeMirrorContent('caddy-editor') : 
        document.getElementById('caddy-editor').value;
        
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

// 7. Update saveCaddyFileAndReload function
function saveCaddyFileAndReload() {
    setLoading(true, 'Saving and reloading Caddyfile...');
    
    // Get content from editor if available
    const content = window.getCodeMirrorContent ? 
        window.getCodeMirrorContent('caddy-editor') : 
        document.getElementById('caddy-editor').value;
        
    fetch('/api/caddy/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            content: content,
            reload: true
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

// Update loadImages function to render both views
function loadImages() {
    setLoading(true, 'Loading images...');
    fetch('/api/images')
        .then(response => response.json())
        .then(images => {
            setLoading(false);
            
            // Render grid view
            const imagesList = document.getElementById('images-list');
            imagesList.innerHTML = '';
            
            // Render table view
            const tableBody = document.getElementById('images-table-body');
            if (tableBody) {
                tableBody.innerHTML = '';
            }
            
            if (!images.length) {
                imagesList.innerHTML = '<div class="no-containers">No images found.</div>';
                if (tableBody) {
                    tableBody.innerHTML = '<tr><td colspan="6" class="no-containers">No images found.</td></tr>';
                }
                return;
            }
            
            images.forEach(image => {
                // Grid view card
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
                
                // Table view row
                if (tableBody) {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${image.name}</td>
                        <td>${image.tags.join(', ')}</td>
                        <td>${image.size} MB</td>
                        <td>${image.created}</td>
                        <td>${isUsed ? image.used_by.join(', ') : 'None'}</td>
                        <td>
                            <button onclick="removeImage('${image.id}')" class="btn btn-error" ${isUsed ? 'disabled' : ''}>Remove</button>
                        </td>
                    `;
                    tableBody.appendChild(row);
                }
            });
            
            // Apply saved view preference
            const savedImageView = localStorage.getItem('imageViewPreference');
            if (savedImageView === 'table') {
                document.getElementById('images-grid-view').classList.remove('active');
                document.getElementById('images-table-view').classList.add('active');
                document.getElementById('toggle-image-view').textContent = '⋮⋮';
            }
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

        // Use compose_file directory as the stack name
        if (container.compose_file) {
            // Extract the first meaningful directory from the path
            const pathParts = container.compose_file.split('/').filter(p => p.length > 0);
            
            // Skip common system directories that aren't likely to be stack names
            const systemDirs = ['home', 'var', 'opt', 'usr', 'etc', 'mnt', 'srv', 'data', 'app', 'docker'];
            
            for (const part of pathParts) {
                // Skip system directories
                if (!systemDirs.includes(part.toLowerCase())) {
                    return part;
                }
            }
            
            // If all parts were system dirs, use the last directory
            if (pathParts.length > 0) {
                return pathParts[pathParts.length - 2] || pathParts[0];
            }
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
        
        stackFilter.innerHTML = '<option value="">Stacks</option>';
        stackFilterMobile.innerHTML = '<option value="">Stacks</option>';

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

        // Render each stack with its containers
        Object.keys(stackContainers).sort().forEach(async stackName => {
            const stackGroup = stackContainers[stackName];
            const stats = {
                total: stackGroup.length,
                running: stackGroup.filter(c => c.status === 'running').length,
                cpu: stackGroup.reduce((sum, c) => sum + (parseFloat(c.cpu_percent) || 0), 0).toFixed(1),
                memory: Math.round(stackGroup.reduce((sum, c) => sum + (parseFloat(c.memory_usage) || 0), 0))
            };
            
            const composeFile = findComposeFileForStack(stackGroup);

            // Create stack header
            const stackHeader = document.createElement('div');
            stackHeader.className = 'stack-header';
            stackHeader.innerHTML = `
                <h3>${stackName}</h3>
                <div class="stack-stats">
                    <span title="Container count">${stats.running}/${stats.total} running</span>
                    <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                    <span title="Total memory usage">Mem: ${stats.memory} MB</span>
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); showStackDetailsModal('${stackName}', '${composeFile || ''}')">
                        🐳
                    </button>
                </div>
            `;

            // Remove the old click handler that wasn't working
            // Add a proper event listener if compose file exists
            if (composeFile) {
                stackHeader.style.cursor = 'pointer';
                stackHeader.title = "Click to open compose file";
                // Add click event to the header, but not the button
                stackHeader.addEventListener('click', (e) => {
                    // Don't trigger if clicking the details button
                    if (!e.target.closest('button')) {
                        openComposeInEditor(composeFile);
                    }
                });
            }

            list.appendChild(stackHeader);

            // Render the containers for this stack
            stackGroup.sort((a, b) => a.name.localeCompare(b.name));
            stackGroup.forEach(container => {
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
function showStackDetailsModal(stackName, composeFile) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>${stackName} Compose Details</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <div class="stack-details-content">
                <p>Loading compose resources...</p>
            </div>
            <div class="stack-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                ${composeFile ? `
                    <button class="btn btn-primary" onclick="document.querySelectorAll('.logs-modal').forEach(m => m.remove()); openComposeInEditor('${composeFile}')">
                        Edit Compose File
                    </button>
                    <button class="btn btn-success" onclick="composeAction('restart', '${composeFile}')">
                        Restart
                    </button>
                ` : ''}
                <button class="btn btn-error" onclick="this.closest('.logs-modal').remove()">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Load stack resources
    getStackResources(stackName)
        .then(resources => {
            const detailsContent = modal.querySelector('.stack-details-content');
            
            // Group mounts by type
            const bindMounts = resources.mounts.filter(m => m.type === 'bind');
            const volumeMounts = resources.mounts.filter(m => m.type === 'volume');
            
            detailsContent.innerHTML = `
                <div class="stack-resources" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div class="resource-section">
                        <h4>Mounts (${resources.mounts.length})</h4>
                        <div style="max-height: 200px; overflow-y: auto;">
                            ${bindMounts.length > 0 ? `
                                <h5 style="margin: 0.5rem 0; font-size: 0.9rem;">Bind Mounts</h5>
                                <ul style="list-style: none; padding: 0; margin: 0 0 1rem 0;">
                                    ${bindMounts.map(m => `
                                        <li style="padding: 0.25rem 0; color: var(--text-secondary); font-size: 0.85rem;">
                                            <div style="font-weight: 500;">${m.container}</div>
                                            <div style="margin-left: 1rem; font-size: 0.8rem;">
                                                ${m.source} → ${m.destination} (${m.mode})
                                            </div>
                                        </li>
                                    `).join('')}
                                </ul>
                            ` : ''}
                            
                            ${volumeMounts.length > 0 ? `
                                <h5 style="margin: 0.5rem 0; font-size: 0.9rem;">Volume Mounts</h5>
                                <ul style="list-style: none; padding: 0; margin: 0;">
                                    ${volumeMounts.map(m => `
                                        <li style="padding: 0.25rem 0; color: var(--text-secondary); font-size: 0.85rem;">
                                            <div style="font-weight: 500;">${m.container}</div>
                                            <div style="margin-left: 1rem; font-size: 0.8rem;">
                                                ${m.source} → ${m.destination} (${m.mode})
                                            </div>
                                        </li>
                                    `).join('')}
                                </ul>
                            ` : ''}
                            
                            ${resources.mounts.length === 0 ? 
                                '<p style="font-style: italic; color: var(--text-secondary);">No mounts</p>' : 
                            ''}
                        </div>
                    </div>
                    <div class="resource-section">
                        <h4>Networks (${resources.networks.length})</h4>
                        <ul style="list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto;">
                            ${resources.networks.length > 0
                                ? resources.networks.map(n => `
                                    <li style="padding: 0.25rem 0; color: var(--text-secondary); font-size: 0.85rem;">
                                        ${n.name}
                                        ${n.external ? `<span style="color: var(--accent-warning)"> • external</span>` : ''}
                                    </li>
                                `).join('')
                                : '<li style="font-style: italic; color: var(--text-secondary);">No custom networks</li>'
                            }
                        </ul>
                    </div>
                </div>
                
                ${resources.envFile || resources.images.length > 0 ? `
                    <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                        ${resources.envFile ? `
                            <div style="margin-bottom: 1rem;">
                                <h4>Environment Configuration</h4>
                                <p style="color: var(--text-secondary); font-size: 0.85rem;">
                                    .env file: ${resources.envFile}
                                    <button class="btn btn-primary btn-sm" style="margin-left: 1rem;" onclick="document.querySelectorAll('.logs-modal').forEach(m => m.remove()); openEnvInEditor('${resources.envFile}')">
                                        Edit .env
                                    </button>
                                </p>
                            </div>
                        ` : ''}
                        
                        ${resources.images.length > 0 ? `
                            <div>
                                <h4>Images (${resources.images.length})</h4>
                                <ul style="list-style: none; padding: 0; margin: 0; max-height: 150px; overflow-y: auto;">
                                    ${resources.images.map(img => `
                                        <li style="padding: 0.25rem 0; color: var(--text-secondary); font-size: 0.85rem;">
                                            ${img.name} 
                                            <span style="color: var(--text-secondary);">• ${img.size} MB</span>
                                            <span style="color: var(--text-secondary);">• ${img.created}</span>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
            `;
        })
        .catch(error => {
            console.error('Failed to load stack resources:', error);
            const detailsContent = modal.querySelector('.stack-details-content');
            detailsContent.innerHTML = `
                <p style="color: var(--accent-error);">Failed to load stack resources</p>
                <p style="color: var(--text-secondary); font-size: 0.85rem;">${error.message || 'Unknown error'}</p>
            `;
        });
}
// Add this helper function to open env file in editor
function openEnvInEditor(envFile) {
    // Switch to config tab first
    switchTab('config');
    
    setTimeout(() => {
        // Switch to env subtab (not compose!)
        switchSubTab('env');
        
        // Wait a bit more for the env files to load
        setTimeout(() => {
            const envSelect = document.getElementById('env-files');
            if (envSelect) {
                // Check if the file is already in the dropdown
                let found = false;
                for (let i = 0; i < envSelect.options.length; i++) {
                    if (envSelect.options[i].value === envFile) {
                        envSelect.value = envFile;
                        currentEnvFile = envFile;
                        found = true;
                        loadEnvFile(); // Load the content
                        break;
                    }
                }
                
                if (!found) {
                    // If not in dropdown, first scan for env files
                    console.log('Env file not in dropdown, scanning for env files...');
                    
                    // Store the pending env file
                    sessionStorage.setItem('pendingEnvFile', envFile);
                    
                    // Scan for env files
                    scanEnvFiles();
                }
            }
        }, 100);
    }, 100);
}
// New helper functions
async function getStackResources(stackName) {
    try {
        // Get all resources in parallel
        const [volumes, networks, containers, images, envFiles] = await Promise.all([
            fetch('/api/volumes').then(r => r.json()),
            fetch('/api/networks').then(r => r.json()),
            fetch('/api/containers').then(r => r.json()),
            fetch('/api/images').then(r => r.json()),
            fetch('/api/env/files').then(r => r.json())
        ]);

        // Filter containers for this stack
        const stackContainers = containers.filter(c => 
            window.extractStackName(c) === stackName
        );

        // Get mount information - including bind mounts
        const allMounts = [];
        const volumeMounts = {};
        
        // Fetch detailed container info to get mounts
        for (const container of stackContainers) {
            try {
                const response = await fetch(`/api/container/${container.id}/inspect`);
                const data = await response.json();
                
                if (data.status === 'success' && data.data.Mounts) {
                    data.data.Mounts.forEach(mount => {
                        // Add all mounts to our list
                        allMounts.push({
                            container: container.name,
                            type: mount.Type,
                            source: mount.Source,
                            destination: mount.Destination,
                            mode: mount.Mode || 'rw'
                        });
                        
                        // Track volume mounts separately
                        if (mount.Type === 'volume') {
                            const volumeName = mount.Name;
                            if (!volumeMounts[volumeName]) {
                                volumeMounts[volumeName] = [];
                            }
                            volumeMounts[volumeName].push({
                                container: container.name,
                                destination: mount.Destination,
                                mode: mount.Mode || 'rw'
                            });
                        }
                    });
                }
            } catch (e) {
                console.warn(`Failed to get mounts for container ${container.name}:`, e);
            }
        }

        // Filter volumes that belong to this stack
        const stackVolumes = volumes.filter(v => {
            return v.name.startsWith(stackName + '_') || 
                   (v.labels && v.labels['com.docker.compose.project'] === stackName);
        });

        // Filter networks
        const stackNetworks = networks.filter(n => {
            if (['bridge', 'host', 'none'].includes(n.name)) return false;
            return n.name.startsWith(stackName + '_') || 
                   n.name === stackName + '_default' ||
                   (n.labels && n.labels['com.docker.compose.project'] === stackName);
        });

        // Find .env file
        const envFile = (envFiles.files || []).find(f => {
            return f.includes(`/${stackName}/.env`) || 
                   f.includes(`${stackName}/.env`) ||
                   f.endsWith(`/${stackName}/.env`);
        });

        // Get images used by stack
        const stackImages = [];
        const imageSet = new Set();
        
        stackContainers.forEach(container => {
            if (container.image) {
                const matchingImage = images.find(img => 
                    img.tags.includes(container.image) || 
                    container.image.includes(img.name.split(':')[0])
                );
                if (matchingImage && !imageSet.has(matchingImage.name)) {
                    imageSet.add(matchingImage.name);
                    stackImages.push({
                        name: matchingImage.name,
                        size: matchingImage.size,
                        created: matchingImage.created
                    });
                }
            }
        });

        return {
            volumes: stackVolumes.map(v => ({
                name: v.name.replace(stackName + '_', ''),
                driver: v.driver,
                mountpoint: v.mountpoint,
                in_use: v.in_use,
                mounts: volumeMounts[v.name] || []
            })),
            mounts: allMounts, // All mounts including bind mounts
            networks: stackNetworks.map(n => ({
                name: n.name.replace(stackName + '_', ''),
                driver: n.driver,
                external: n.external || false
            })),
            envFile: envFile,
            images: stackImages
        };
    } catch (error) {
        console.error('Error getting stack resources:', error);
        throw error;
    }
}

// Improved openComposeInEditor function that tries multiple file variants
function openComposeInEditor(composeFile) {
    console.log('Opening compose file:', composeFile);
    
    if (!composeFile) {
        showMessage('error', 'No compose file specified');
        return;
    }
    
    // Clear any previous pending file immediately
    localStorage.removeItem('pendingComposeFile');
    
    // Store the file to load after switching tabs
    localStorage.setItem('pendingComposeFile', composeFile);
    
    // Switch to config tab and compose subtab
    switchTab('config');
    
    // Use setTimeout to ensure the tab switch completes
    setTimeout(() => {
        // Switch to compose subtab
        switchSubTab('compose');
        
        // Wait a bit more for the compose files to load
        setTimeout(() => {
            const select = document.getElementById('compose-files');
            if (select) {
                // Check if the file is already in the dropdown
                let found = false;
                for (let i = 0; i < select.options.length; i++) {
                    if (select.options[i].value === composeFile) {
                        select.value = composeFile;
                        currentComposeFile = composeFile;
                        found = true;
                        loadCompose(); // Load the content
                        break;
                    }
                }
                
                if (!found) {
                    // If file not in dropdown, try loading compose files first
                    console.log('File not in dropdown, loading compose files...');
                    loadComposeFiles();
                }
            }
        }, 100);
    }, 100);
}
// Try each variant in sequence until one works
function tryNextVariant(variants, index) {
    if (index >= variants.length) {
        console.log('All variants failed, scanning for compose files...');
        showMessage('info', 'Searching for compose files...');
        scanComposeFiles();
        return;
    }
    
    const currentVariant = variants[index];
    console.log(`Trying variant ${index + 1}/${variants.length}: ${currentVariant}`);
    
    fetch(`/api/compose?file=${encodeURIComponent(currentVariant)}`)
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success') {
                document.getElementById('compose-editor').value = result.content;
                currentComposeFile = result.file;
                
                // Update dropdown if possible
                const composeSelect = document.getElementById('compose-files');
                if (composeSelect) {
                    // Find or add the option
                    let found = false;
                    for (let i = 0; i < composeSelect.options.length; i++) {
                        if (composeSelect.options[i].value === result.file) {
                            composeSelect.selectedIndex = i;
                            found = true;
                            break;
                        }
                    }
                    
                    if (!found) {
                        const newOption = document.createElement('option');
                        newOption.value = result.file;
                        newOption.textContent = result.file;
                        composeSelect.appendChild(newOption);
                        composeSelect.value = result.file;
                    }
                }
                
                showMessage('success', `Loaded compose file: ${result.file}`);
            } else {
                // Try the next variant
                tryNextVariant(variants, index + 1);
            }
        })
        .catch(error => {
            console.error(`Error loading variant ${currentVariant}:`, error);
            tryNextVariant(variants, index + 1);
        });
}
// 8. Update directLoadCompose function - COMPLETE VERSION
function directLoadCompose(composePath) {
    console.log(`Attempting direct load of ${composePath}`);
    
    return new Promise((resolve, reject) => {
        // If the path starts with ../, extract the real path
        const realPath = composePath.startsWith('../') ? composePath.substring(3) : composePath;
        
        fetch(`/api/compose?file=${encodeURIComponent(realPath)}`)
            .then(response => response.json())
            .then(result => {
                if (result.status === 'success') {
                    // Use editor if available
                    if (window.updateCodeMirrorContent) {
                        window.updateCodeMirrorContent('compose-editor', result.content);
                    } else {
                        document.getElementById('compose-editor').value = result.content;
                    }
                    currentComposeFile = composePath; // Use the original path for consistency
                    
                    // Add to dropdown if not present
                    const select = document.getElementById('compose-files');
                    if (select) {
                        const options = Array.from(select.options).map(opt => opt.value);
                        if (!options.includes(composePath)) {
                            const newOption = document.createElement('option');
                            newOption.value = composePath;
                            newOption.textContent = composePath;
                            select.appendChild(newOption);
                        }
                        select.value = composePath;
                    }
                    
                    showMessage('success', `Loaded compose file: ${composePath}`);
                    resolve(result);
                } else {
                    console.log(`Direct load failed for ${composePath}: ${result.message}`);
                    reject(new Error(result.message || 'Failed to load compose file'));
                }
            })
            .catch(error => {
                console.error(`Error loading ${composePath}:`, error);
                reject(error);
            });
    });
}

// Initialize with a more robust approach
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded");
    
    // Initialize theme
    loadTheme();
    loadDockerHosts();
    // Set stack as default grouping
    const groupFilter = document.getElementById('group-filter');
    const groupFilterMobile = document.getElementById('group-filter-mobile');
    if (groupFilter) groupFilter.value = 'stack';
    if (groupFilterMobile) groupFilterMobile.value = 'stack';
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
    setTimeout(() => {
        loadViewPreference();
    }, 100);

});