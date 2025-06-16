// static/js/remote.js - Fixed Composr Host Management

// Load and display Docker hosts management
function loadHostsManagement() {
    fetch('/api/hosts')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                updateHostsDisplay(data.hosts, data.current_host);
                loadMultiHostSystemOverview();
            } else {
                showMessage('error', 'Failed to load hosts');
            }
        })
        .catch(error => {
            console.error('Failed to load hosts:', error);
            showMessage('error', 'Failed to load hosts');
        });
}

// Add a new Docker host
function addDockerHost() {
    const name = document.getElementById('new-host-name').value.trim();
    const url = document.getElementById('new-host-url').value.trim();
    const description = document.getElementById('new-host-description')?.value.trim() || '';
    
    if (!name || !url) {
        showMessage('error', 'Name and URL are required');
        return;
    }
    
    // Validate URL format for Docker
    if (!url.startsWith('tcp://')) {
        showMessage('error', 'URL must start with tcp:// (e.g., tcp://192.168.1.100:2375)');
        return;
    }
    
    setLoading(true, `Adding host ${name}...`);
    
    fetch('/api/hosts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, description })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message);
            // Clear form
            document.getElementById('new-host-name').value = '';
            document.getElementById('new-host-url').value = '';
            if (document.getElementById('new-host-description')) {
                document.getElementById('new-host-description').value = '';
            }
            // Reload host management
            loadHostsManagement();
        } else {
            showMessage('error', result.message);
        }
    })
    .catch(error => {
        setLoading(false);
        showMessage('error', 'Failed to add Docker host');
        console.error('Add host error:', error);
    });
}

// Remove a Docker host
function removeHost(hostName) {
    if (!confirm(`Remove Docker host "${hostName}"? This will disconnect from the host but won't affect the actual Docker host.`)) {
        return;
    }
    
    setLoading(true, `Removing host ${hostName}...`);
    
    fetch('/api/hosts/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: hostName })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message);
            loadHostsManagement();
            // Refresh containers as the host list changed
            if (typeof refreshContainers === 'function') {
                refreshContainers();
            }
        } else {
            showMessage('error', result.message);
        }
    })
    .catch(error => {
        setLoading(false);
        showMessage('error', 'Failed to remove host');
        console.error('Remove host error:', error);
    });
}

// Test Docker host connection
function testHost(hostName, url) {
    if (!url) {
        showMessage('error', 'Please enter a Docker URL to test');
        return;
    }
    
    setLoading(true, `Testing connection to ${hostName || 'host'}...`);
    
    fetch('/api/hosts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', `Connection to ${hostName || 'host'} successful`);
        } else {
            showMessage('error', `Connection failed: ${result.message}`);
        }
    })
    .catch(error => {
        setLoading(false);
        showMessage('error', `Failed to test connection to ${hostName || 'host'}`);
        console.error('Test host error:', error);
    });
}

// Switch to a different Docker host (for current context)
function switchToHost(hostName) {
    setLoading(true, `Switching to ${hostName}...`);
    
    fetch('/api/hosts/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: hostName })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        if (result.status === 'success') {
            showMessage('success', result.message);
            // Reload everything for the new host context
            loadHostsManagement();
            if (typeof refreshContainers === 'function') {
                refreshContainers();
            }
            if (typeof loadSystemStatsMultiHost === 'function') {
                loadSystemStatsMultiHost();
            }
        } else {
            showMessage('error', result.message);
        }
    })
    .catch(error => {
        setLoading(false);
        showMessage('error', `Failed to switch to ${hostName}`);
        console.error('Switch host error:', error);
    });
}

// Update the hosts display
function updateHostsDisplay(hosts, currentHost) {
    const container = document.getElementById('hosts-list-content');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Group hosts by connection status
    const connectedHosts = [];
    const disconnectedHosts = [];
    
    Object.entries(hosts).forEach(([hostName, hostInfo]) => {
        if (hostName === 'local') return; // Skip local in the list
        
        if (hostInfo.connected) {
            connectedHosts.push([hostName, hostInfo]);
        } else {
            disconnectedHosts.push([hostName, hostInfo]);
        }
    });
    
    // Render connected hosts
    if (connectedHosts.length > 0) {
        const connectedSection = document.createElement('div');
        connectedSection.className = 'host-section';
        connectedSection.innerHTML = '<h5 style="color: var(--accent-success); margin: 1rem 0 0.5rem 0;">🟢 Connected</h5>';
        container.appendChild(connectedSection);
        
        connectedHosts.forEach(([hostName, hostInfo]) => {
            const hostDiv = createHostListItem(hostName, hostInfo, currentHost);
            container.appendChild(hostDiv);
        });
    }
    
    // Render disconnected hosts
    if (disconnectedHosts.length > 0) {
        const disconnectedSection = document.createElement('div');
        disconnectedSection.className = 'host-section';
        disconnectedSection.innerHTML = '<h5 style="color: var(--accent-error); margin: 1rem 0 0.5rem 0;">🔴 Disconnected</h5>';
        container.appendChild(disconnectedSection);
        
        disconnectedHosts.forEach(([hostName, hostInfo]) => {
            const hostDiv = createHostListItem(hostName, hostInfo, currentHost);
            container.appendChild(hostDiv);
        });
    }
    
    // Show message if no external hosts
    if (connectedHosts.length === 0 && disconnectedHosts.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No external Docker hosts configured. Add a host using the form below.</p>';
    }
}

