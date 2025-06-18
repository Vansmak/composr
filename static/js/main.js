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
    console.log('Toggle filter menu');
}

// View preference functions - moved from table-view.js
function saveViewPreference(viewType) {
    localStorage.setItem('preferredView', viewType);
    console.log('Saved view preference:', viewType);
}

function loadViewPreference() {
    const savedView = localStorage.getItem('preferredView');
    console.log('Loaded view preference:', savedView);
    
    if (savedView === 'table') {
        const gridView = document.getElementById('grid-view');
        const tableView = document.getElementById('table-view');
        const toggleButton = document.getElementById('toggle-view');
        
        if (gridView && tableView && toggleButton) {
            gridView.classList.remove('active');
            tableView.classList.add('active');
            
            toggleButton.textContent = '≡';
            toggleButton.title = 'Switch to Grid View';
            
            // Update filter controls for table view
            updateFilterControlsForView();
            
            // Ensure table structure
            setTimeout(() => {
                if (window.ensureTableStructure) {
                    window.ensureTableStructure();
                }
            }, 100);
        }
    } else {
        // Default to grid view
        const gridView = document.getElementById('grid-view');
        const tableView = document.getElementById('table-view');
        const toggleButton = document.getElementById('toggle-view');
        
        if (gridView && tableView && toggleButton) {
            tableView.classList.remove('active');
            gridView.classList.add('active');
            
            toggleButton.textContent = '⋮⋮';
            toggleButton.title = 'Switch to Table View';
            
            updateFilterControlsForView();
        }
    }
}
// Load hosts for create tab (similar to compose)
function loadCreateHosts() {
    fetch('/api/hosts')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('create-deploy-host');
            if (!select) return;
            
            // Keep the first two options, add hosts after
            const firstTwoOptions = Array.from(select.options).slice(0, 2);
            select.innerHTML = '';
            
            // Re-add first two options
            firstTwoOptions.forEach(option => select.appendChild(option));
            
            if (data.status === 'success' && data.hosts) {
                Object.entries(data.hosts).forEach(([hostName, hostInfo]) => {
                    if (hostName !== 'local' && hostInfo.connected) {
                        const option = document.createElement('option');
                        option.value = hostName;
                        option.textContent = hostInfo.name || hostName;
                        select.appendChild(option);
                    }
                });
            }
        })
        .catch(error => {
            console.error('Failed to load hosts for create:', error);
        });
}
// 1. Add this new function to load hosts
function loadComposeHosts() {
    fetch('/api/hosts')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('compose-host-select');
            if (!select) return;
            
            select.innerHTML = '<option value="local">Local Docker</option>';
            
            if (data.status === 'success' && data.hosts) {
                Object.entries(data.hosts).forEach(([hostName, hostInfo]) => {
                    if (hostName !== 'local' && hostInfo.connected) {
                        const option = document.createElement('option');
                        option.value = hostName;
                        option.textContent = hostInfo.name || hostName;
                        select.appendChild(option);
                    }
                });
            }
        })
        .catch(error => {
            console.error('Failed to load hosts:', error);
        });
}

// View toggle function - FIXED VERSION
function toggleView() {
    const gridView = document.getElementById('grid-view');
    const tableView = document.getElementById('table-view');
    const toggleButton = document.getElementById('toggle-view');
    const filterControls = document.querySelector('.filter-controls');
    
    if (!gridView || !tableView || !toggleButton) {
        console.error('Required view elements not found');
        return;
    }
    
    // Prevent multiple rapid clicks
    if (toggleButton.disabled) {
        console.log('Toggle button disabled, ignoring click');
        return;
    }
    
    toggleButton.disabled = true;
    setTimeout(() => {
        toggleButton.disabled = false;
    }, 500);
    
    const isCurrentlyGrid = gridView.classList.contains('active');
    console.log('Current view is grid:', isCurrentlyGrid);
    
    if (isCurrentlyGrid) {
        // Switch to table view
        console.log('Switching to table view');
        
        // Clear any existing classes first
        gridView.classList.remove('active');
        tableView.classList.remove('active');
        
        // Force a small delay to ensure DOM updates
        setTimeout(() => {
            tableView.classList.add('active');
            saveViewPreference('table');
            
            toggleButton.textContent = '≡';
            toggleButton.title = 'Switch to Grid View';
            
            // Keep filter controls visible but hide sort dropdown
            if (filterControls) {
                filterControls.style.display = 'flex';
            }
            updateFilterControlsForView();
            
            // Ensure table structure
            if (window.ensureTableStructure) {
                window.ensureTableStructure();
            }
            if (window.updateTableHeaders) {
                window.updateTableHeaders();
            }
            
            // Render table with current data
            const containers = window.lastContainerData || [];
            if (containers.length > 0 && window.renderContainersAsTable) {
                console.log('Rendering cached containers in table view');
                window.renderContainersAsTable(containers);
            } else {
                console.log('No cached data, refreshing containers');
                refreshContainers();
            }
        }, 50);
        
    } else {
        // Switch to grid view
        console.log('Switching to grid view');
        
        // Clear any existing classes first
        tableView.classList.remove('active');
        gridView.classList.remove('active');
        
        // Force a small delay to ensure DOM updates
        setTimeout(() => {
            gridView.classList.add('active');
            saveViewPreference('grid');
            
            toggleButton.textContent = '⋮⋮';
            toggleButton.title = 'Switch to Table View';
            
            // Restore filter controls
            if (filterControls) {
                filterControls.style.display = 'flex';
            }
            updateFilterControlsForView();
            
            refreshContainers();
        }, 50);
    }
}

// 2. REPLACE your existing composeAction function with this:
function composeAction(action, file = null) {
    const composeFile = file || currentComposeFile;
    if (!composeFile) {
        showMessage('error', 'No compose file selected');
        return;
    }
    
    // Get selected host
    const hostSelect = document.getElementById('compose-host-select');
    const selectedHost = hostSelect ? hostSelect.value : 'local';
    
    // Confirm remote deployment
    if (selectedHost !== 'local') {
        if (!confirm(`Deploy to ${selectedHost}?\n\nAction: ${action}\nFile: ${composeFile}`)) {
            return;
        }
    }
    
    setLoading(true, `${action}ing on ${selectedHost}...`);
    
    if (selectedHost !== 'local') {
        // Use multi-host endpoint
        fetch('/api/compose/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: composeFile,
                host: selectedHost,
                action: action === 'restart' ? 'up' : action,
                pull: action === 'restart'
            })
        })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', `Success on ${selectedHost}`);
                if (typeof refreshContainers === 'function') {
                    refreshContainers();
                }
            } else {
                showMessage('error', result.message);
            }
        })
        .catch(error => {
            setLoading(false);
            showMessage('error', `Failed: ${error.message}`);
        });
    } else {
        // Use existing local deployment
        fetch('/api/compose/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                file: composeFile, 
                pull: action === 'restart'
            })
        })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', result.message);
                if (typeof refreshContainers === 'function') {
                    refreshContainers();
                }
            } else {
                showMessage('error', result.message);
            }
        })
        .catch(error => {
            setLoading(false);
            showMessage('error', `Failed: ${error.message}`);
        });
    }
}

// Filter controls update function - moved from table-view.js
function updateFilterControlsForView() {
    const tableView = document.getElementById('table-view');
    const filterControls = document.querySelector('.filter-controls');
    const sortFilter = document.getElementById('sort-filter');
    const sortFilterMobile = document.getElementById('sort-filter-mobile');
    const toggleButton = document.getElementById('toggle-view');
    
    // Ensure toggle button is always visible and properly configured
    if (toggleButton) {
        toggleButton.style.display = 'inline-block';
        toggleButton.style.visibility = 'visible';
        
        // Make sure the button has the correct event listener
        toggleButton.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleView();
        };
    }
    
    // Always keep filter controls visible
    if (filterControls) {
        filterControls.style.display = 'flex';
        filterControls.style.visibility = 'visible';
    }
    
    if (tableView && tableView.classList.contains('active')) {
        // Table view - hide sort dropdown (headers handle sorting)
        if (sortFilter) sortFilter.style.display = 'none';
        if (sortFilterMobile) sortFilterMobile.style.display = 'none';
        
        // Update toggle button for table view
        if (toggleButton) {
            toggleButton.textContent = '≡';
            toggleButton.title = 'Switch to Grid View';
        }
    } else {
        // Grid view - show sort dropdown
        if (sortFilter) sortFilter.style.display = '';
        if (sortFilterMobile) sortFilterMobile.style.display = '';
        
        // Update toggle button for grid view
        if (toggleButton) {
            toggleButton.textContent = '⋮⋮';
            toggleButton.title = 'Switch to Table View';
        }
    }
}

