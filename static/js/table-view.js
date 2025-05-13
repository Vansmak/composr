// Toggle between grid and table views
function toggleView() {
    const gridView = document.getElementById('grid-view');
    const tableView = document.getElementById('table-view');
    const toggleButton = document.getElementById('toggle-view');
    const filterControls = document.querySelector('.filter-controls');
    const batchActions = document.getElementById('batch-actions');
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    
    if (gridView && gridView.classList.contains('active')) {
        // Switch to table view
        gridView.classList.remove('active');
        tableView.classList.add('active');
        saveViewPreference('table');
       
        // Move controls to table
        moveControlsToTable();
       
        if (toggleButton) {
            toggleButton.textContent = '≡';
        }
        
        // ALWAYS hide grid batch actions when switching to table
        batchActions.classList.remove('visible');
       
        refreshContainers();
    } else if (tableView) {
        // Switch to grid view
        tableView.classList.remove('active');
        gridView.classList.add('active');
        saveViewPreference('grid');
       
        // Show original filter controls
        if (filterControls) {
            filterControls.style.display = '';
        }
       
        if (toggleButton) {
            toggleButton.textContent = '⋮⋮';
        }
        
        // Show grid batch actions only if in batch mode
        if (batchActions && isBatchMode) {
            batchActions.classList.add('visible');
        }
       
        refreshContainers();
    }
}
// Render containers as a table
// This should already be in table-view.js
function renderContainersAsTable(containers) {
    const tableView = document.getElementById('table-view');
    const tableBody = document.getElementById('table-body');
    const noContainers = document.getElementById('no-containers');
    const group = document.getElementById('group-filter').value || document.getElementById('group-filter-mobile').value || 'none';

    tableBody.innerHTML = '';
    tableView.classList.toggle('batch-mode', document.getElementById('containers-list').classList.contains('batch-mode'));

    if (!Array.isArray(containers) || !containers.length) {
        noContainers.style.display = 'block';
        return;
    }

    noContainers.style.display = 'none';

    if (group === 'stack') {
        renderContainersByStackAsTable(containers);
        return;
    } else if (group === 'tag') {
        renderContainersByTagAsTable(containers);
        return;
    }

    // Render without grouping
    containers.forEach(container => {
        renderSingleContainerAsTableRow(container, tableBody);
    });
}
function renderContainersByStackAsTable(containers) {
    const tableBody = document.getElementById('table-body');
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

        // Create stack header row with Details button
        const headerRow = document.createElement('tr');
        headerRow.className = 'stack-header-row';
        headerRow.innerHTML = `
            <td colspan="9">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 1.1rem;" onclick="showStackDetailsModal('${stackName}', '${composeFile || ''}')">${stackName}</h3>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div class="stack-stats" style="display: flex; gap: 1rem;">
                            <span title="Container count">${stats.running}/${stats.total} running</span>
                            <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                            <span title="Total memory usage">Mem: ${stats.memory} MB</span>
                        </div>
                        <button class="btn btn-secondary btn-sm" style="padding: 0.25rem 0.75rem; font-size: 1.25rem;" onclick="showStackDetailsModal('${stackName}', '${composeFile || ''}')">
                            🐳
                        </button>    
                    </div>
                </div>
            </td>
        `;
        tableBody.appendChild(headerRow);

        // Render containers for this stack
        stackContainers[stackName].forEach(container => {
            renderSingleContainerAsTableRow(container, tableBody);
        });
    });

    // Update filter options
    updateTagFilterOptions(Array.from(allTags));
    updateStackFilterOptions(Array.from(allStacks));
}