// Create a host list item
function createHostListItem(hostName, hostInfo, currentHost) {
    const hostDiv = document.createElement('div');
    hostDiv.className = `host-item ${hostInfo.connected ? 'connected' : 'disconnected'}`;
    
    const statusIcon = hostInfo.connected ? '🟢' : '🔴';
    
    hostDiv.innerHTML = `
        <div class="host-info">
            <div class="host-header">
                <strong>${statusIcon} ${hostInfo.name || hostName}</strong>
                <span class="deploy-badge">DEPLOY TARGET</span>
            </div>
            <div class="host-details">
                <span class="host-url">${hostInfo.url}</span>
                ${hostInfo.connected ? `
                    <span class="host-type">tcp</span>
                    <span class="last-check">Last check: ${formatLastCheck(hostInfo.last_check)}</span>
                ` : `
                    <span class="host-error">Connection failed</span>
                `}
            </div>
        </div>
        <div class="host-actions">
            ${hostInfo.connected ? `
                <span class="status-text">Available for deployment</span>
                <button class="btn btn-secondary btn-sm" onclick="testHost('${hostName}', '${hostInfo.url}')">Test</button>
            ` : `
                <button class="btn btn-secondary btn-sm" onclick="testHost('${hostName}', '${hostInfo.url}')">Reconnect</button>
            `}
            <button class="btn btn-error btn-sm" onclick="removeHost('${hostName}')">Remove</button>
        </div>
    `;
    
    return hostDiv;
}

// Format last check timestamp
function formatLastCheck(timestamp) {
    if (!timestamp) return 'Never';
    const now = Date.now() / 1000;
    const diff = Math.floor(now - timestamp);
    
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// Load multi-host system overview
function loadMultiHostSystemOverview() {
    fetch('/api/system/overview')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                updateMultiHostStats(data.hosts, data.totals);
            } else {
                console.error('System overview error:', data.message);
            }
        })
        .catch(error => {
            console.error('Failed to load system overview:', error);
        });
}

// Update multi-host statistics display
function updateMultiHostStats(hosts, totals) {
    const container = document.getElementById('multi-host-stats');
    if (!container) return;
    
    container.innerHTML = `
        <div class="multi-host-stat">
            <span class="stat-value">${totals.connected_hosts || 0}</span>
            <span class="stat-label">Connected Hosts</span>
        </div>
        <div class="multi-host-stat">
            <span class="stat-value">${totals.total_containers || 0}</span>
            <span class="stat-label">Total Containers</span>
        </div>
        <div class="multi-host-stat">
            <span class="stat-value">${totals.total_running || 0}</span>
            <span class="stat-label">Running Containers</span>
        </div>
        <div class="multi-host-stat">
            <span class="stat-value">${totals.total_cpu_cores || 0}</span>
            <span class="stat-label">Total CPU Cores</span>
        </div>
        <div class="multi-host-stat">
            <span class="stat-value">${totals.total_memory_gb || 0} GB</span>
            <span class="stat-label">Total Memory</span>
        </div>
        <div class="multi-host-stat">
            <span class="stat-value">${totals.total_images || 0}</span>
            <span class="stat-label">Total Images</span>
        </div>
    `;
}
// Load available Docker hosts for deployment
function loadAvailableHosts() {
    fetch('/api/hosts')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('deploy-host-select');
            if (!select) return;
            
            // Clear existing options except local
            select.innerHTML = '<option value="local">Local Docker (this machine)</option>';
            
            if (data.status === 'success' && data.hosts) {
                Object.entries(data.hosts).forEach(([hostName, hostInfo]) => {
                    if (hostName !== 'local' && hostInfo.connected) {
                        const option = document.createElement('option');
                        option.value = hostName;
                        option.textContent = `${hostInfo.name || hostName} (${hostInfo.url})`;
                        
                        // Mark current host
                        if (hostName === data.current_host) {
                            option.textContent += ' [Current]';
                        }
                        
                        select.appendChild(option);
                    }
                });
                
                // Show disconnected hosts as disabled options
                Object.entries(data.hosts).forEach(([hostName, hostInfo]) => {
                    if (hostName !== 'local' && !hostInfo.connected) {
                        const option = document.createElement('option');
                        option.value = hostName;
                        option.textContent = `${hostInfo.name || hostName} (Disconnected)`;
                        option.disabled = true;
                        option.style.color = 'var(--text-disabled)';
                        select.appendChild(option);
                    }
                });
            }
        })
        .catch(error => {
            console.error('Failed to load hosts:', error);
            showMessage('error', 'Failed to load available hosts');
        });
}
// Legacy compatibility functions - keeping these for compatibility with other parts of the app
function loadDockerHosts() {
    fetch('/api/docker/hosts')
        .then(response => response.json())
        .then(data => {
            const instanceSelector = document.getElementById('composr-instance-selector');
            if (instanceSelector) {
                instanceSelector.innerHTML = '<option value="">Current Instance</option>';
                
                Object.keys(data.hosts || {}).forEach(host => {
                    if (host !== 'local') {
                        const hostInfo = data.hosts[host];
                        const option = document.createElement('option');
                        option.value = hostInfo.url || '';
                        option.textContent = host;
                        instanceSelector.appendChild(option);
                    }
                });
            }
        })
        .catch(error => {
            console.error('Failed to load hosts:', error);
        });
}