// Initialize view controls
function initializeViewControls() {
    updateFilterControlsForView();
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
        // Load image view preference when switching to images tab
        loadImageViewPreference();
        
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            loadImages();
            addImageHostSelector(); 
        }, 100);
    
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

function switchSubTab(subtabName) {
    document.querySelectorAll('.subtab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.subtab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`.subtab[onclick="switchSubTab('${subtabName}')"]`).classList.add('active');
    document.getElementById(`${subtabName}-subtab`).classList.add('active');
   
    if (subtabName === 'compose') {
        loadComposeFiles();
        // Add this line to load templates when switching to compose tab
        if (window.loadTemplates) window.loadTemplates();
        // ADD THIS LINE:
        setTimeout(() => loadComposeHosts(), 100);

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
        
        // ADD THIS ONE LINE:
        setTimeout(() => loadCreateHosts(), 100);
        
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
        // Hide env file creation
        setTimeout(() => {
            const envFileOptions = document.getElementById('env-file-options');
            const createEnvCheckbox = document.getElementById('create-env-file');
            
            if (envFileOptions) envFileOptions.style.display = 'none';
            if (createEnvCheckbox) {
                createEnvCheckbox.checked = false;
                const label = createEnvCheckbox.closest('label');
                if (label) label.style.display = 'none';
            }
        }, 100);
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
    // Cache container data for view switching
    window.lastContainerData = containers;
    
    const gridView = document.getElementById('grid-view');
    const tableView = document.getElementById('table-view');
    const noContainers = document.getElementById('no-containers');
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    
    // Clear existing content
    const containersList = document.getElementById('containers-list');
    if (containersList) {
        containersList.innerHTML = '';
    }
    
    if (tableView) {
        const tableBody = document.getElementById('table-body');
        if (tableBody) {
            tableBody.innerHTML = '';
        }
    }

    if (!Array.isArray(containers) || !containers.length) {
        noContainers.style.display = 'block';
        return;
    }

    noContainers.style.display = 'none';

    // Collect filter options
    let allTags = new Set();
    let allStacks = new Set();
    let allHosts = new Set();
    
    containers.forEach(container => {
        if (container.tags && Array.isArray(container.tags)) {
            container.tags.forEach(tag => allTags.add(tag));
        }
        allStacks.add(extractStackName(container));
        allHosts.add(container.host || 'local');
    });

    // Determine which view is currently active
    const isTableViewActive = tableView && tableView.classList.contains('active');
    
    // Choose rendering method based on active view
    if (isTableViewActive) {
        console.log('Rendering containers as table');
        if (window.ensureTableStructure) window.ensureTableStructure();
        if (window.renderContainersAsTable) {
            window.renderContainersAsTable(containers);
        } else {
            console.error('renderContainersAsTable function not available');
        }
    } else {
        console.log('Rendering containers as grid');
        const group = document.getElementById('group-filter').value || document.getElementById('group-filter-mobile').value || 'none';
        
        if (group === 'stack') {
            renderContainersByStack(containers);
        } else if (group === 'host') {
            renderContainersByHost(containers);
        } else {
            // Sort and render containers
            const sort = document.getElementById('sort-filter').value || document.getElementById('sort-filter-mobile').value || 'name';
            
            if (sort === 'name') {
                containers.sort((a, b) => a.name.localeCompare(b.name));
            } else if (sort === 'cpu') {
                containers.sort((a, b) => (b.cpu_percent || 0) - (a.cpu_percent || 0));
            } else if (sort === 'memory') {
                containers.sort((a, b) => (b.memory_usage || 0) - (a.memory_usage || 0));
            } else if (sort === 'uptime') {
                containers.sort((a, b) => {
                    const aMinutes = a.uptime ? a.uptime.minutes : 0;
                    const bMinutes = b.uptime ? b.uptime.minutes : 0;
                    return bMinutes - aMinutes;
                });
            } else if (sort === 'host') {
                containers.sort((a, b) => {
                    const hostA = a.host || 'local';
                    const hostB = b.host || 'local';
                    return hostA.localeCompare(hostB) || a.name.localeCompare(b.name);
                });
            }

            containers.forEach(container => {
                renderSingleContainer(container, containersList);
            });
        }
    }

    // Update filter options
    updateTagFilterOptions(Array.from(allTags));
    updateStackFilterOptions(Array.from(allStacks));
    updateHostFilterOptions(Array.from(allHosts));
    
    console.log(`Rendered ${containers.length} containers`);
}

// Enhanced filter options update functions
function updateHostFilterOptions(hosts) {
    const hostFilter = document.getElementById('host-filter');
    const hostFilterMobile = document.getElementById('host-filter-mobile');
    
    if (!hostFilter) {
        // Create host filter if it doesn't exist
        createHostFilter();
        return;
    }
    
    const currentValue = hostFilter.value || (hostFilterMobile ? hostFilterMobile.value : '');
    
    hostFilter.innerHTML = '<option value="">All Hosts</option>';
    if (hostFilterMobile) {
        hostFilterMobile.innerHTML = '<option value="">All Hosts</option>';
    }
    
    hosts.sort().forEach(host => {
        const option = document.createElement('option');
        option.value = host;
        option.textContent = host;
        if (host === currentValue) option.selected = true;
        hostFilter.appendChild(option);
        
        if (hostFilterMobile) {
            const optionMobile = document.createElement('option');
            optionMobile.value = host;
            optionMobile.textContent = host;
            if (host === currentValue) optionMobile.selected = true;
            hostFilterMobile.appendChild(optionMobile);
        }
    });
}

function createHostFilter() {
    // Add host filter to desktop filter controls
    const filtersContainer = document.querySelector('.filters-container');
    if (filtersContainer && !document.getElementById('host-filter')) {
        const hostFilter = document.createElement('select');
        hostFilter.id = 'host-filter';
        hostFilter.className = 'filter-select';
        hostFilter.innerHTML = '<option value="">Host</option>';
        
        // Add event listener
        hostFilter.addEventListener('change', () => {
            const hostFilterMobile = document.getElementById('host-filter-mobile');
            if (hostFilterMobile) {
                hostFilterMobile.value = hostFilter.value;
            }
            refreshContainers();
        });
        
        // Insert after stack filter
        const stackFilter = document.getElementById('stack-filter');
        if (stackFilter) {
            stackFilter.parentNode.insertBefore(hostFilter, stackFilter.nextSibling);
        } else {
            filtersContainer.appendChild(hostFilter);
        }
    }
    
    // Add host filter to mobile filter menu
    const filterMenu = document.getElementById('filter-menu');
    if (filterMenu && !document.getElementById('host-filter-mobile')) {
        const hostFilterMobile = document.createElement('select');
        hostFilterMobile.id = 'host-filter-mobile';
        hostFilterMobile.className = 'filter-select';
        hostFilterMobile.innerHTML = '<option value="">All Hosts</option>';
        
        // Add event listener
        hostFilterMobile.addEventListener('change', () => {
            const hostFilter = document.getElementById('host-filter');
            if (hostFilter) {
                hostFilter.value = hostFilterMobile.value;
            }
            refreshContainers();
        });
        
        // Insert after stack filter mobile
        const stackFilterMobile = document.getElementById('stack-filter-mobile');
        if (stackFilterMobile) {
            stackFilterMobile.parentNode.insertBefore(hostFilterMobile, stackFilterMobile.nextSibling);
        } else {
            filterMenu.appendChild(hostFilterMobile);
        }
    }
}

// Enhanced system stats for multi-host
function loadSystemStatsMultiHost() {
    fetch('/api/system/overview')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                // Update totals in header
                const totalContainersGrid = document.getElementById('total-containers-grid');
                const runningContainers = document.getElementById('running-containers');
                const cpuCountGrid = document.getElementById('cpu-count-grid');
                const memoryTotalGrid = document.getElementById('memory-total-grid');
                const connectedHostsGrid = document.getElementById('connected-hosts-grid');
                const connectedHosts = document.getElementById('connected-hosts');
                const totalContainers = document.getElementById('total-containers');
                const cpuCount = document.getElementById('cpu-count');
                const memoryTotal = document.getElementById('memory-total');
                
                if (totalContainersGrid) totalContainersGrid.textContent = data.totals.total_containers || '--';
                if (runningContainers) runningContainers.textContent = data.totals.total_running || '--';
                if (cpuCountGrid) cpuCountGrid.textContent = data.totals.total_cpu_cores || '--';
                if (memoryTotalGrid) memoryTotalGrid.textContent = `${data.totals.total_memory_gb || '--'} GB`;
                if (connectedHostsGrid) connectedHostsGrid.textContent = data.totals.connected_hosts || '--';
                if (connectedHosts) connectedHosts.textContent = data.totals.connected_hosts || '--';
                if (totalContainers) totalContainers.textContent = data.totals.total_containers || '--';
                if (cpuCount) cpuCount.textContent = data.totals.total_cpu_cores || '--';
                if (memoryTotal) memoryTotal.textContent = `${data.totals.total_memory_gb || '--'} GB`;
                
                // Update memory usage calculation (simplified for multi-host)
                const memoryUsageGrid = document.getElementById('memory-usage-grid');
                const memoryUsage = document.getElementById('memory-usage');
                if (memoryUsageGrid) memoryUsageGrid.textContent = '-- MB'; // We'd need more detailed stats
                if (memoryUsage) memoryUsage.textContent = '-- MB';
                
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

// New function to render containers grouped by host
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
        
        // Get host display name
        const hostDisplay = hostContainers[0]?.host_display || host;
        
        hostHeader.innerHTML = `
            <h3>${hostDisplay}</h3>
            <div class="stack-stats">
                <span title="Container count">${stats.running}/${stats.total} running</span>
                <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                <span title="Total memory usage">Mem: ${stats.memory} MB</span>
                <button class="btn btn-secondary btn-sm" onclick="showHostDetailsModal('${host}')">
                    🖥️
                </button>
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
// Add host selector to images tab
function addImageHostSelector() {
    const imageActions = document.querySelector('.image-actions');
    if (imageActions && !document.getElementById('image-host-select')) {
        const hostSelector = document.createElement('select');
        hostSelector.id = 'image-host-select';
        hostSelector.className = 'filter-select';
        hostSelector.style.marginRight = '0.5rem';
        hostSelector.innerHTML = '<option value="">All Hosts</option>';
        
        // Add to the beginning of image actions
        imageActions.insertBefore(hostSelector, imageActions.firstChild);
        
        // Load hosts
        loadImageHosts();
        
        // Add change listener
        hostSelector.addEventListener('change', () => {
            loadImages(); // Reload images when host filter changes
        });
    }
}

// Load hosts for image filtering
function loadImageHosts() {
    fetch('/api/hosts')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('image-host-select');
            if (!select) return;
            
            // Keep "All Hosts" option
            select.innerHTML = '<option value="">All Hosts</option>';
            
            if (data.status === 'success' && data.hosts) {
                Object.entries(data.hosts).forEach(([hostName, hostInfo]) => {
                    if (hostInfo.connected) {
                        const option = document.createElement('option');
                        option.value = hostName;
                        option.textContent = hostInfo.name || hostName;
                        select.appendChild(option);
                    }
                });
            }
        })
        .catch(error => {
            console.error('Failed to load hosts for images:', error);
        });
}

// Enhanced image operations with host support
function getSelectedImageHost() {
    const hostSelect = document.getElementById('image-host-select');
    return hostSelect ? hostSelect.value || 'local' : 'local';
}
function renderImageCard(image, container) {
    const imageCard = document.createElement('div');
    imageCard.className = 'image-card';
    
    const isUsed = image.used_by && image.used_by.length > 0;
    const hostDisplay = image.host_display || image.host || 'local';
    
    imageCard.innerHTML = `
        <div class="image-header">
            <span class="image-name">${image.name}</span>
            <span class="image-size">${image.size} MB</span>
            <span class="host-badge-small">${hostDisplay}</span>
        </div>
        <div class="image-body">
            <div class="image-created">Created: ${image.created}</div>
            <div class="image-tags">${image.tags.join(', ')}</div>
            <div class="image-used-by">Used by: ${isUsed ? image.used_by.join(', ') : 'None'}</div>
            <div class="actions">
                <button onclick="removeImage('${image.id}', '${image.host}')" class="btn btn-error" ${isUsed ? 'disabled' : ''}>Remove</button>
            </div>
        </div>
    `;
    container.appendChild(imageCard);
}

// Host details modal
function showHostDetailsModal(host) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>${host} Host Details</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <div class="host-details-content">
                <p>Loading host information...</p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Load host details
    fetch(`/api/system/${host}`)
        .then(response => response.json())
        .then(data => {
            const detailsContent = modal.querySelector('.host-details-content');
            if (data.status === 'success') {
                detailsContent.innerHTML = `
                    <div class="host-info">
                        <h4>System Information</h4>
                        <div class="detail-row"><strong>Total Containers:</strong> ${data.total_containers}</div>
                        <div class="detail-row"><strong>Running Containers:</strong> ${data.running_containers}</div>
                        <div class="detail-row"><strong>CPU Cores:</strong> ${data.cpu_count}</div>
                        <div class="detail-row"><strong>Total Memory:</strong> ${data.memory_total} MB</div>
                        <div class="detail-row"><strong>Docker Version:</strong> ${data.docker_version}</div>
                    </div>
                `;
            } else {
                detailsContent.innerHTML = `<p style="color: var(--accent-error);">Failed to load host details: ${data.message}</p>`;
            }
        })
        .catch(error => {
            const detailsContent = modal.querySelector('.host-details-content');
            detailsContent.innerHTML = `<p style="color: var(--accent-error);">Error loading host details: ${error.message}</p>`;
        });
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

// Update group filter options
function updateGroupFilterOptions() {
    const groupFilter = document.getElementById('group-filter');
    const groupFilterMobile = document.getElementById('group-filter-mobile');
    
    if (groupFilter) {
        groupFilter.innerHTML = `
            <option value="none">Group by</option>
            <option value="stack">Stack</option>
            <option value="host">Host</option>
        `;
    }
    
    if (groupFilterMobile) {
        groupFilterMobile.innerHTML = `
            <option value="none">Group by</option>
            <option value="stack">Stack</option>
            <option value="host">Host</option>
        `;
    }
}

// Remove tag filter functionality
function removeTagFilters() {
    // Hide tag filter elements
    const tagFilter = document.getElementById('tag-filter');
    const tagFilterMobile = document.getElementById('tag-filter-mobile');
    
    if (tagFilter) tagFilter.style.display = 'none';
    if (tagFilterMobile) tagFilterMobile.style.display = 'none';
    
    // Remove tag filter from table controls
    const tableControls = document.getElementById('table-filter-controls');
    if (tableControls) {
        const tagSelects = tableControls.querySelectorAll('select');
        tagSelects.forEach(select => {
            if (select.innerHTML.includes('Tags')) {
                select.remove();
            }
        });
    }
}

function renderSingleContainer(container, parentElement) {
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    const card = document.createElement('div');
    card.className = 'container-card';
    card.dataset.id = container.id;
    card.dataset.host = container.host || 'local';
    card.dataset.cpu = container.cpu_percent;
    card.dataset.memory = container.memory_usage;
    const uptimeDisplay = container.uptime && container.uptime.display ? container.uptime.display : 'N/A';

    // CRITICAL FIX: Ensure host is properly passed
    const containerHost = container.host || 'local';
    console.log(`Rendering container ${container.name} with host: ${containerHost}`);

    // Create ports HTML
    let portsHtml = '';
    if (container.ports && Object.keys(container.ports).length > 0) {
        const portsList = Object.entries(container.ports)
            .map(([hostPort, containerPort]) => `${hostPort}:${containerPort}`)
            .slice(0, 3)
            .join(', ');
        
        const remainingPorts = Object.keys(container.ports).length - 3;
        const portsText = remainingPorts > 0 ? `${portsList} +${remainingPorts} more` : portsList;
        
        portsHtml = `<div class="container-ports" title="Port mappings">${portsText}</div>`;
    } else {
        portsHtml = '<div class="container-ports" title="No exposed ports">No ports</div>';
    }

    // Get host display
    const hostDisplay = container.host_display || container.host || 'local';

    card.innerHTML = `
        <div class="container-header">
            <span class="container-name" onclick="openCustomContainerURL('${container.id}', '${containerHost}')" title="${container.name}">${container.name}</span>
            <div class="container-header-right">
                <span class="host-badge-small">${hostDisplay}</span>
                <span class="container-status status-${container.status === 'running' ? 'running' : 'stopped'}">${container.status}</span>
                <span class="uptime-badge">${uptimeDisplay}</span>
                <button class="btn btn-primary" onclick="showContainerPopup('${container.id}', '${container.name}', '${containerHost}')">...</button>
            </div>
        </div>
        <div class="container-body">
            ${portsHtml}
            <div class="actions">
                <button class="btn btn-success" onclick="containerAction('${container.id}', 'start', '${containerHost}')" ${container.status === 'running' ? 'disabled' : ''}>Start</button>
                <button class="btn btn-error" onclick="containerAction('${container.id}', 'stop', '${containerHost}')" ${container.status !== 'running' ? 'disabled' : ''}>Stop</button>
                <button class="btn btn-primary" onclick="containerAction('${container.id}', 'restart', '${containerHost}')" ${container.status !== 'running' ? 'disabled' : ''}>Restart</button>
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
    
    if (!gridView || !tableView || !toggleButton) {
        console.error('Image view elements not found');
        return;
    }
    
    // Prevent multiple rapid clicks
    if (toggleButton.disabled) {
        return;
    }
    
    toggleButton.disabled = true;
    setTimeout(() => {
        toggleButton.disabled = false;
    }, 300);
    
    const isCurrentlyGrid = gridView.classList.contains('active');
    console.log('Current image view is grid:', isCurrentlyGrid);
    
    if (isCurrentlyGrid) {
        // Switch to table view
        console.log('Switching images to table view');
        gridView.classList.remove('active');
        tableView.classList.add('active');
        toggleButton.textContent = '≡';
        toggleButton.title = 'Switch to Grid View';
        localStorage.setItem('imageViewPreference', 'table');
    } else {
        // Switch to grid view
        console.log('Switching images to grid view');
        tableView.classList.remove('active');
        gridView.classList.add('active');
        toggleButton.textContent = '⋮⋮';
        toggleButton.title = 'Switch to Table View';
        localStorage.setItem('imageViewPreference', 'grid');
    }
    
    // Ensure images table structure exists before loading
    if (tableView.classList.contains('active')) {
        ensureImagesTableStructure();
    }
    
    // Reload images in the new view
    loadImages();
}

// Update refreshContainers to always load from all hosts
async function refreshContainers(sortKey = null, sortDirection = 'asc') {
    try {
        setLoading(true, 'Loading containers from all hosts...');

        const tableView = document.getElementById('table-view');
        const filterControls = document.querySelector('.filter-controls');
        
        // Don't hide filter controls - keep them visible
        if (filterControls) {
            filterControls.style.display = 'flex';
        }
        
        // Update filter controls based on current view
        updateFilterControlsForView();
        
        const search = document.getElementById('search-input').value || '';
        const status = document.getElementById('status-filter').value || document.getElementById('status-filter-mobile').value || '';
        const tag = document.getElementById('tag-filter').value || document.getElementById('tag-filter-mobile').value || '';
        const stack = document.getElementById('stack-filter').value || document.getElementById('stack-filter-mobile').value || '';
        const host = document.getElementById('host-filter') ? document.getElementById('host-filter').value : '';
        const group = document.getElementById('group-filter').value || document.getElementById('group-filter-mobile').value || 'none';
        
        const sort = sortKey || document.getElementById('sort-filter').value || document.getElementById('sort-filter-mobile').value || 'name';

        // Always get from all hosts - no specific host parameter
        const url = `/api/containers?search=${encodeURIComponent(search)}&status=${status}&tag=${encodeURIComponent(tag)}&stack=${encodeURIComponent(stack)}&host=${encodeURIComponent(host)}&sort=${sort}&direction=${sortDirection}&nocache=${Date.now()}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const containers = await response.json();
        
        renderContainers(containers);
        loadSystemStatsMultiHost(); // Load unified system stats

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

// Enhanced container actions with host context
async function containerAction(id, action, host = 'local') {
    console.log('🔥 containerAction called with:', { id, action, host });
    try {
        const response = await fetch(`/api/container/${id}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: host })
        });
        
        const result = await response.json();
        if (result.status === 'success') {
            showMessage('success', `Container ${action}ed successfully on ${host}`);
            refreshContainers();
        } else {
            showMessage('error', `${action} failed on ${host}: ${result.message}`);
        }
    } catch (error) {
        showMessage('error', `Failed to ${action} container on ${host}: ${error.message}`);
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
// Create one function that handles both "Create Project" and "Create & Deploy"

async function createAndDeployProject() {
    try {
        // Get form data
        const projectName = document.getElementById('project-name')?.value;
        const location = document.getElementById('project-location')?.value || 'default';
        const composeContent = window.getCodeMirrorContent ? 
            window.getCodeMirrorContent('compose-content') : 
            document.getElementById('compose-content')?.value || '';
        const deployHost = document.getElementById('create-deploy-host')?.value || '';
        
        if (!projectName) {
            showMessage('error', 'Project name is required');
            return false;
        }
        
        console.log('Creating project with deploy host:', deployHost);
        
        // Step 1: Create the project (no .env file creation)
        setLoading(true, 'Creating project...');
        
        const response = await fetch('/api/compose/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_name: projectName,
                location_type: location,
                compose_content: composeContent,
                env_content: '',  // No env content
                create_env_file: false  // Don't create .env file
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            const composePath = `${projectName}/docker-compose.yml`;
            
            // Show immediate success for project creation
            showMessage('success', `✅ Project "${projectName}" created successfully!`);
            
            // Step 2: Deploy if requested
            if (deployHost && deployHost !== '') {
                console.log(`Deploying project to ${deployHost}...`);
                
                setLoading(true, `Deploying to ${deployHost}...`);
                
                try {
                    const deployResponse = await fetch('/api/compose/deploy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            file: composePath,
                            host: deployHost,
                            action: 'up',
                            pull: false
                        })
                    });
                    
                    const deployResult = await deployResponse.json();
                    
                    if (deployResult.status === 'success') {
                        showMessage('success', `🚀 Project created and deployed to ${deployHost} successfully!`);
                        
                        // Refresh containers to show new deployment
                        if (typeof refreshContainers === 'function') {
                            setTimeout(() => refreshContainers(), 2000);
                        }
                    } else {
                        showMessage('warning', `⚠️ Project created but deployment to ${deployHost} failed: ${deployResult.message}`);
                    }
                } catch (deployError) {
                    console.error('Deploy error:', deployError);
                    showMessage('warning', `⚠️ Project created but deployment to ${deployHost} failed: ${deployError.message}`);
                }
            } else {
                // No deployment requested
                showMessage('success', `✅ Project "${projectName}" created successfully! Go to Compose tab to edit or deploy.`);
            }
            
            setLoading(false);
            
            // Clear the form for next project
            setTimeout(() => {
                document.getElementById('project-name').value = '';
                if (window.updateCodeMirrorContent) {
                    window.updateCodeMirrorContent('compose-content', '');
                } else {
                    document.getElementById('compose-content').value = '';
                }
                
                // Reset to step 1 for next project
                if (typeof goToStep === 'function') {
                    goToStep(1);
                }
            }, 3000);
            
            return true;
        } else {
            setLoading(false);
            showMessage('error', `❌ Failed to create project: ${result.message}`);
            return false;
        }
        
    } catch (error) {
        console.error('Create project error:', error);
        setLoading(false);
        showMessage('error', `❌ Failed to create project: ${error.message}`);
        return false;
    }
}