// Render containers grouped by tag as a table
function renderContainersByTagAsTable(containers) {
    const tableBody = document.getElementById('table-body');
    let groupedByTag = {};

    containers.forEach(container => {
        const primaryTag = container.tags && container.tags.length ? container.tags[0] : 'Untagged';
        if (!groupedByTag[primaryTag]) {
            groupedByTag[primaryTag] = [];
        }
        groupedByTag[primaryTag].push(container);
    });

    Object.keys(groupedByTag).sort().forEach(tag => {
        const headerRow = document.createElement('tr');
        headerRow.className = 'stack-header-row';
        headerRow.innerHTML = `
            <td colspan="9">
                <h3 style="margin: 0; font-size: 1.1rem;">${tag}</h3>
            </td>
        `;
        tableBody.appendChild(headerRow);

        groupedByTag[tag].forEach(container => {
            renderSingleContainerAsTableRow(container, tableBody);
        });
    });
}

// Render a single container as a table row
function renderSingleContainerAsTableRow(container, tableBody) {
    const isBatchMode = document.getElementById('table-view').classList.contains('batch-mode');
    const row = document.createElement('tr');
    row.dataset.id = container.id;
    const uptimeDisplay = container.uptime && container.uptime.display ? container.uptime.display : 'N/A';
    // Removed uptimeLong logic to ensure consistent color

    let tagsHtml = '';
    if (container.tags && container.tags.length) {
        container.tags.forEach(tag => {
            tagsHtml += `<span class="tag-badge" onclick="filterByTag('${tag}')">${tag}</span>`;
        });
    }

    row.innerHTML = `
        <td>
            <input type="checkbox" class="batch-checkbox" value="${container.id}">
        </td>
        <td>
            <span class="container-name" onclick="openCustomContainerURL('${container.id}')" title="${container.name}">${container.name}</span>
        </td>
        <td>${extractStackName(container)}</td>
        <td>${tagsHtml}</td>
        <td>
            <span class="container-status status-${container.status === 'running' ? 'running' : 'stopped'}">${container.status}</span>
        </td>
        <td>
            <span class="uptime-badge">${uptimeDisplay}</span>
        </td>
        <td>${container.cpu_percent}%</td>
        <td>${container.memory_usage} MB</td>
        <td>
            <div class="actions">
                <button class="btn btn-success" onclick="containerAction('${container.id}', 'start')" ${container.status === 'running' ? 'disabled' : ''}>Start</button>
                <button class="btn btn-error" onclick="containerAction('${container.id}', 'stop')" ${container.status !== 'running' ? 'disabled' : ''}>Stop</button>
                <button class="btn btn-primary" onclick="containerAction('${container.id}', 'restart')" ${container.status !== 'running' ? 'disabled' : ''}>Restart</button>
                <button class="btn btn-primary" onclick="showContainerPopup('${container.id}', '${container.name}')">More</button>
            </div>
        </td>
    `;

    if (isBatchMode) {
        const checkbox = row.querySelector('.batch-checkbox');
        checkbox.addEventListener('change', (e) => {
            row.classList.toggle('selected', e.target.checked);
        });
    }

    tableBody.appendChild(row);
}
// Update moveControlsToTable function
function moveControlsToTable() {
    const controlsRow = document.getElementById('table-controls-row');
    const filterControls = document.querySelector('.filter-controls');
    
    if (!controlsRow || !filterControls) return;
    
    // Hide the original filter controls container
    filterControls.style.display = 'none';
    
    // Clear any existing controls in the table
    controlsRow.innerHTML = '';
    
    // Create cells for each control
    const cells = [
        // Checkbox column (batch mode toggle)
        createCell(document.getElementById('toggle-batch-mode')),
        
        // Name column (search input)
        createCell(document.getElementById('search-input')),
        
        // Stack column (stack filter)
        createCell(document.getElementById('stack-filter')),
        
        // Tags column (tag filter)
        createCell(document.getElementById('tag-filter')),
        
        // Status column (status filter)
        createCell(document.getElementById('status-filter')),
        
        // Uptime column (group filter)
        createCell(document.getElementById('group-filter')),
        
        // CPU column (refresh button)
        createCell(document.getElementById('refresh-btn')),
        
        // Memory column (toggle view button)
        createCell(document.getElementById('toggle-view')),
        
        // Actions column (for batch actions)
        createActionsColumnCell()
    ];
    
    cells.forEach(cell => controlsRow.appendChild(cell));
}
function createCellWithElement(element) {
    const td = document.createElement('td');
    if (element && element.parentNode) {
        // Move the actual element instead of cloning
        element.parentNode.removeChild(element);
        td.appendChild(element);
    }
    return td;
}
// New function to create cells with centered buttons
function createCellWithButton(element) {
    const td = document.createElement('td');
    if (element) {
        const clone = element.cloneNode(true);
        clone.removeAttribute('id');
        
        // Center the button
        td.style.textAlign = 'center';
        
        // Copy event handlers
        if (element.onclick) {
            clone.onclick = element.onclick;
        }
        
        td.appendChild(clone);
    }
    return td;
}
function createActionsColumnCell() {
    const td = document.createElement('td');
    
    // Create container div
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '0.5rem';
    
    // Create batch actions container
    const batchActions = document.createElement('div');
    batchActions.id = 'table-batch-actions'; /* This ID is crucial */
    container.appendChild(batchActions);
    
    td.appendChild(container);
    return td;
}
function createCell(element) {
    const td = document.createElement('td');
    if (element) {
        const clone = element.cloneNode(true);
        
        // Remove ID to prevent duplicates
        clone.removeAttribute('id');
        
        // Special handling for refresh button
        if (element.id === 'refresh-btn' || element.classList.contains('refresh-btn')) {
            clone.onclick = () => refreshContainers();
        }
        // Special handling for toggle view button
        else if (element.id === 'toggle-view') {
            clone.onclick = () => toggleView();
        }
        // Special handling for batch toggle
        else if (element.id === 'toggle-batch-mode') {
            clone.onclick = () => toggleBatchMode();
        }
        // Copy onclick for other elements
        else if (element.onclick) {
            clone.onclick = element.onclick;
        }
        
        // Handle inputs and selects
        if (element.tagName === 'INPUT' || element.tagName === 'SELECT') {
            clone.value = element.value;
            
            // Special handling for search input with debouncing
            if (element.id === 'search-input') {
                let debounceTimer;
                
                clone.addEventListener('input', (e) => {
                    // Update the original element value
                    element.value = e.target.value;
                    
                    // Clear existing timer
                    clearTimeout(debounceTimer);
                    
                    // Set new timer to refresh after user stops typing
                    debounceTimer = setTimeout(() => {
                        element.dispatchEvent(new Event('input'));
                    }, 300); // Wait 300ms after user stops typing
                });
                
                // Keep values in sync
                element.addEventListener('input', () => {
                    clone.value = element.value;
                });
            } else {
                // For other inputs and selects, use the original sync behavior
                clone.addEventListener('change', () => {
                    element.value = clone.value;
                    element.dispatchEvent(new Event('change'));
                });
                
                element.addEventListener('change', () => {
                    clone.value = element.value;
                });
                
                if (element.tagName === 'INPUT') {
                    clone.addEventListener('input', () => {
                        element.value = clone.value;
                        element.dispatchEvent(new Event('input'));
                    });
                    
                    element.addEventListener('input', () => {
                        clone.value = element.value;
                    });
                }
            }
        }
        
        td.appendChild(clone);
    }
    return td;
}