// Load and display hosts list (legacy compatibility)
function loadHostsList() {
    loadHostsManagement();
}



// Analyze volume mappings
function analyzeVolumes(composeData) {
    const volumeWarning = document.getElementById('volume-warning');
    const volumePathsList = document.getElementById('volume-paths-list');
    
    if (!volumeWarning || !volumePathsList || !composeData.services) {
        return;
    }
    
    const hostPaths = new Set();
    
    // Check each service for volume mappings
    Object.values(composeData.services).forEach(service => {
        if (service.volumes && Array.isArray(service.volumes)) {
            service.volumes.forEach(volume => {
                if (typeof volume === 'string' && volume.includes(':')) {
                    const hostPath = volume.split(':')[0];
                    
                    // Only warn about absolute host paths (not named volumes or relative paths)
                    if (hostPath.startsWith('/') || hostPath.match(/^[A-Za-z]:\//)) {
                        hostPaths.add(hostPath);
                    }
                }
            });
        }
    });
    
    if (hostPaths.size > 0) {
        volumePathsList.innerHTML = Array.from(hostPaths)
            .map(path => `<li><code>${path}</code></li>`)
            .join('');
        volumeWarning.style.display = 'block';
    } else {
        volumeWarning.style.display = 'none';
    }
}

// Analyze network requirements
function analyzeNetworks(composeData) {
    const networkWarning = document.getElementById('network-warning');
    const networkList = document.getElementById('network-list');
    
    if (!networkWarning || !networkList) {
        return;
    }
    
    const externalNetworks = new Set();
    
    // Check for external networks
    if (composeData.networks) {
        Object.entries(composeData.networks).forEach(([networkName, networkConfig]) => {
            if (networkConfig && networkConfig.external) {
                externalNetworks.add(networkName);
            }
        });
    }
    
    // Check services for network references
    if (composeData.services) {
        Object.values(composeData.services).forEach(service => {
            if (service.networks && Array.isArray(service.networks)) {
                service.networks.forEach(network => {
                    if (typeof network === 'string' && !['default', 'bridge', 'host', 'none'].includes(network)) {
                        // This might be an external network
                        externalNetworks.add(network);
                    }
                });
            }
        });
    }
    
    if (externalNetworks.size > 0) {
        networkList.innerHTML = Array.from(externalNetworks)
            .map(network => `<li><code>${network}</code></li>`)
            .join('');
        networkWarning.style.display = 'block';
    } else {
        networkWarning.style.display = 'none';
    }
}

// Hide all warning boxes
function hideAllWarnings() {
    const volumeWarning = document.getElementById('volume-warning');
    const networkWarning = document.getElementById('network-warning');
    
    if (volumeWarning) volumeWarning.style.display = 'none';
    if (networkWarning) networkWarning.style.display = 'none';
}

// Show deployment log in modal
function showDeploymentLog(action, host, output) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal deployment-log-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Deployment Log: ${action.toUpperCase()} on ${host}</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="deployment-log-content">
            <pre><code>${output}</code></pre>
        </div>
    `;
    document.body.appendChild(modal);
}

// Validate compose file YAML syntax
function validateComposeFile() {
    const content = window.getCodeMirrorContent ? 
        window.getCodeMirrorContent('compose-editor') : 
        document.getElementById('compose-editor').value;
    
    if (!content.trim()) {
        showMessage('warning', 'Compose file is empty');
        return;
    }
    
    try {
        const parsed = jsyaml.load(content);
        
        // Basic validation
        if (!parsed) {
            throw new Error('Empty YAML document');
        }
        
        if (!parsed.services) {
            throw new Error('No services defined in compose file');
        }
        
        if (Object.keys(parsed.services).length === 0) {
            throw new Error('Services section is empty');
        }
        
        showMessage('success', `✅ Valid compose file with ${Object.keys(parsed.services).length} services`);
        
    } catch (error) {
        showMessage('error', `❌ Invalid YAML: ${error.message}`);
    }
}

// Show compose file preview
function showComposePreview() {
    const content = window.getCodeMirrorContent ? 
        window.getCodeMirrorContent('compose-editor') : 
        document.getElementById('compose-editor').value;
    
    if (!content.trim()) {
        showMessage('warning', 'Compose file is empty');
        return;
    }
    
    try {
        const parsed = jsyaml.load(content);
        const serviceCount = parsed.services ? Object.keys(parsed.services).length : 0;
        const networkCount = parsed.networks ? Object.keys(parsed.networks).length : 0;
        const volumeCount = parsed.volumes ? Object.keys(parsed.volumes).length : 0;
        
        const modal = document.createElement('div');
        modal.className = 'logs-modal';
        modal.innerHTML = `
            <div class="modal-header">
                <h3>Compose File Preview: ${currentComposeFile}</h3>
                <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
            </div>
            <div class="modal-content" style="padding: 1rem;">
                <div class="compose-summary">
                    <h4>Summary</h4>
                    <div class="summary-stats">
                        <span class="stat-badge">📦 ${serviceCount} Services</span>
                        <span class="stat-badge">🌐 ${networkCount} Networks</span>
                        <span class="stat-badge">💾 ${volumeCount} Volumes</span>
                    </div>
                    
                    ${serviceCount > 0 ? `
                        <h5>Services:</h5>
                        <ul>
                            ${Object.entries(parsed.services).map(([name, service]) => 
                                `<li><strong>${name}</strong> - ${service.image || 'No image specified'}</li>`
                            ).join('')}
                        </ul>
                    ` : ''}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
    } catch (error) {
        showMessage('error', `Cannot preview: ${error.message}`);
    }
}