// Remove .env file creation from the UI until figure it out
function hideEnvFileCreation() {
    const envFileOptions = document.getElementById('env-file-options');
    const createEnvCheckbox = document.getElementById('create-env-file');
    
    if (envFileOptions) {
        envFileOptions.style.display = 'none';
    }
    
    if (createEnvCheckbox) {
        createEnvCheckbox.checked = false;
        createEnvCheckbox.style.display = 'none';
        
        // Hide the label too
        const label = createEnvCheckbox.closest('label');
        if (label) {
            label.style.display = 'none';
        }
    }
}

// Enhanced showMessage function to handle longer messages
function showMessage(type, text) {
    const message = document.getElementById('message');
    message.className = `message ${type}`;
    message.textContent = text;
    message.style.display = 'block';
    
    // Longer timeout for success messages, shorter for errors
    const timeout = type === 'success' ? 4000 : 6000;
    setTimeout(() => message.style.display = 'none', timeout);
}

// Make both buttons call the same function
function createProject() {
    return createAndDeployProject();
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

// Enhanced container popup with host information
function showContainerPopup(id, name, host = 'local') {
    Promise.all([
        fetch(`/api/container/${id}/get_tags?host=${encodeURIComponent(host)}`),
        fetch(`/api/container/${id}/custom_url?host=${encodeURIComponent(host)}`),
        fetch(`/api/container/${id}/inspect?host=${encodeURIComponent(host)}`)
    ])
    .then(responses => Promise.all(responses.map(r => r.json())))
    .then(([tagData, urlData, inspectData]) => {
        const tags = tagData.tags || [];
        const customUrl = urlData.url || '';
        
        let portsInfo = 'No exposed ports';
        if (inspectData.status === 'success') {
            const portBindings = inspectData.data.HostConfig?.PortBindings || {};
            if (Object.keys(portBindings).length > 0) {
                const portsList = Object.entries(portBindings)
                    .map(([containerPort, hostConfig]) => {
                        if (hostConfig && hostConfig[0] && hostConfig[0].HostPort) {
                            return `${hostConfig[0].HostPort}:${containerPort}`;
                        }
                        return containerPort;
                    })
                    .join(', ');
                portsInfo = portsList;
            }
        }
        
        const popup = document.createElement('div');
        popup.className = 'logs-modal';
        popup.innerHTML = `
            <div class="modal-header">
                <h3>${name} <span class="host-badge-small">${host}</span></h3>
                <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
            </div>

            <div class="container-details" style="margin-bottom: 1rem;">
                <div class="detail-row">
                    <strong>Host:</strong> ${host}
                </div>
                <div class="detail-row">
                    <strong>Stats:</strong> CPU: <span id="popup-cpu-${id}">Loading...</span>% | Memory: <span id="popup-memory-${id}">Loading...</span> MB
                </div>
                <div class="detail-row">
                    <strong>Ports:</strong> ${portsInfo}
                </div>
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
                <button class="btn btn-primary" onclick="saveContainerSettings('${id}', '${name}', '${host}')">Save Settings</button>
            </div>
            <div class="actions">
                <button class="btn btn-primary" onclick="viewContainerLogs('${id}', '${host}')">Logs</button>
                <button class="btn btn-primary" onclick="inspectContainer('${id}', '${host}')">Inspect</button>
                <button class="btn btn-primary" onclick="execIntoContainer('${id}', '${name}', '${host}')">Terminal</button>
                <button class="btn btn-primary" onclick="repullContainer('${id}', '${host}')">Repull</button>
                <button class="btn btn-error" onclick="removeContainer('${id}', '${name}', '${host}')">Remove</button>
            </div>
        `;
        document.body.appendChild(popup);
        
        // Load stats in the popup
        const container = document.querySelector(`[data-id="${id}"]`);
        if (container) {
            document.getElementById(`popup-cpu-${id}`).textContent = container.dataset.cpu || '0';
            document.getElementById(`popup-memory-${id}`).textContent = container.dataset.memory || '0';
        }
    })
    .catch(error => {
        console.error('Error getting container settings:', error);
        showMessage('error', 'Failed to load container settings');
    });
}

// Update the terminal function to pass host
function execIntoContainer(id, name, host = 'local') {
    const modal = document.createElement('div');
    modal.className = 'logs-modal terminal-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Terminal: ${name} <span class="host-badge-small">${host}</span></h3>
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
                
                executeCommand(id, command, host);
                input.value = '';
            }
        });
    }, 100);
}

