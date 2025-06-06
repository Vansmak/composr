

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
    } else if (group === 'host') {
        renderContainersByHostAsTable(containers);
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

        // Create stack header row with Details button - UPDATED COLSPAN
        const headerRow = document.createElement('tr');
        headerRow.className = 'stack-header-row';
        headerRow.innerHTML = `
            <td colspan="8">
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

// Update renderContainersByTagAsTable function
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
            <td colspan="8">
                <h3 style="margin: 0; font-size: 1.1rem;">${tag}</h3>
            </td>
        `;
        tableBody.appendChild(headerRow);

        groupedByTag[tag].forEach(container => {
            renderSingleContainerAsTableRow(container, tableBody);
        });
    });
}

// Update renderContainersByHostAsTable function
function renderContainersByHostAsTable(containers) {
    const tableBody = document.getElementById('table-body');
    let hostGroups = {};
    
    // Group containers by host
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
        const stats = {
            total: hostContainers.length,
            running: hostContainers.filter(c => c.status === 'running').length,
            cpu: hostContainers.reduce((sum, c) => sum + (parseFloat(c.cpu_percent) || 0), 0).toFixed(1),
            memory: Math.round(hostContainers.reduce((sum, c) => sum + (parseFloat(c.memory_usage) || 0), 0))
        };
        
        // Create host header row - UPDATED COLSPAN
        const headerRow = document.createElement('tr');
        headerRow.className = 'stack-header-row';
        headerRow.innerHTML = `
            <td colspan="8">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 1.1rem;">${host}</h3>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div class="stack-stats" style="display: flex; gap: 1rem;">
                            <span title="Container count">${stats.running}/${stats.total} running</span>
                            <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                            <span title="Total memory usage">Mem: ${stats.memory} MB</span>
                        </div>
                    </div>
                </div>
            </td>
        `;
        tableBody.appendChild(headerRow);
        
        // Sort and render containers for this host
        hostContainers.sort((a, b) => a.name.localeCompare(b.name));
        hostContainers.forEach(container => {
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

    let tagsHtml = '';
    if (container.tags && container.tags.length) {
        container.tags.forEach(tag => {
            tagsHtml += `<span class="tag-badge" onclick="filterByTag('${tag}')">${tag}</span>`;
        });
    }

    // NEW: Create ports HTML for table
    let portsHtml = '';
    if (container.ports && Object.keys(container.ports).length > 0) {
        const portsList = Object.entries(container.ports)
            .map(([hostPort, containerPort]) => `${hostPort}:${containerPort}`)
            .slice(0, 2) // Show max 2 ports in table to save space
            .join(', ');
        
        const remainingPorts = Object.keys(container.ports).length - 2;
        portsHtml = remainingPorts > 0 ? `${portsList} +${remainingPorts}` : portsList;
    } else {
        portsHtml = 'None';
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
        <td class="ports-cell" title="Port mappings">${portsHtml}</td>
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

// Fixed moveControlsToTable function in table-view.js
// This fixes the toggle button placement and group filter sync issues

function moveControlsToTable() {
    const controlsRow = document.getElementById('table-controls-row');
    const filterControls = document.querySelector('.filter-controls');
    
    if (!controlsRow || !filterControls) return;
    
    // Hide the original filter controls container
    filterControls.style.display = 'none';
    
    // Clear any existing controls in the table
    controlsRow.innerHTML = '';
    
    // Cell 1: Batch toggle (Checkbox column)
    const batchCell = document.createElement('td');
    const batchToggle = document.getElementById('toggle-batch-mode');
    if (batchToggle) {
        const clone = batchToggle.cloneNode(true);
        clone.removeAttribute('id');
        clone.classList.add('table-batch-toggle');
        clone.onclick = toggleBatchMode;
        batchCell.appendChild(clone);
    }
    controlsRow.appendChild(batchCell);
    
    // Cell 2: Search input (Name column)
    const searchCell = document.createElement('td');
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        const clone = searchInput.cloneNode(true);
        clone.removeAttribute('id');
        clone.placeholder = "Search...";
        clone.style.width = "100%";
        
        // Bidirectional sync
        clone.addEventListener('input', () => {
            searchInput.value = clone.value;
            searchInput.dispatchEvent(new Event('input'));
        });
        
        searchInput.addEventListener('input', () => {
            clone.value = searchInput.value;
        });
        
        searchCell.appendChild(clone);
    }
    controlsRow.appendChild(searchCell);
    
    // Cell 3: Stack filter (Stack column)
    const stackCell = document.createElement('td');
    const stackFilter = document.getElementById('stack-filter');
    if (stackFilter) {
        const clone = stackFilter.cloneNode(true);
        clone.removeAttribute('id');
        clone.style.width = "100%";
        
        // Copy all options
        clone.innerHTML = stackFilter.innerHTML;
        clone.value = stackFilter.value;
        
        // Bidirectional sync
        clone.addEventListener('change', () => {
            stackFilter.value = clone.value;
            stackFilter.dispatchEvent(new Event('change'));
        });
        
        stackFilter.addEventListener('change', () => {
            clone.value = stackFilter.value;
        });
        
        stackCell.appendChild(clone);
    }
    controlsRow.appendChild(stackCell);
    
    // Cell 4: Tag filter (Tags column)
    const tagCell = document.createElement('td');
    const tagFilter = document.getElementById('tag-filter');
    if (tagFilter) {
        const clone = tagFilter.cloneNode(true);
        clone.removeAttribute('id');
        clone.style.width = "100%";
        
        // Copy all options
        clone.innerHTML = tagFilter.innerHTML;
        clone.value = tagFilter.value;
        
        // Bidirectional sync
        clone.addEventListener('change', () => {
            tagFilter.value = clone.value;
            tagFilter.dispatchEvent(new Event('change'));
        });
        
        tagFilter.addEventListener('change', () => {
            clone.value = tagFilter.value;
        });
        
        tagCell.appendChild(clone);
    }
    controlsRow.appendChild(tagCell);
    
    // Cell 5: Status filter (Status column)
    const statusCell = document.createElement('td');
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        const clone = statusFilter.cloneNode(true);
        clone.removeAttribute('id');
        clone.style.width = "100%";
        
        // Copy all options
        clone.innerHTML = statusFilter.innerHTML;
        clone.value = statusFilter.value;
        
        // Bidirectional sync
        clone.addEventListener('change', () => {
            statusFilter.value = clone.value;
            statusFilter.dispatchEvent(new Event('change'));
        });
        
        statusFilter.addEventListener('change', () => {
            clone.value = statusFilter.value;
        });
        
        statusCell.appendChild(clone);
    }
    controlsRow.appendChild(statusCell);
    
    // Cell 6: Group filter (Uptime column)
    const groupCell = document.createElement('td');
    const groupFilter = document.getElementById('group-filter');
    if (groupFilter) {
        const clone = groupFilter.cloneNode(true);
        clone.removeAttribute('id');
        clone.style.width = "100%";
        
        // Copy all options - THIS IS CRUCIAL FOR GROUP BY
        clone.innerHTML = groupFilter.innerHTML;
        clone.value = groupFilter.value;
        
        // Bidirectional sync with proper event handling
        clone.addEventListener('change', () => {
            console.log('Table group filter changed to:', clone.value);
            groupFilter.value = clone.value;
            
            // Also sync mobile version
            const groupFilterMobile = document.getElementById('group-filter-mobile');
            if (groupFilterMobile) {
                groupFilterMobile.value = clone.value;
            }
            
            // Trigger the change event properly
            groupFilter.dispatchEvent(new Event('change'));
        });
        
        groupFilter.addEventListener('change', () => {
            console.log('Original group filter changed to:', groupFilter.value);
            clone.value = groupFilter.value;
        });
        
        groupCell.appendChild(clone);
    }
    controlsRow.appendChild(groupCell);
    
    // Cell 7: Buttons (Ports column) - FIXED PLACEMENT
    const portsCell = document.createElement('td');
    portsCell.style.display = 'flex';
    portsCell.style.gap = '4px';
    portsCell.style.justifyContent = 'center';
    portsCell.style.alignItems = 'center';
    
    const toggleViewBtn = document.getElementById('toggle-view');
    if (toggleViewBtn) {
        const clone = toggleViewBtn.cloneNode(true);
        clone.removeAttribute('id');
        clone.onclick = toggleView;
        clone.style.fontSize = '0.8rem';
        clone.style.padding = '0.4rem 0.6rem';
        portsCell.appendChild(clone);
    }
    
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        const clone = refreshBtn.cloneNode(true);
        clone.removeAttribute('id');
        clone.onclick = refreshContainers;
        clone.style.fontSize = '0.8rem';
        clone.style.padding = '0.4rem 0.6rem';
        portsCell.appendChild(clone);
    }
    
    controlsRow.appendChild(portsCell);
    
    // Cell 8: Batch actions (Actions column)
    const actionsCell = document.createElement('td');
    actionsCell.id = 'table-batch-actions-cell';
    
    // Create container for batch actions
    const batchActionButtons = document.createElement('div');
    batchActionButtons.id = 'table-batch-actions';
    batchActionButtons.style.display = 'none'; // Hidden by default
    batchActionButtons.style.flexWrap = 'wrap';
    batchActionButtons.style.gap = '2px';
    batchActionButtons.style.justifyContent = 'flex-end';
    
    // Add batch action buttons
    const actions = [
        { label: 'Start', action: 'start', class: 'btn-success' },
        { label: 'Stop', action: 'stop', class: 'btn-error' },
        { label: 'Restart', action: 'restart', class: 'btn-primary' },
        { label: 'Remove', action: 'remove', class: 'btn-error' }
    ];
    
    actions.forEach(item => {
        const button = document.createElement('button');
        button.className = `btn ${item.class}`;
        button.textContent = item.label;
        button.onclick = () => batchAction(item.action);
        button.style.padding = '0.3rem 0.4rem';
        button.style.fontSize = '0.75rem';
        button.style.margin = '1px';
        batchActionButtons.appendChild(button);
    });
    
    actionsCell.appendChild(batchActionButtons);
    controlsRow.appendChild(actionsCell);
    
    // Update button display based on batch mode
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    if (isBatchMode) {
        batchActionButtons.style.display = 'flex';
        document.querySelector('.table-batch-toggle')?.classList.add('active');
    } else {
        batchActionButtons.style.display = 'none';
        document.querySelector('.table-batch-toggle')?.classList.remove('active');
    }
    
    console.log('Controls moved to table, group filter value:', groupFilter?.value);
}

// Also add this helper function to ensure group filter sync works properly
function syncGroupFilters() {
    const groupFilter = document.getElementById('group-filter');
    const groupFilterMobile = document.getElementById('group-filter-mobile');
    const tableGroupFilter = document.querySelector('#table-controls-row select:nth-child(6) select');
    
    if (groupFilter && groupFilterMobile) {
        const currentValue = groupFilter.value;
        groupFilterMobile.value = currentValue;
        
        // If table controls exist, sync them too
        if (tableGroupFilter) {
            tableGroupFilter.value = currentValue;
        }
    }
}

// Update the toggleView function to call syncGroupFilters
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
        
        // Ensure group filters are synced
        setTimeout(syncGroupFilters, 100);
       
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