function createNameColumnCell() {
    const td = document.createElement('td');
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.gap = '0.5rem';
    container.style.alignItems = 'center';
    
    // Add search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        const searchClone = searchInput.cloneNode(true);
        searchClone.removeAttribute('id');
        searchClone.style.flex = '1';
        container.appendChild(searchClone);
        
        // Sync values
        searchClone.value = searchInput.value;
        searchClone.addEventListener('input', () => {
            searchInput.value = searchClone.value;
            searchInput.dispatchEvent(new Event('input'));
        });
        searchInput.addEventListener('input', () => {
            searchClone.value = searchInput.value;
        });
    }
    
    // Add refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        const refreshClone = refreshBtn.cloneNode(true);
        refreshClone.removeAttribute('id');
        refreshClone.style.width = 'auto';
        refreshClone.onclick = () => refreshContainers();
        container.appendChild(refreshClone);
    }
    
    // Add toggle view button
    const toggleViewBtn = document.getElementById('toggle-view');
    if (toggleViewBtn) {
        const toggleClone = toggleViewBtn.cloneNode(true);
        toggleClone.removeAttribute('id');
        toggleClone.style.width = 'auto';
        toggleClone.onclick = () => toggleView();
        container.appendChild(toggleClone);
    }
    
    td.appendChild(container);
    return td;
}