function executeCommand(id, command, host = 'local') {
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
        body: JSON.stringify({ 
            command: command,
            host: host
        })
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

async function saveContainerSettings(id, name, host = 'local') {
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
    
    try {
        const response = await fetch(`/api/container/${id}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tags: tags,
                custom_url: customUrl,
                host: host
            })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            showMessage('success', 'Container settings saved');
            document.querySelectorAll('.logs-modal').forEach(modal => modal.remove());
            refreshContainers();
        } else {
            showMessage('error', data.message || 'Failed to save settings');
        }
    } catch (error) {
        console.error('Error saving container settings:', error);
        showMessage('error', 'Failed to save container settings');
    }
}

// Enhanced container operations with host support
async function viewContainerLogs(id, host = 'local') {
    try {
        const response = await fetch(`/api/container/${id}/logs?host=${encodeURIComponent(host)}`);
        const result = await response.json();
        if (result.status === 'success') {
            const modal = document.createElement('div');
            modal.className = 'logs-modal';
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>Logs for Container ${id} <span class="host-badge-small">${host}</span></h3>
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

async function inspectContainer(id, host = 'local') {
    try {
        const response = await fetch(`/api/container/${id}/inspect?host=${encodeURIComponent(host)}`);
        const result = await response.json();
        if (result.status === 'success') {
            const modal = document.createElement('div');
            modal.className = 'logs-modal';
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>Inspect for Container ${id} <span class="host-badge-small">${host}</span></h3>
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

function removeContainer(id, name, host = 'local') {
    if (confirm(`Are you sure you want to remove container ${name} from ${host}? This action cannot be undone.`)) {
        fetch(`/api/container/${id}/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: host })
        })
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success') {
                showMessage('success', `Container ${name} removed from ${host}`);
                document.querySelectorAll('.logs-modal').forEach(popup => popup.remove());
                refreshContainers();
            } else {
                showMessage('error', `Failed to remove container from ${host}: ${result.message}`);
            }
        })
        .catch(error => {
            console.error('Error removing container:', error);
            showMessage('error', `Failed to remove container from ${host}: ${error.message}`);
        });
    }
}

