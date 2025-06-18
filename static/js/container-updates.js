// static/js/container-updates.js - Frontend for container update management

// Global state for container updates
let containerUpdateStatus = null;
let updateCheckInProgress = false;

// Initialize container update management
function initializeContainerUpdates() {
    console.log('Initializing container update management...');
    
    // Load current update status
    loadContainerUpdateStatus();
    
    // Add update indicators to existing containers
    addUpdateIndicatorsToContainers();
    
    // Set up periodic status refresh
    setInterval(() => {
        refreshUpdateIndicators();
    }, 300000); // Every 5 minutes
}

// Add this function to container-updates.js
function updateContainerUpdateStatusDisplay() {
    const statusElement = document.getElementById('container-update-status');
    if (!statusElement || !containerUpdateStatus) {
        return;
    }
    
    const cache = containerUpdateStatus.cache;
    const settings = containerUpdateStatus.settings;
    
    if (!cache) {
        statusElement.innerHTML = `
            <span class="status-icon">❓</span>
            <span class="status-text">No update data available</span>
        `;
        return;
    }
    
    const updatesAvailable = cache.updates_available || 0;
    const totalChecked = cache.total_checked || 0;
    const lastCheck = cache.last_check ? new Date(cache.last_check * 1000).toLocaleString() : 'Never';
    
    let statusHtml = '';
    
    if (updatesAvailable > 0) {
        statusHtml = `
            <div class="update-status-item">
                <span class="status-icon">🔄</span>
                <span class="status-text">${updatesAvailable} updates available (${totalChecked} containers checked)</span>
            </div>
            <div class="update-status-detail">
                <small>Last check: ${lastCheck}</small>
            </div>
        `;
    } else if (totalChecked > 0) {
        statusHtml = `
            <div class="update-status-item">
                <span class="status-icon">✅</span>
                <span class="status-text">All ${totalChecked} containers up to date</span>
            </div>
            <div class="update-status-detail">
                <small>Last check: ${lastCheck}</small>
            </div>
        `;
    } else {
        statusHtml = `
            <div class="update-status-item">
                <span class="status-icon">❓</span>
                <span class="status-text">No containers checked yet</span>
            </div>
            <div class="update-status-detail">
                <small>Auto-check: ${settings?.auto_check_enabled ? 'Enabled' : 'Disabled'}</small>
            </div>
        `;
    }
    
    statusElement.innerHTML = statusHtml;
}

// Update the existing loadContainerUpdateStatus function
async function loadContainerUpdateStatus() {
    try {
        const response = await fetch('/api/container-updates/status');
        const result = await response.json();
        
        if (result.status === 'success') {
            containerUpdateStatus = result;
            updateContainerUpdateBadges();
            updateContainerUpdateStatusDisplay(); // Add this line
        }
    } catch (error) {
        console.error('Failed to load container update status:', error);
    }
}

// Check for container updates
async function checkContainerUpdates(force = true, showLoading = true) {
    if (updateCheckInProgress) {
        return;
    }
    
    updateCheckInProgress = true;
    
    try {
        if (showLoading) {
            setLoading(true, 'Checking for container updates...');
        }
        
        const response = await fetch('/api/container-updates/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            containerUpdateStatus = {
                cache: result,
                last_check: result.last_check
            };
            
            updateContainerUpdateBadges();
            
            if (result.updates_available > 0) {
                showMessage('success', `Found ${result.updates_available} container updates available`);
                
                if (showLoading) {
                    showContainerUpdatesModal(result);
                }
            } else {
                if (showLoading) {
                    showMessage('success', 'All containers are up to date');
                }
            }
        } else {
            if (showLoading) {
                showMessage('error', `Update check failed: ${result.message}`);
            }
        }
        
    } catch (error) {
        console.error('Container update check failed:', error);
        if (showLoading) {
            showMessage('error', 'Failed to check for container updates');
        }
    } finally {
        updateCheckInProgress = false;
        if (showLoading) {
            setLoading(false);
        }
    }
}