function createNameColumnCell() {
    const td = document.createElement('td');
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.gap = '0.5rem';
    container.style.alignItems = 'center';
    
    // Add search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        const searchClone = searchInput.cloneNode(true);
        searchClone.removeAttribute('id');
        searchClone.style.flex = '1';
        container.appendChild(searchClone);
        
        // Sync values
        searchClone.value = searchInput.value;
        searchClone.addEventListener('input', () => {
            searchInput.value = searchClone.value;
            searchInput.dispatchEvent(new Event('input'));
        });
        searchInput.addEventListener('input', () => {
            searchClone.value = searchInput.value;
        });
    }
    
    // Add refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        const refreshClone = refreshBtn.cloneNode(true);
        refreshClone.removeAttribute('id');
        refreshClone.style.width = 'auto';
        refreshClone.onclick = () => refreshContainers();
        container.appendChild(refreshClone);
    }
    
    // Add toggle view button
    const toggleViewBtn = document.getElementById('toggle-view');
    if (toggleViewBtn) {
        const toggleClone = toggleViewBtn.cloneNode(true);
        toggleClone.removeAttribute('id');
        toggleClone.style.width = 'auto';
        toggleClone.onclick = () => toggleView();
        container.appendChild(toggleClone);
    }
    
    td.appendChild(container);
    return td;
}

function restoreControlsFromTable() {
    // Since we're cloning elements, we don't need to restore them
    // The original controls are still in their place, just hidden
}
// Simplified sorting for table view
function sortTable(key) {
    let direction = 'asc';
    
    // For metrics (cpu, memory, uptime), default to descending (highest first)
    if (key === 'cpu' || key === 'memory' || key === 'uptime') {
        direction = 'desc';
    }
    // For name and status, use ascending (A-Z)
    else {
        direction = 'asc';
    }
    
    // Update visual indicators
    document.querySelectorAll('#table-view th[onclick]').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
    });
    
    const currentHeader = document.querySelector(`#table-view th[onclick="sortTable('${key}')"]`);
    if (currentHeader) {
        currentHeader.classList.add(`sorted-${direction}`);
    }
    
    // Call refreshContainers with sort parameters
    refreshContainers(key, direction);
}
// Save view preference
function saveViewPreference(viewType) {
    localStorage.setItem('preferredView', viewType);
}

// Load view preference on startup
function loadViewPreference() {
    const savedView = localStorage.getItem('preferredView');
    if (savedView === 'table') {
        // Switch to table view
        const gridView = document.getElementById('grid-view');
        const tableView = document.getElementById('table-view');
        if (gridView && tableView) {
            gridView.classList.remove('active');
            tableView.classList.add('active');
            // Only move controls if we're in table view
            if (tableView.classList.contains('active')) {
                moveControlsToTable();
            }
        }
    }
}
// Batch mode: Select all
document.getElementById('select-all').addEventListener('change', (e) => {
    document.querySelectorAll('.batch-checkbox').forEach(checkbox => {
        checkbox.checked = e.target.checked;
        const row = checkbox.closest('tr');
        row.classList.toggle('selected', e.target.checked);
    });
});