async function repullContainer(id, host = 'local') {
    if (!confirm('Are you sure you want to repull this container? This will stop and remove the current container and start a new one with the latest image.')) {
        return;
    }
    
    try {
        setLoading(true, `Repulling container on ${host}...`);
        const response = await fetch(`/api/container/${id}/repull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: host })
        });
        const result = await response.json();
        if (result.status === 'success') {
            showMessage('success', `Container repulled successfully on ${host}`);
            refreshContainers();
        } else {
            showMessage('error', `Repull failed on ${host}: ${result.message}`);
        }
    } catch (error) {
        showMessage('error', `Failed to repull container on ${host}: ${error.message}`);
    } finally {
        setLoading(false);
    }
}

// Update toggleBatchMode to work consistently for both views
function toggleBatchMode() {
    const containersList = document.getElementById('containers-list');
    const batchActions = document.getElementById('batch-actions');
    const tableView = document.getElementById('table-view');
    const toggleButton = document.getElementById('toggle-batch-mode');
    
    if (!containersList) {
        console.error('Containers list not found');
        return;
    }
    
    // Prevent multiple rapid clicks
    if (toggleButton && toggleButton.disabled) {
        return;
    }
    
    if (toggleButton) {
        toggleButton.disabled = true;
        setTimeout(() => {
            toggleButton.disabled = false;
        }, 300);
    }
    
    // Toggle batch mode class
    const isBatchMode = containersList.classList.toggle('batch-mode');
    console.log('Batch mode toggled:', isBatchMode);
    
    // Update toggle button appearance
    if (toggleButton) {
        toggleButton.classList.toggle('active', isBatchMode);
    }
    
    // Show/hide batch actions (same for both views)
    if (batchActions) {
        batchActions.classList.toggle('visible', isBatchMode);
    }
    
    // Handle table view specific batch mode
    if (tableView && tableView.classList.contains('active')) {
        tableView.classList.toggle('batch-mode', isBatchMode);
        
        // Show/hide checkboxes in table
        const checkboxes = document.querySelectorAll('.batch-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.style.display = isBatchMode ? 'inline-block' : 'none';
        });
        
        // Show/hide select-all checkbox
        const selectAll = document.getElementById('select-all');
        if (selectAll) {
            selectAll.style.display = isBatchMode ? 'inline-block' : 'none';
        }
    } else {
        // Grid view - add checkboxes to cards
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
            // Remove checkboxes when leaving batch mode
            document.querySelectorAll('.container-select').forEach(checkbox => {
                checkbox.remove();
            });
        }
    }
    
    // Clear selections when leaving batch mode
    if (!isBatchMode) {
        document.querySelectorAll('.container-card.selected, #table-view tr.selected').forEach(item => {
            item.classList.remove('selected');
        });
        
        document.querySelectorAll('.container-select, .batch-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });
    }
    
    console.log('Batch mode toggle completed');
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

    setLoading(true, `Processing ${selectedItems.length} containers across hosts...`);

    // Group by host and collect container info
    const containersByHost = {};
    const containerHosts = {}; // Map container ID to host
    
    Array.from(selectedItems).forEach(item => {
        const containerId = item.dataset.id;
        const host = item.dataset.host || 'local';
        
        containerHosts[containerId] = host;
        
        if (!containersByHost[host]) {
            containersByHost[host] = [];
        }
        containersByHost[host].push(containerId);
    });

    // Send batch request with host information
    fetch(`/api/batch/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            containers: Object.keys(containerHosts),
            container_hosts: containerHosts // New format: map container ID to host
        })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        
        if (result.status === 'success' || result.status === 'partial') {
            showMessage(result.status === 'success' ? 'success' : 'warning', result.message);
            refreshContainers();
        } else {
            showMessage('error', result.message);
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
                       
                        // Try direct load as last resort
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

function showStackDetailsModal(stackName, composeFile, hostName = 'local') {
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>${stackName} Stack Details <span class="host-badge-small">${hostName}</span></h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <div class="stack-details-content">
                <p>Loading stack resources...</p>
            </div>
            <div class="stack-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                ${composeFile ? `
                    <button class="btn btn-primary" onclick="document.querySelectorAll('.logs-modal').forEach(m => m.remove()); openComposeInEditor('${composeFile}')">
                        Edit Compose File
                    </button>
                    <button class="btn btn-success" onclick="composeActionWithHost('restart', '${composeFile}', '${hostName}')">
                        Restart
                    </button>
                    <button class="btn btn-error" onclick="composeActionWithHost('down', '${composeFile}', '${hostName}')">
                        Stop
                    </button>
                ` : ''}
                <button class="btn btn-error" onclick="this.closest('.logs-modal').remove()">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Load stack resources with host context
    getStackResources(stackName, hostName)
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

// 2. Add new compose action function that handles host
function composeActionWithHost(action, file, host = 'local') {
    if (!file) {
        showMessage('error', 'No compose file specified');
        return;
    }
    
    console.log(`Executing compose ${action} on ${file} for host ${host}`);
    
    // Confirm remote deployment
    if (host !== 'local') {
        if (!confirm(`Execute ${action} on ${host}?\n\nFile: ${file}`)) {
            return;
        }
    }
    
    // Close any open modals
    document.querySelectorAll('.logs-modal').forEach(modal => modal.remove());
    
    setLoading(true, `${action}ing stack on ${host}...`);
    
    if (host !== 'local') {
        // Use multi-host endpoint
        fetch('/api/compose/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: file,
                host: host,
                action: action === 'restart' ? 'up' : action,
                pull: action === 'restart'
            })
        })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', `Stack ${action}ed successfully on ${host}`);
                if (typeof refreshContainers === 'function') {
                    refreshContainers();
                }
            } else {
                showMessage('error', `${action} failed on ${host}: ${result.message}`);
            }
        })
        .catch(error => {
            setLoading(false);
            showMessage('error', `Failed to ${action} stack on ${host}: ${error.message}`);
        });
    } else {
        // Use existing local deployment
        const endpoint = action === 'down' ? '/api/compose/stop' : '/api/compose/apply';
        const body = action === 'down' ? 
            { file: file, action: 'down' } : 
            { file: file, pull: action === 'restart' };
            
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', `Stack ${action}ed successfully`);
                if (typeof refreshContainers === 'function') {
                    refreshContainers();
                }
            } else {
                showMessage('error', `${action} failed: ${result.message}`);
            }
        })
        .catch(error => {
            setLoading(false);
            showMessage('error', `Failed to ${action} stack: ${error.message}`);
        });
    }
}

// 3. Fix getStackResources to work with multi-host
async function getStackResources(stackName, hostName = 'local') {
    try {
        console.log(`Getting stack resources for ${stackName} on ${hostName}`);
        
        // Build URLs with host parameter for remote hosts
        const hostParam = hostName !== 'local' ? `?host=${encodeURIComponent(hostName)}` : '';
        
        // Get all resources in parallel - with host context
        const [volumes, networks, containers, images, envFiles] = await Promise.all([
            fetch(`/api/volumes${hostParam}`).then(r => r.json()).catch(() => []),
            fetch(`/api/networks${hostParam}`).then(r => r.json()).catch(() => []),
            fetch(`/api/containers${hostParam}`).then(r => r.json()).catch(() => []),
            fetch(`/api/images${hostParam}`).then(r => r.json()).catch(() => []),
            fetch('/api/env/files').then(r => r.json()).catch(() => ({files: []}))
        ]);

        console.log(`Found ${containers.length} containers for stack analysis`);

        // Filter containers for this stack and host
        const stackContainers = containers.filter(c => {
            const containerStack = window.extractStackName(c);
            const containerHost = c.host || 'local';
            return containerStack === stackName && containerHost === hostName;
        });

        console.log(`Filtered to ${stackContainers.length} containers for stack ${stackName} on ${hostName}`);

        // Get mount information - including bind mounts
        const allMounts = [];
        const volumeMounts = {};
        
        // Fetch detailed container info to get mounts
        for (const container of stackContainers) {
            try {
                const inspectUrl = `/api/container/${container.id}/inspect${hostParam}`;
                const response = await fetch(inspectUrl);
                const data = await response.json();
                
                if (data.status === 'success' && data.data.Mounts) {
                    data.data.Mounts.forEach(mount => {
                        // Add all mounts to our list
                        allMounts.push({
                            container: container.name,
                            type: mount.Type,
                            source: mount.Source || mount.Name,
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
                console.warn(`Failed to get mounts for container ${container.name} on ${hostName}:`, e);
            }
        }

        // Filter volumes that belong to this stack
        const stackVolumes = Array.isArray(volumes) ? volumes.filter(v => {
            return v.name.startsWith(stackName + '_') || 
                   (v.labels && v.labels['com.docker.compose.project'] === stackName);
        }) : [];

        // Filter networks
        const stackNetworks = Array.isArray(networks) ? networks.filter(n => {
            if (['bridge', 'host', 'none'].includes(n.name)) return false;
            return n.name.startsWith(stackName + '_') || 
                   n.name === stackName + '_default' ||
                   (n.labels && n.labels['com.docker.compose.project'] === stackName);
        }) : [];

        // Find .env file
        const envFile = (envFiles.files || []).find(f => {
            return f.includes(`/${stackName}/.env`) || 
                   f.includes(`${stackName}/.env`) ||
                   f.endsWith(`/${stackName}/.env`);
        });

        // Get images used by stack
        const stackImages = [];
        const imageSet = new Set();
        
        if (Array.isArray(images)) {
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
        }

        const result = {
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

        console.log(`Stack resources result:`, result);
        return result;
        
    } catch (error) {
        console.error(`Error getting stack resources for ${stackName} on ${hostName}:`, error);
        throw error;
    }
}

// 4. Update renderContainersByStack to pass host information
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
            const stackName = window.extractStackName(container);
            const hostName = container.host || 'local';
            const stackKey = `${stackName}@${hostName}`; // Include host in grouping
            
            allStacks.add(stackName);
            
            if (!stackContainers[stackKey]) {
                stackContainers[stackKey] = {
                    containers: [],
                    stackName: stackName,
                    hostName: hostName,
                    hostDisplay: container.host_display || hostName
                };
            }
            stackContainers[stackKey].containers.push(container);
            
            if (container.tags && Array.isArray(container.tags)) {
                container.tags.forEach(tag => allTags.add(tag));
            }
        });

        // Render each stack with its containers
        Object.keys(stackContainers).sort().forEach(stackKey => {
            const stackData = stackContainers[stackKey];
            const stackGroup = stackData.containers;
            const stackName = stackData.stackName;
            const hostName = stackData.hostName;
            const hostDisplay = stackData.hostDisplay;
            
            const stats = {
                total: stackGroup.length,
                running: stackGroup.filter(c => c.status === 'running').length,
                cpu: stackGroup.reduce((sum, c) => sum + (parseFloat(c.cpu_percent) || 0), 0).toFixed(1),
                memory: Math.round(stackGroup.reduce((sum, c) => sum + (parseFloat(c.memory_usage) || 0), 0))
            };
            
            const composeFile = window.findComposeFileForStack(stackGroup);

            // Create stack header with host information
            const stackHeader = document.createElement('div');
            stackHeader.className = 'stack-header';
            stackHeader.innerHTML = `
                <h3>${stackName} <span class="host-badge-small">${hostDisplay}</span></h3>
                <div class="stack-stats">
                    <span title="Container count">${stats.running}/${stats.total} running</span>
                    <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                    <span title="Total memory usage">Mem: ${stats.memory} MB</span>
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); showStackDetailsModal('${stackName}', '${composeFile || ''}', '${hostName}')">
                        🐳
                    </button>
                </div>
            `;

            // Add click event to open compose file if available
            if (composeFile) {
                stackHeader.style.cursor = 'pointer';
                stackHeader.title = "Click to open compose file";
                stackHeader.addEventListener('click', (e) => {
                    if (!e.target.closest('button')) {
                        openComposeInEditor(composeFile);
                    }
                });
            }

            list.appendChild(stackHeader);

            // Render the containers for this stack
            stackGroup.sort((a, b) => a.name.localeCompare(b.name));
            stackGroup.forEach(container => {
                renderSingleContainer(container, list);
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

function pruneImages() {
    const hostSelect = document.getElementById('image-host-select');
    const selectedHost = hostSelect ? hostSelect.value : '';
    
    if (!selectedHost || selectedHost === '') {
        showMessage('error', 'Please select a specific host to prune images on');
        return;
    }
    
    if (!confirm(`Are you sure you want to prune unused images on ${selectedHost}? This will remove all dangling images that are not referenced by any containers.`)) {
        return;
    }
    
    setLoading(true, `Pruning unused images on ${selectedHost}...`);
    fetch('/api/images/prune', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: selectedHost })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message || 'Images pruned successfully');
            loadImages();
        } else {
            showMessage('error', result.message || 'Failed to prune images');
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to prune images:', error);
        showMessage('error', 'Failed to prune images: ' + error.message);
    });
}

function removeUnusedImages() {
    const hostSelect = document.getElementById('image-host-select');
    const selectedHost = hostSelect ? hostSelect.value : '';
    
    if (!selectedHost || selectedHost === '') {
        showMessage('error', 'Please select a specific host to remove unused images from');
        return;
    }
    
    if (!confirm(`Are you sure you want to remove all unused images on ${selectedHost}? This will remove images that are not currently used by any containers.`)) {
        return;
    }
    
    const forceRemove = confirm('Force removal? This is needed for images used in multiple repositories.\n\nClick OK for force remove, Cancel for safe remove only.');
    
    setLoading(true, `Removing unused images on ${selectedHost}...`);
    fetch(`/api/images/remove_unused?force=${forceRemove}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: selectedHost })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message || 'Unused images removed successfully');
            loadImages();
        } else {
            showMessage('error', result.message || 'Failed to remove unused images');
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to remove unused images:', error);
        showMessage('error', 'Failed to remove unused images: ' + error.message);
    });
}