// Deploy created project to host
async function deployProjectToHost(composePath, host, autoStart = true) {
    try {
        setLoading(true, `Deploying project to ${host}...`);
        
        const action = autoStart ? 'up' : 'down';
        
        const response = await fetch('/api/compose/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: composePath,
                host: host,
                action: action
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            showMessage('success', `Project deployed successfully to ${host}`);
            
            // Refresh containers
            if (typeof refreshContainers === 'function') {
                setTimeout(() => refreshContainers(), 1000);
            }
        } else {
            showMessage('error', `Deployment failed: ${result.message}`);
        }
        
    } catch (error) {
        console.error('Deploy project error:', error);
        showMessage('error', `Failed to deploy project: ${error.message}`);
    } finally {
        setLoading(false);
    }
}

// Get host information
async function getHostInfo(hostName) {
    try {
        const response = await fetch('/api/hosts');
        const data = await response.json();
        
        if (data.status === 'success' && data.hosts[hostName]) {
            return data.hosts[hostName];
        }
        
        return { name: hostName, url: 'unknown' };
    } catch (error) {
        return { name: hostName, url: 'unknown' };
    }
}

// Save compose file if there are unsaved changes
async function saveComposeIfNeeded() {
    // In a real implementation, you'd check if the file has been modified
    // For now, we'll just save it
    if (currentComposeFile) {
        await saveCompose();
    }
}

// Utility function for debouncing
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}




// Initialize hosts management when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    // Load hosts management if on hosts tab
    const hostsTab = document.getElementById('hosts-tab');
    if (hostsTab && hostsTab.classList.contains('active')) {
        loadHostsManagement();
    }
});

// Export functions for use in main.js
window.loadDockerHosts = loadDockerHosts;
window.switchToHost = switchToHost;
window.loadHostsList = loadHostsList;
window.addDockerHost = addDockerHost;
window.removeHost = removeHost;
window.testHost = testHost;
window.loadHostsManagement = loadHostsManagement;
window.loadMultiHostSystemOverview = loadMultiHostSystemOverview;
// Export functions for global access


