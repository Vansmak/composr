// Table-specific functions for container management

function updateTableHeaders() {
    const headersRow = document.getElementById('table-headers-row');
    if (headersRow) {
        headersRow.innerHTML = `
            <th style="width: 30px; text-align: center;"><input type="checkbox" id="select-all" style="margin: 0;"></th>
            <th onclick="sortTable('name')">Name</th>
            <th>Stack</th>
            <th onclick="sortTable('status')">Status</th>
            <th onclick="sortTable('uptime')">Uptime</th>
            <th>Ports</th>
            <th>Host</th>
            <th>Actions</th>
        `;
        
        // Re-add select all functionality
        const selectAllCheckbox = document.getElementById('select-all');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                const checkboxes = document.querySelectorAll('.batch-checkbox');
                checkboxes.forEach(checkbox => {
                    checkbox.checked = e.target.checked;
                    const row = checkbox.closest('tr');
                    if (row) {
                        row.classList.toggle('selected', e.target.checked);
                    }
                });
            });
        }
    }
}

// Also update ensureTableStructure to set table layout
function ensureTableStructure() {
    const tableView = document.getElementById('table-view');
    let containerTable = document.getElementById('container-table');
    
    if (!containerTable) {
        console.log('Creating container table structure');
        containerTable = document.createElement('table');
        containerTable.id = 'container-table';
        containerTable.style.tableLayout = 'auto';
        //containerTable.style.width = '100%';
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.id = 'table-headers-row';
        
        const tbody = document.createElement('tbody');
        tbody.id = 'table-body';
        
        thead.appendChild(headerRow);
        containerTable.appendChild(thead);
        containerTable.appendChild(tbody);
        tableView.appendChild(containerTable);
    } else {
        // Ensure existing table has proper layout
        containerTable.style.tableLayout = 'auto';
        //containerTable.style.width = '100%';
    }
    
    // Ensure table body exists
    let tableBody = document.getElementById('table-body');
    if (!tableBody) {
        tableBody = document.createElement('tbody');
        tableBody.id = 'table-body';
        containerTable.appendChild(tableBody);
    }
    
    // Force table to be visible and properly styled
    containerTable.style.display = 'table';
    tableView.style.display = 'block';
    
    console.log('Table structure ensured with fixed layout');
}

// Main table rendering function
function renderContainersAsTable(containers) {
    const tableView = document.getElementById('table-view');
    const tableBody = document.getElementById('table-body');
    const noContainers = document.getElementById('no-containers');
    
    if (!tableBody) {
        console.error('Table body not found! Creating...');
        ensureTableStructure();
        return;
    }
    
    // Clear existing rows
    tableBody.innerHTML = '';
    
    const group = document.getElementById('group-filter').value || document.getElementById('group-filter-mobile').value || 'none';
    
    // Set batch mode state
    const isBatchMode = document.getElementById('containers-list').classList.contains('batch-mode');
    tableView.classList.toggle('batch-mode', isBatchMode);

    if (!Array.isArray(containers) || !containers.length) {
        noContainers.style.display = 'block';
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = '<td colspan="8" class="no-containers">No containers found.</td>';
        tableBody.appendChild(emptyRow);
        return;
    }

    noContainers.style.display = 'none';
    
    // Update table headers for current grouping
    updateTableHeaders();

    // Render based on grouping
    if (group === 'stack') {
        renderContainersByStackAsTable(containers);
    } else if (group === 'host') {
        renderContainersByHostAsTable(containers);
    } else {
        // Render without grouping
        containers.forEach(container => {
            renderSingleContainerAsTableRow(container, tableBody);
        });
    }
    
    // Force table repaint
    const containerTable = document.getElementById('container-table');
    if (containerTable) {
        containerTable.style.display = 'none';
        containerTable.offsetHeight; // Force reflow
        containerTable.style.display = 'table';
    }
    
    console.log(`Rendered ${containers.length} containers in table view`);
}