function removeImage(id, host = 'local') {
    if (!confirm(`Are you sure you want to remove this image from ${host}?`)) {
        return;
    }
    
    const forceRemove = confirm('Force removal? This is needed for images used in multiple repositories.\n\nClick OK for force remove, Cancel for safe remove only.');
    
    setLoading(true, `Removing image from ${host}...`);
    fetch(`/api/images/${id}/remove?force=${forceRemove}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message || 'Image removed successfully');
            loadImages(); // Refresh the images list
        } else {
            showMessage('error', result.message || 'Failed to remove image');
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to remove image:', error);
        showMessage('error', 'Failed to remove image: ' + error.message);
    });
}

// Enhanced loadImages function with host filtering and sorting
function loadImages() {
    setLoading(true, 'Loading images from all hosts...');
    
    const selectedHost = getSelectedImageHost();
    const hostFilter = selectedHost && selectedHost !== '' ? `?host=${encodeURIComponent(selectedHost)}` : '';
    
    fetch(`/api/images${hostFilter}`)
        .then(response => response.json())
        .then(images => {
            setLoading(false);
            
            // Add host selector if not already present
            addImageHostSelector();
            
            const imagesList = document.getElementById('images-list');
            const imagesGridView = document.getElementById('images-grid-view');
            const imagesTableView = document.getElementById('images-table-view');
            
            // Ensure table structure exists
            ensureImagesTableStructure();
            const tableBody = document.getElementById('images-table-body');
            
            // Clear existing content
            if (imagesList) imagesList.innerHTML = '';
            if (tableBody) tableBody.innerHTML = '';
            
            if (!images.length) {
                const noImagesMsg = selectedHost ? `No images found on ${selectedHost}.` : 'No images found.';
                if (imagesList) {
                    imagesList.innerHTML = `<div class="no-containers">${noImagesMsg}</div>`;
                }
                if (tableBody) {
                    tableBody.innerHTML = `<tr><td colspan="7" class="no-containers">${noImagesMsg}</td></tr>`;
                }
                return;
            }
            
            // Sort images by host, then by name
            images.sort((a, b) => {
                const hostA = a.host || 'local';
                const hostB = b.host || 'local';
                
                if (hostA !== hostB) {
                    return hostA.localeCompare(hostB);
                }
                return a.name.localeCompare(b.name);
            });
            
            // Check which view is active
            const isTableView = imagesTableView && imagesTableView.classList.contains('active');
            console.log('Images rendering in table view:', isTableView);
            
            if (isTableView) {
                // Render in table format
                images.forEach(image => {
                    const row = document.createElement('tr');
                    const isUsed = image.used_by && image.used_by.length > 0;
                    const hostDisplay = image.host_display || image.host || 'local';
                    
                    row.innerHTML = `
                        <td class="image-name-cell">${image.name}</td>
                        <td class="image-tags-cell">${image.tags.join(', ')}</td>
                        <td class="image-size-cell">${image.size} MB</td>
                        <td class="image-created-cell">${image.created}</td>
                        <td class="image-used-cell">${isUsed ? image.used_by.join(', ') : 'None'}</td>
                        <td class="image-host-cell"><span class="host-badge-small">${hostDisplay}</span></td>
                        <td class="image-actions-cell">
                            <button onclick="removeImage('${image.id}', '${image.host}')" 
                                    class="btn btn-error btn-sm" ${isUsed ? 'disabled' : ''}>
                                Remove
                            </button>
                        </td>
                    `;
                    tableBody.appendChild(row);
                });
            } else {
                // Render in grid format - group by host
                const imagesByHost = {};
                images.forEach(image => {
                    const host = image.host || 'local';
                    if (!imagesByHost[host]) {
                        imagesByHost[host] = [];
                    }
                    imagesByHost[host].push(image);
                });
                
                Object.entries(imagesByHost).forEach(([host, hostImages]) => {
                    const hostDisplay = hostImages[0]?.host_display || host;
                    const hostHeader = document.createElement('div');
                    hostHeader.className = 'host-header';
                    hostHeader.innerHTML = `<h4>${hostDisplay} (${hostImages.length} images)</h4>`;
                    if (imagesList) imagesList.appendChild(hostHeader);
                    
                    hostImages.forEach(image => {
                        if (imagesList) {
                            renderImageCard(image, imagesList);
                        }
                    });
                });
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Failed to load images:', error);
            showMessage('error', 'Failed to load images');
        });
}

// Fix 3: Enhanced ensureImagesTableStructure function
function ensureImagesTableStructure() {
    const imagesTableView = document.getElementById('images-table-view');
    if (!imagesTableView) {
        console.error('Images table view container not found');
        return;
    }
    
    let imagesTable = document.getElementById('images-table');
    
    if (!imagesTable) {
        console.log('Creating images table structure');
        imagesTable = document.createElement('table');
        imagesTable.id = 'images-table';
        imagesTable.className = 'images-table';
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th>Name</th>
            <th>Tags</th>
            <th>Size</th>
            <th>Created</th>
            <th>Used By</th>
            <th>Host</th>
            <th>Actions</th>
        `;
        
        const tbody = document.createElement('tbody');
        tbody.id = 'images-table-body';
        
        thead.appendChild(headerRow);
        imagesTable.appendChild(thead);
        imagesTable.appendChild(tbody);
        imagesTableView.appendChild(imagesTable);
        
        console.log('Images table structure created');
    }
    
    // Ensure table is properly styled and visible
    imagesTable.style.width = '100%';
    imagesTable.style.borderCollapse = 'collapse';
    imagesTable.style.display = 'table';
    
    return imagesTable;
}