// Add update indicators to container cards
function addUpdateIndicatorsToContainers() {
    if (!containerUpdateStatus?.cache?.containers) {
        return;
    }
    
    const updateData = containerUpdateStatus.cache.containers;
    
    // Update existing container cards
    document.querySelectorAll('.container-card').forEach(card => {
        const containerId = card.dataset.id;
        const containerHost = card.dataset.host || 'local';
        const updateKey = `${containerHost}:${card.querySelector('.container-name').textContent}`;
        
        const updateInfo = updateData[updateKey];
        
        // Remove existing update indicator
        const existingIndicator = card.querySelector('.update-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // Add update indicator if update is available
        if (updateInfo?.update_available) {
            const indicator = document.createElement('div');
            indicator.className = 'update-indicator';
            indicator.innerHTML = `
                <span class="update-icon">🔄</span>
                <span class="update-text">Update Available</span>
            `;
            indicator.title = `Update to ${updateInfo.latest_tag || 'newer version'}`;
            indicator.onclick = (e) => {
                e.stopPropagation();
                showContainerUpdateModal(containerId, containerHost, updateInfo);
            };
            
            card.appendChild(indicator);
        }
    });
}

// Update container update badges
function updateContainerUpdateBadges() {
    if (!containerUpdateStatus?.cache) {
        return;
    }
    
    const updatesAvailable = containerUpdateStatus.cache.updates_available || 0;
    
    // Update or create update badge in header
    let updateBadge = document.getElementById('container-update-badge');
    
    if (updateBadge) {
        updateBadge.remove();
    }
    
    if (updatesAvailable > 0) {
        updateBadge = document.createElement('div');
        updateBadge.id = 'container-update-badge';
        updateBadge.className = 'container-update-badge';
        updateBadge.innerHTML = `
            <span class="update-badge-icon">📦</span>
            <span class="update-badge-text">${updatesAvailable} Updates</span>
        `;
        updateBadge.onclick = () => showContainerUpdatesModal(containerUpdateStatus.cache);
        updateBadge.title = `${updatesAvailable} container updates available`;
        
        const headerControls = document.querySelector('.system-stats');
        if (headerControls) {
            headerControls.appendChild(updateBadge);
        }
    }
    
    // Update indicators on container cards
    addUpdateIndicatorsToContainers();
}

// Show container updates overview modal
function showContainerUpdatesModal(updateResults) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal container-updates-modal';
    
    const updatesAvailable = updateResults.updates_available || 0;
    const totalChecked = updateResults.total_checked || 0;
    
    // Group containers by update status
    const availableUpdates = [];
    const upToDate = [];
    const checkErrors = [];
    
    Object.entries(updateResults.containers || {}).forEach(([containerKey, updateInfo]) => {
        const [host, name] = containerKey.split(':');
        const containerData = { key: containerKey, host, name, ...updateInfo };
        
        if (updateInfo.update_available) {
            availableUpdates.push(containerData);
        } else if (updateInfo.error) {
            checkErrors.push(containerData);
        } else {
            upToDate.push(containerData);
        }
    });
    
    modal.innerHTML = `
        <div class="modal-header">
            <h3>📦 Container Updates</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content container-updates-content">
            <div class="update-summary">
                <div class="summary-stats">
                    <div class="stat-item">
                        <span class="stat-value">${totalChecked}</span>
                        <span class="stat-label">Containers Checked</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${updatesAvailable}</span>
                        <span class="stat-label">Updates Available</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${checkErrors.length}</span>
                        <span class="stat-label">Check Errors</span>
                    </div>
                </div>
                
                <div class="update-actions">
                    <button class="btn btn-primary" onclick="checkContainerUpdates(true, true)">
                        🔄 Refresh
                    </button>
                    <button class="btn btn-secondary" onclick="showContainerUpdateSettings()">
                        ⚙️ Settings
                    </button>
                    ${updatesAvailable > 0 ? `
                        <button class="btn btn-success" onclick="showBatchUpdateModal(${JSON.stringify(availableUpdates).replace(/"/g, '&quot;')})">
                            📦 Update All
                        </button>
                    ` : ''}
                </div>
            </div>
            
            ${availableUpdates.length > 0 ? `
                <div class="updates-section">
                    <h4>🔄 Updates Available (${availableUpdates.length})</h4>
                    <div class="updates-list">
                        ${availableUpdates.map(container => `
                            <div class="update-item">
                                <div class="update-item-info">
                                    <strong>${container.name}</strong>
                                    <span class="host-badge-small">${container.host}</span>
                                    <div class="version-info">
                                        <span class="current-version">${container.current_tag}</span>
                                        <span class="version-arrow">→</span>
                                        <span class="new-version">${container.latest_tag || 'newer'}</span>
                                    </div>
                                </div>
                                <div class="update-item-actions">
                                    <button class="btn btn-primary btn-sm" onclick="showContainerUpdateModal('${container.key}', '${container.host}', ${JSON.stringify(container).replace(/"/g, '&quot;')})">
                                        Update
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${upToDate.length > 0 ? `
                <div class="updates-section">
                    <h4>✅ Up to Date (${upToDate.length})</h4>
                    <div class="up-to-date-list">
                        ${upToDate.slice(0, 10).map(container => `
                            <div class="update-item up-to-date">
                                <div class="update-item-info">
                                    <strong>${container.name}</strong>
                                    <span class="host-badge-small">${container.host}</span>
                                    <span class="current-version">${container.current_tag}</span>
                                </div>
                            </div>
                        `).join('')}
                        ${upToDate.length > 10 ? `<div class="more-items">... and ${upToDate.length - 10} more</div>` : ''}
                    </div>
                </div>
            ` : ''}
            
            ${checkErrors.length > 0 ? `
                <div class="updates-section">
                    <h4>❌ Check Errors (${checkErrors.length})</h4>
                    <div class="errors-list">
                        ${checkErrors.map(container => `
                            <div class="update-item error">
                                <div class="update-item-info">
                                    <strong>${container.name}</strong>
                                    <span class="host-badge-small">${container.host}</span>
                                    <div class="error-message">${container.error}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Show individual container update modal
function showContainerUpdateModal(containerId, host, updateInfo) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal container-update-modal';
    
    modal.innerHTML = `
        <div class="modal-header">
            <h3>🔄 Update Container</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content">
            <div class="container-update-info">
                <h4>${updateInfo.name || containerId}</h4>
                <span class="host-badge">${host}</span>
                
                <div class="version-update-info">
                    <div class="current-version-info">
                        <strong>Current:</strong> ${updateInfo.current_tag}
                    </div>
                    <div class="version-arrow">→</div>
                    <div class="new-version-info">
                        <strong>Available:</strong> 
                        <select id="target-version-select">
                            ${updateInfo.latest_tag ? `<option value="${updateInfo.latest_tag}" selected>${updateInfo.latest_tag} (recommended)</option>` : ''}
                            <option value="latest">latest</option>
                        </select>
                    </div>
                </div>
                
                <div class="update-options">
                    <label class="checkbox-label">
                        <input type="checkbox" id="backup-before-update" checked>
                        Create backup before updating
                    </label>
                </div>
                
                <div class="update-info">
                    ${updateInfo.check_method ? `<p><strong>Detection method:</strong> ${updateInfo.check_method}</p>` : ''}
                    ${updateInfo.remote_updated ? `<p><strong>Remote updated:</strong> ${new Date(updateInfo.remote_updated).toLocaleString()}</p>` : ''}
                </div>
                
                <div class="update-warning">
                    <strong>⚠️ Warning:</strong> This will stop and recreate the container. 
                    Any unsaved data in the container will be lost.
                </div>
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.logs-modal').remove()">
                    Cancel
                </button>
                <button class="btn btn-primary" onclick="loadAvailableVersions('${containerId}', '${host}')">
                    🔍 Load All Versions
                </button>
                <button class="btn btn-success" onclick="updateSingleContainer('${containerId}', '${host}')">
                    🚀 Update Now
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Load available versions for a container
async function loadAvailableVersions(containerId, host) {
    try {
        setLoading(true, 'Loading available versions...');
        
        const response = await fetch(`/api/container-updates/available-tags/${containerId}?host=${encodeURIComponent(host)}`);
        const result = await response.json();
        
        if (result.status === 'success') {
            const select = document.getElementById('target-version-select');
            if (select) {
                // Clear existing options
                select.innerHTML = '';
                
                // Add version tags
                if (result.version_tags && result.version_tags.length > 0) {
                    const versionGroup = document.createElement('optgroup');
                    versionGroup.label = 'Version Tags';
                    result.version_tags.forEach(tag => {
                        const option = document.createElement('option');
                        option.value = tag;
                        option.textContent = tag;
                        if (tag !== result.current_tag) {
                            versionGroup.appendChild(option);
                        }
                    });
                    select.appendChild(versionGroup);
                }
                
                // Add other tags
                if (result.other_tags && result.other_tags.length > 0) {
                    const otherGroup = document.createElement('optgroup');
                    otherGroup.label = 'Other Tags';
                    result.other_tags.forEach(tag => {
                        const option = document.createElement('option');
                        option.value = tag;
                        option.textContent = tag;
                        if (tag !== result.current_tag) {
                            otherGroup.appendChild(option);
                        }
                    });
                    select.appendChild(otherGroup);
                }
                
                showMessage('success', `Loaded ${result.total_available} available tags`);
            }
        } else {
            showMessage('error', `Failed to load versions: ${result.message}`);
        }
        
    } catch (error) {
        console.error('Failed to load available versions:', error);
        showMessage('error', 'Failed to load available versions');
    } finally {
        setLoading(false);
    }
}

// Update a single container
async function updateSingleContainer(containerId, host) {
    try {
        const targetTag = document.getElementById('target-version-select')?.value;
        const backupBeforeUpdate = document.getElementById('backup-before-update')?.checked ?? true;
        
        if (!targetTag) {
            showMessage('error', 'Please select a target version');
            return;
        }
        
        if (!confirm(`Update container to ${targetTag}? This will recreate the container.`)) {
            return;
        }
        
        setLoading(true, `Updating container to ${targetTag}...`);
        
        const response = await fetch('/api/container-updates/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                container_id: containerId,
                host: host,
                target_tag: targetTag,
                backup_before_update: backupBeforeUpdate
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            showMessage('success', result.message);
            
            // Close modal
            document.querySelector('.container-update-modal')?.remove();
            
            // Refresh containers
            if (typeof refreshContainers === 'function') {
                setTimeout(() => refreshContainers(), 2000);
            }
            
            // Refresh update status
            setTimeout(() => loadContainerUpdateStatus(), 3000);
            
        } else {
            showMessage('error', `Update failed: ${result.message}`);
        }
        
    } catch (error) {
        console.error('Container update failed:', error);
        showMessage('error', 'Container update failed');
    } finally {
        setLoading(false);
    }
}

// Show batch update modal
function showBatchUpdateModal(availableUpdates) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal batch-update-modal';
    
    modal.innerHTML = `
        <div class="modal-header">
            <h3>📦 Batch Update Containers</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content">
            <div class="batch-update-info">
                <p>Update ${availableUpdates.length} containers to their latest versions:</p>
                
                <div class="batch-update-list">
                    ${availableUpdates.map((container, index) => `
                        <div class="batch-update-item">
                            <label class="checkbox-label">
                                <input type="checkbox" class="batch-update-checkbox" 
                                       data-container="${container.key}" 
                                       data-host="${container.host}"
                                       data-target="${container.latest_tag || 'latest'}" 
                                       checked>
                                <div class="batch-item-info">
                                    <strong>${container.name}</strong>
                                    <span class="host-badge-small">${container.host}</span>
                                    <div class="version-change">
                                        ${container.current_tag} → ${container.latest_tag || 'latest'}
                                    </div>
                                </div>
                            </label>
                        </div>
                    `).join('')}
                </div>
                
                <div class="batch-options">
                    <label class="checkbox-label">
                        <input type="checkbox" id="batch-backup-before-update" checked>
                        Create backups before updating
                    </label>
                    
                    <label class="checkbox-label">
                        <input type="checkbox" id="batch-stop-on-error">
                        Stop batch update on first error
                    </label>
                </div>
                
                <div class="batch-warning">
                    <strong>⚠️ Warning:</strong> This will update multiple containers simultaneously. 
                    Ensure you have backups and are prepared for potential service disruption.
                </div>
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.logs-modal').remove()">
                    Cancel
                </button>
                <button class="btn btn-primary" onclick="selectAllBatchUpdates(true)">
                    Select All
                </button>
                <button class="btn btn-secondary" onclick="selectAllBatchUpdates(false)">
                    Select None
                </button>
                <button class="btn btn-success" onclick="executeBatchUpdate()">
                    🚀 Update Selected
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Select/deselect all batch updates
function selectAllBatchUpdates(select) {
    document.querySelectorAll('.batch-update-checkbox').forEach(checkbox => {
        checkbox.checked = select;
    });
}

// Execute batch container updates
async function executeBatchUpdate() {
    try {
        const selectedUpdates = [];
        document.querySelectorAll('.batch-update-checkbox:checked').forEach(checkbox => {
            const containerKey = checkbox.dataset.container;
            const [host, ...nameParts] = containerKey.split(':');
            const name = nameParts.join(':'); // Handle container names with colons
            
            selectedUpdates.push({
                container_id: name, // This might need adjustment based on your container ID format
                host: checkbox.dataset.host,
                target_tag: checkbox.dataset.target
            });
        });
        
        if (selectedUpdates.length === 0) {
            showMessage('error', 'No containers selected for update');
            return;
        }
        
        if (!confirm(`Update ${selectedUpdates.length} containers? This may take several minutes.`)) {
            return;
        }
        
        setLoading(true, `Updating ${selectedUpdates.length} containers...`);
        
        const response = await fetch('/api/container-updates/batch-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                updates: selectedUpdates
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            showMessage('success', result.message);
            
            // Show detailed results
            showBatchUpdateResults(result.results);
            
            // Close batch modal
            document.querySelector('.batch-update-modal')?.remove();
            
            // Refresh containers
            if (typeof refreshContainers === 'function') {
                setTimeout(() => refreshContainers(), 3000);
            }
            
        } else {
            showMessage('error', `Batch update failed: ${result.message}`);
        }
        
    } catch (error) {
        console.error('Batch update failed:', error);
        showMessage('error', 'Batch update failed');
    } finally {
        setLoading(false);
    }
}

// Show batch update results
function showBatchUpdateResults(results) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal batch-results-modal';
    
    const successful = results.details.filter(r => r.success);
    const failed = results.details.filter(r => !r.success);
    
    modal.innerHTML = `
        <div class="modal-header">
            <h3>📊 Batch Update Results</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content">
            <div class="results-summary">
                <div class="summary-stats">
                    <div class="stat-item success">
                        <span class="stat-value">${results.successful}</span>
                        <span class="stat-label">Successful</span>
                    </div>
                    <div class="stat-item error">
                        <span class="stat-value">${results.failed}</span>
                        <span class="stat-label">Failed</span>
                    </div>
                </div>
            </div>
            
            ${successful.length > 0 ? `
                <div class="results-section">
                    <h4>✅ Successful Updates</h4>
                    <div class="results-list">
                        ${successful.map(result => `
                            <div class="result-item success">
                                <strong>${result.container_id}</strong>
                                <span class="host-badge-small">${result.host}</span>
                                <div class="result-message">${result.message}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${failed.length > 0 ? `
                <div class="results-section">
                    <h4>❌ Failed Updates</h4>
                    <div class="results-list">
                        ${failed.map(result => `
                            <div class="result-item error">
                                <strong>${result.container_id}</strong>
                                <span class="host-badge-small">${result.host}</span>
                                <div class="result-message error">${result.error || result.message}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Show container update settings
function showContainerUpdateSettings() {
    if (!containerUpdateStatus) {
        showMessage('error', 'Update status not loaded');
        return;
    }
    
    const settings = containerUpdateStatus.settings || {};
    
    const modal = document.createElement('div');
    modal.className = 'logs-modal container-update-settings-modal';
    
    modal.innerHTML = `
        <div class="modal-header">
            <h3>⚙️ Container Update Settings</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content">
            <div class="settings-form">
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="auto-check-enabled" ${settings.auto_check_enabled ? 'checked' : ''}>
                        Automatically check for container updates
                    </label>
                </div>
                
                <div class="form-group">
                    <label for="check-interval-hours">Check interval (hours):</label>
                    <input type="number" id="check-interval-hours" value="${settings.check_interval_hours || 6}" min="1" max="168">
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="notify-on-updates" ${settings.notify_on_updates ? 'checked' : ''}>
                        Show notifications when updates are found
                    </label>
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="auto-check-enabled" ${settings.auto_check_enabled ? 'checked' : ''}>
                        Automatically check for container updates
                    </label>
                </div>
                
                <div class="form-group">
                    <label for="check-interval-hours">Check interval (hours):</label>
                    <input type="number" id="check-interval-hours" value="${settings.check_interval_hours || 6}" min="1" max="168">
                </div>
                
                <!-- ADD THESE TWO NEW SECTIONS -->
                <div class="form-group auto-update-section" style="background: var(--bg-secondary); padding: 1rem; border-radius: 0.25rem; margin: 1.5rem 0;">
                    <h4 style="margin: 0 0 1rem 0; color: var(--accent-success);">🤖 Auto-Safe Updates</h4>
                    <label class="checkbox-label">
                        <input type="checkbox" id="auto-update-enabled" ${settings.auto_update_enabled ? 'checked' : ''}>
                        Automatically apply safe updates (patch versions only)
                    </label>
                    <small style="display: block; margin-top: 0.5rem; color: var(--text-secondary);">
                        Only updates like 1.2.3 → 1.2.4. Skips 1.2.x → 1.3.x or 2.x.x changes.
                    </small>
                    
                    <div style="margin-top: 1rem;">
                        <label for="auto-update-tags">Auto-update only these tags:</label>
                        <input type="text" id="auto-update-tags" value="${(settings.auto_update_tags || ['stable', 'prod']).join(', ')}" 
                               placeholder="stable, prod, production">
                        <small>Only containers with these tags will auto-update</small>
                    </div>
                </div>
                
                <div class="form-group repull-section" style="background: var(--bg-secondary); padding: 1rem; border-radius: 0.25rem; margin: 1.5rem 0;">
                    <h4 style="margin: 0 0 1rem 0; color: var(--accent-info);">🔄 Scheduled Repulls</h4>
                    <label class="checkbox-label">
                        <input type="checkbox" id="scheduled-repull-enabled" ${settings.scheduled_repull_enabled ? 'checked' : ''}>
                        Automatically repull containers on schedule
                    </label>
                    <small style="display: block; margin-top: 0.5rem; color: var(--text-secondary);">
                        Repulls same version to get latest image (useful for 'latest' tags)
                    </small>
                    
                    <div style="margin-top: 1rem;">
                        <label for="repull-interval-hours">Repull interval (hours):</label>
                        <input type="number" id="repull-interval-hours" value="${settings.repull_interval_hours || 24}" min="1" max="168">
                    </div>
                    
                    <div style="margin-top: 1rem;">
                        <label for="repull-tags">Repull these tags:</label>
                        <input type="text" id="repull-tags" value="${(settings.repull_tags || ['latest', 'main']).join(', ')}" 
                               placeholder="latest, main, stable">
                        <small>Tags that should be repulled regularly</small>
                    </div>
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="backup-before-update" ${settings.backup_before_update ? 'checked' : ''}>
                        Create backups before updating by default
                    </label>
                </div>
                
                <div class="form-group">
                    <label for="max-concurrent-updates">Max concurrent updates:</label>
                    <input type="number" id="max-concurrent-updates" value="${settings.max_concurrent_updates || 3}" min="1" max="10">
                </div>
                
                <div class="form-group">
                    <label for="exclude-patterns">Exclude tag patterns (comma separated):</label>
                    <input type="text" id="exclude-patterns" value="${(settings.exclude_patterns || []).join(', ')}" 
                           placeholder="latest, dev, test">
                    <small>Containers with these tags will be skipped</small>
                </div>
                
                <div class="form-group">
                    <label for="include-patterns">Include tag patterns (comma separated):</label>
                    <input type="text" id="include-patterns" value="${(settings.include_patterns || []).join(', ')}" 
                           placeholder="stable, main, prod">
                    <small>If specified, only containers with these tags will be checked</small>
                </div>
                
                <div class="update-info">
                    <h4>ℹ️ How it works:</h4>
                    <ul>
                        <li><strong>Version tags:</strong> Checks for newer semantic versions (1.0.0 → 1.0.1)</li>
                        <li><strong>Latest tags:</strong> Checks if remote image is newer than local</li>
                        <li><strong>Compose managed:</strong> Updates compose files and redeploys</li>
                        <li><strong>Standalone:</strong> Recreates containers with new image</li>
                    </ul>
                </div>
            </div>
            
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.logs-modal').remove()">
                    Cancel
                </button>
                <button class="btn btn-primary" onclick="saveContainerUpdateSettings()">
                    Save Settings
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Save container update settings
async function saveContainerUpdateSettings() {
    try {
        const settings = {
            auto_check_enabled: document.getElementById('auto-check-enabled').checked,
            check_interval_hours: parseInt(document.getElementById('check-interval-hours').value),
            
            // ADD THESE NEW SETTINGS
            auto_update_enabled: document.getElementById('auto-update-enabled').checked,
            auto_update_tags: document.getElementById('auto-update-tags').value
                .split(',').map(p => p.trim()).filter(p => p),
            
            scheduled_repull_enabled: document.getElementById('scheduled-repull-enabled').checked,
            repull_interval_hours: parseInt(document.getElementById('repull-interval-hours').value),
            repull_tags: document.getElementById('repull-tags').value
                .split(',').map(p => p.trim()).filter(p => p),
            
            // Your existing settings
            notify_on_updates: document.getElementById('notify-on-updates').checked,
            backup_before_update: document.getElementById('backup-before-update').checked,
            max_concurrent_updates: parseInt(document.getElementById('max-concurrent-updates').value),
            exclude_patterns: document.getElementById('exclude-patterns').value
                .split(',').map(p => p.trim()).filter(p => p),
            include_patterns: document.getElementById('include-patterns').value
                .split(',').map(p => p.trim()).filter(p => p)
        };
        
        const response = await fetch('/api/container-updates/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            showMessage('success', 'Container update settings saved');
            document.querySelector('.container-update-settings-modal').remove();
        } else {
            showMessage('error', result.message || 'Failed to save settings');
        }
        
    } catch (error) {
        console.error('Failed to save container update settings:', error);
        showMessage('error', 'Failed to save container update settings');
    }
}

// Refresh update indicators
function refreshUpdateIndicators() {
    if (containerUpdateStatus?.settings?.auto_check_enabled) {
        // Only refresh if auto-check is enabled
        loadContainerUpdateStatus();
    }
}

// Add container update management button to UI
function addContainerUpdateButton() {
    const actionsContainer = document.querySelector('.action-buttons');
    if (actionsContainer && !document.getElementById('container-updates-btn')) {
        const updateButton = document.createElement('button');
        updateButton.id = 'container-updates-btn';
        updateButton.className = 'btn btn-secondary';
        updateButton.innerHTML = '📦 Updates';
        updateButton.onclick = () => checkContainerUpdates(true, true);
        updateButton.title = 'Check for container updates';
        
        actionsContainer.insertBefore(updateButton, actionsContainer.lastElementChild);
    }
}

// Initialize container updates when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    // Add update button to UI
    setTimeout(() => {
        addContainerUpdateButton();
        initializeContainerUpdates();
    }, 1000);
});

// Export functions for global access
window.checkContainerUpdates = checkContainerUpdates;
window.showContainerUpdateSettings = showContainerUpdateSettings;
window.updateSingleContainer = updateSingleContainer;
window.showContainerUpdatesModal = showContainerUpdatesModal;
window.loadAvailableVersions = loadAvailableVersions;
window.executeBatchUpdate = executeBatchUpdate;
window.selectAllBatchUpdates = selectAllBatchUpdates;
window.saveContainerUpdateSettings = saveContainerUpdateSettings;