// Render containers grouped by stack in table format
function renderContainersByStackAsTable(containers) {
    const tableBody = document.getElementById('table-body');
    let allTags = new Set();
    let allStacks = new Set();
    let stackContainers = {};

    containers.forEach(container => {
        const stackName = window.extractStackName(container);
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
        const composeFile = window.findComposeFileForStack(stackContainers[stackName]);

        // Create stack header row
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
}

// Render containers grouped by host in table format
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
        const hostDisplay = hostContainers[0]?.host_display || host;
        
        const stats = {
            total: hostContainers.length,
            running: hostContainers.filter(c => c.status === 'running').length,
            cpu: hostContainers.reduce((sum, c) => sum + (parseFloat(c.cpu_percent) || 0), 0).toFixed(1),
            memory: Math.round(hostContainers.reduce((sum, c) => sum + (parseFloat(c.memory_usage) || 0), 0))
        };
        
        // Create host header row
        const headerRow = document.createElement('tr');
        headerRow.className = 'stack-header-row';
        headerRow.innerHTML = `
            <td colspan="8">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 1.1rem;">🖥️ ${hostDisplay}</h3>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div class="stack-stats" style="display: flex; gap: 1rem;">
                            <span title="Container count">${stats.running}/${stats.total} running</span>
                            <span title="Total CPU usage">CPU: ${stats.cpu}%</span>
                            <span title="Total memory usage">Mem: ${stats.memory} MB</span>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="showHostDetailsModal('${host}')">
                            📊
                        </button>    
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
    row.dataset.host = container.host || 'local';
    const uptimeDisplay = container.uptime && container.uptime.display ? container.uptime.display : 'N/A';

    // CRITICAL FIX: Ensure host is properly passed
    const containerHost = container.host || 'local';
    console.log(`Rendering table row for ${container.name} with host: ${containerHost}`);

    // Create ports HTML for table
    let portsHtml = '';
    if (container.ports && Object.keys(container.ports).length > 0) {
        const portsList = Object.entries(container.ports)
            .map(([hostPort, containerPort]) => `${hostPort}:${containerPort}`)
            .slice(0, 2)
            .join(', ');
        
        const remainingPorts = Object.keys(container.ports).length - 2;
        portsHtml = remainingPorts > 0 ? `${portsList} +${remainingPorts}` : portsList;
    } else {
        portsHtml = 'None';
    }

    // ADD THIS: Get health info for table
    const health = getContainerHealth(container);

    const hostDisplay = container.host_display || container.host || 'local';

    row.innerHTML = `
        <td>
            <input type="checkbox" class="batch-checkbox" value="${container.id}" data-host="${containerHost}" style="display: ${isBatchMode ? 'inline-block' : 'none'};">
        </td>
        <td>
            <span class="container-name" onclick="openCustomContainerURL('${container.id}', '${containerHost}')" title="${container.name}">${container.name}</span>
        </td>
        <td>${window.extractStackName(container)}</td>
        <td>
            <span class="health-${health.level}" title="${health.tooltip}">${container.status}</span>
            
        </td>
        <td>
            <span class="uptime-badge">${uptimeDisplay}</span>
        </td>
        <td class="ports-cell" title="Port mappings">${portsHtml}</td>
        <td><span class="host-badge-small">${hostDisplay}</span></td>
        <td>
            <div class="table-actions">
                <button class="btn btn-success btn-sm" onclick="containerAction('${container.id}', 'start', '${containerHost}')" ${container.status === 'running' ? 'disabled' : ''}>Start</button>
                <button class="btn btn-error btn-sm" onclick="containerAction('${container.id}', 'stop', '${containerHost}')" ${container.status !== 'running' ? 'disabled' : ''}>Stop</button>
                <button class="btn btn-primary btn-sm" onclick="containerAction('${container.id}', 'restart', '${containerHost}')" ${container.status !== 'running' ? 'disabled' : ''}>Restart</button>
                <button class="btn btn-primary btn-sm" onclick="showContainerPopup('${container.id}', '${container.name}', '${containerHost}')">More</button>
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
// Render containers grouped by tag in table format (if needed)
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

// Enhanced batch selection with host awareness
function toggleAllContainers() {
    const tableView = document.getElementById('table-view');
    const isTableView = tableView && tableView.classList.contains('active');
    
    if (isTableView) {
        const checkboxes = document.querySelectorAll('.batch-checkbox');
        const selectAllCheckbox = document.getElementById('select-all');
        const allSelected = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = !allSelected;
            const row = checkbox.closest('tr');
            if (row) {
                row.classList.toggle('selected', checkbox.checked);
            }
        });
        
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = !allSelected;
        }
    } else {
        // Grid view
        const checkboxes = document.querySelectorAll('.container-select');
        const allSelected = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = !allSelected;
            checkbox.dispatchEvent(new Event('change'));
        });
    }
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
        
        // FIXED: Include Host header
        headerRow.innerHTML = `
            <th onclick="sortImages('name')">Name</th>
            <th>Tags</th>
            <th onclick="sortImages('size')">Size</th>
            <th onclick="sortImages('created')">Created</th>
            <th>Used By</th>
            <th onclick="sortImages('host')">Host</th>
            <th>Actions</th>
        `;
        
        const tbody = document.createElement('tbody');
        tbody.id = 'images-table-body';
        
        thead.appendChild(headerRow);
        imagesTable.appendChild(thead);
        imagesTable.appendChild(tbody);
        imagesTableView.appendChild(imagesTable);
        
        console.log('Images table structure created with Host header');
    }
    
    // Ensure table is properly styled and visible
    imagesTable.style.width = '100%';
    imagesTable.style.borderCollapse = 'collapse';
    imagesTable.style.display = 'table';
    
    return imagesTable;
}