// Fix 4: Function to load image view preference
function loadImageViewPreference() {
    const savedImageView = localStorage.getItem('imageViewPreference');
    const containerView = localStorage.getItem('preferredView'); // Fall back to container view preference
    
    // Use image preference if available, otherwise fall back to container preference
    const preferredView = savedImageView || containerView || 'grid';
    
    console.log('Loading image view preference:', preferredView);
    
    const gridView = document.getElementById('images-grid-view');
    const tableView = document.getElementById('images-table-view');
    const toggleButton = document.getElementById('toggle-image-view');
    
    if (!gridView || !tableView || !toggleButton) {
        console.warn('Image view elements not found during preference load');
        return;
    }
    
    if (preferredView === 'table') {
        // Set table view
        gridView.classList.remove('active');
        tableView.classList.add('active');
        toggleButton.textContent = '≡';
        toggleButton.title = 'Switch to Grid View';
        
        // Ensure table structure
        ensureImagesTableStructure();
    } else {
        // Set grid view (default)
        tableView.classList.remove('active');
        gridView.classList.add('active');
        toggleButton.textContent = '⋮⋮';
        toggleButton.title = 'Switch to Table View';
    }
    
    console.log('Image view preference applied:', preferredView);
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
// Initialize event listeners
function initializeEventListeners() {
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
    
    // Search input with improved debouncing
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                refreshContainers();
            }, 300);
        });
    }
    
    // Filter handlers with sync
    const filterPairs = [
        ['status-filter', 'status-filter-mobile'],
        ['tag-filter', 'tag-filter-mobile'],
        ['stack-filter', 'stack-filter-mobile'],
        ['group-filter', 'group-filter-mobile'],
        ['sort-filter', 'sort-filter-mobile']
    ];
    
    filterPairs.forEach(([primary, secondary]) => {
        const primaryEl = document.getElementById(primary);
        const secondaryEl = document.getElementById(secondary);
        
        if (primaryEl) {
            primaryEl.addEventListener('change', () => {
                if (secondaryEl) secondaryEl.value = primaryEl.value;
                refreshContainers();
            });
        }
        
        if (secondaryEl) {
            secondaryEl.addEventListener('change', () => {
                if (primaryEl) primaryEl.value = secondaryEl.value;
                refreshContainers();
            });
        }
    });
    
    // Host filter (if it exists)
    addEventListenerIfExists('host-filter', 'change', () => {
        const hostFilterMobile = document.getElementById('host-filter-mobile');
        if (hostFilterMobile) {
            hostFilterMobile.value = document.getElementById('host-filter').value;
        }
        refreshContainers();
    });
    
    // View toggle button - CRITICAL FIX
    const toggleViewBtn = document.getElementById('toggle-view');
    if (toggleViewBtn) {
        // Remove any existing listeners first
        toggleViewBtn.removeEventListener('click', toggleView);
        toggleViewBtn.onclick = null;
        
        // Add single event listener
        const handleToggleClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Toggle view button clicked');
            toggleView();
        };
        
        toggleViewBtn.addEventListener('click', handleToggleClick);
        
        // Store reference to prevent multiple listeners
        toggleViewBtn._toggleHandler = handleToggleClick;
        
        console.log('Toggle view button event listener added');
    } else {
        console.warn('Toggle view button not found during initialization');
    }
    
    // Image view toggle button
    const toggleImageViewBtn = document.getElementById('toggle-image-view');
    if (toggleImageViewBtn) {
        toggleImageViewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Toggle image view button clicked');
            toggleImageView();
        });
        console.log('Toggle image view button event listener added');
    }
    
    // Batch mode toggle
    addEventListenerIfExists('toggle-batch-mode', 'click', toggleBatchMode);
    
    // Refresh button
    addEventListenerIfExists('refresh-btn', 'click', refreshContainers);
    
    // Image action buttons
    const pruneImagesBtn = document.querySelector('button[onclick="pruneImages()"]');
    if (pruneImagesBtn) {
        pruneImagesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            pruneImages();
        });
    }
    
    const removeUnusedBtn = document.querySelector('button[onclick="removeUnusedImages()"]');
    if (removeUnusedBtn) {
        removeUnusedBtn.addEventListener('click', (e) => {
            e.preventDefault();
            removeUnusedImages();
        });
    }
    
    console.log('All event listeners initialized');
}

// Initialize with a more robust approach
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded");
    
              
    // Initialize theme
    loadTheme();
    loadDockerHosts();

    // UI improvements
    updateGroupFilterOptions();
    removeTagFilters();

    
    
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
    
    // Initialize event listeners FIRST
    initializeEventListeners();
    
    // Force switch to containers tab to ensure proper initialization
    switchTab('containers');
    
    // Initialize view controls and load preferences
    initializeViewControls();
    
    // Load view preference after a short delay to ensure DOM is ready
    setTimeout(() => {
        loadViewPreference();
        
        // Ensure toggle button is visible and working after view preference load
        const toggleButton = document.getElementById('toggle-view');
        if (toggleButton) {
            toggleButton.style.display = 'inline-block';
            toggleButton.style.visibility = 'visible';
            console.log('Toggle button visibility ensured after preference load');
        }
    }, 200);
    
    // Load containers and start stats updater
    setTimeout(() => {
        console.log("Initializing containers...");
        refreshContainers();
        startStatsUpdater();
    }, 300);
    setTimeout(() => {
        loadSystemStatsMultiHost(); // Load stats on page load
    }, 500);
    
    // Additional safeguard for toggle button
    setTimeout(() => {
        const toggleButton = document.getElementById('toggle-view');
        if (toggleButton) {
            // Only add backup if no handler exists
            if (!toggleButton._toggleHandler) {
                console.log('Adding backup toggle button listener');
                const backupHandler = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleView();
                };
                toggleButton.onclick = backupHandler;
                toggleButton._toggleHandler = backupHandler;
            }
            
            // Ensure button is always visible
            toggleButton.style.display = 'inline-block';
            toggleButton.style.visibility = 'visible';
            toggleButton.style.opacity = '1';
            
            console.log('Toggle button final state check completed');
        }
    }, 500);
});

// Export essential functions to window for global access
window.toggleView = toggleView;
window.saveViewPreference = saveViewPreference;
window.loadViewPreference = loadViewPreference;
window.updateFilterControlsForView = updateFilterControlsForView;
window.pruneImages = pruneImages;
window.removeUnusedImages = removeUnusedImages;
window.removeImage = removeImage;
window.toggleImageView = toggleImageView;
window.extractStackName = extractStackName;
window.findComposeFileForStack = findComposeFileForStack;
window.createAndDeployProject = createAndDeployProject;
window.getStackResources = getStackResources;
window.showStackDetailsModal = showStackDetailsModal;
window.composeActionWithHost = composeActionWithHost;