// Add this new function to handle image sorting:
function sortImages(sortBy) {
    console.log(`Sorting images by: ${sortBy}`);
    
    // Get current images data
    const tableBody = document.getElementById('images-table-body');
    if (!tableBody) return;
    
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    
    // Extract data from rows for sorting
    const imageData = rows.map(row => {
        const cells = row.querySelectorAll('td');
        return {
            element: row,
            name: cells[0]?.textContent || '',
            size: parseFloat(cells[2]?.textContent?.replace(' MB', '') || '0'),
            created: cells[3]?.textContent || '',
            host: cells[5]?.textContent?.trim() || 'local'
        };
    });
    
    // Sort the data
    imageData.sort((a, b) => {
        let valueA, valueB;
        
        switch(sortBy) {
            case 'name':
                valueA = a.name.toLowerCase();
                valueB = b.name.toLowerCase();
                return valueA.localeCompare(valueB);
                
            case 'size':
                return b.size - a.size; // Descending for size
                
            case 'created':
                valueA = a.created.toLowerCase();
                valueB = b.created.toLowerCase();
                return valueB.localeCompare(valueA); // Descending for created date
                
            case 'host':
                valueA = a.host.toLowerCase();
                valueB = b.host.toLowerCase();
                // Sort by host first, then by name within each host
                if (valueA !== valueB) {
                    return valueA.localeCompare(valueB);
                }
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                
            default:
                return 0;
        }
    });
    
    // Clear table body and re-append sorted rows
    tableBody.innerHTML = '';
    imageData.forEach(item => {
        tableBody.appendChild(item.element);
    });
    
    // Update visual indicators
    document.querySelectorAll('#images-table th[onclick]').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
    });
    
    const currentHeader = document.querySelector(`#images-table th[onclick="sortImages('${sortBy}')"]`);
    if (currentHeader) {
        // For size and created, show descending. For name and host, show ascending
        const isDescending = sortBy === 'size' || sortBy === 'created';
        currentHeader.classList.add(isDescending ? 'sorted-desc' : 'sorted-asc');
    }
}

// Initialize table view event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Select all functionality
    const selectAllCheckbox = document.getElementById('select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.batch-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
                const row = checkbox.closest('tr');
                if (row) {
                    row.classList.toggle('selected', e.target.checked);
                }
            });
        });
    }
    
    // Event listener for group filter changes to update table headers
    const groupFilter = document.getElementById('group-filter');
    const groupFilterMobile = document.getElementById('group-filter-mobile');
    
    if (groupFilter) {
        groupFilter.addEventListener('change', () => {
            setTimeout(updateTableHeaders, 100); // Small delay to ensure DOM updates
        });
    }
    
    if (groupFilterMobile) {
        groupFilterMobile.addEventListener('change', () => {
            setTimeout(updateTableHeaders, 100);
        });
    }
    
    // Also listen for view changes
    const toggleViewBtn = document.getElementById('toggle-view');
    if (toggleViewBtn) {
        toggleViewBtn.addEventListener('click', () => {
            setTimeout(updateTableHeaders, 200);
        });
    }
});

// Enhanced image table rendering for multi-host
function renderImageTableRow(image, tableBody) {
    const row = document.createElement('tr');
    const isUsed = image.used_by && image.used_by.length > 0;
    const hostDisplay = image.host_display || image.host || 'local';
    
    row.innerHTML = `
        <td>${image.name}</td>
        <td>${image.tags.join(', ')}</td>
        <td>${image.size} MB</td>
        <td>${image.created}</td>
        <td>${isUsed ? image.used_by.join(', ') : 'None'}</td>
        <td><span class="host-badge-small">${hostDisplay}</span></td>
        <td>
            <button onclick="removeImage('${image.id}', '${image.host}')" class="btn btn-error" ${isUsed ? 'disabled' : ''}>Remove</button>
        </td>
    `;
    tableBody.appendChild(row);
}

// Export functions to window for global access
window.ensureTableStructure = ensureTableStructure;
window.updateTableHeaders = updateTableHeaders;
window.renderContainersAsTable = renderContainersAsTable;
window.renderImageTableRow = renderImageTableRow;
window.renderContainersByTagAsTable = renderContainersByTagAsTable;
window.sortTable = sortTable;