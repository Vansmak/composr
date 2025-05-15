// static/js/remote.js - Docker Remote Host Management

// Load available Docker hosts on startup
function loadDockerHosts() {
    fetch('/api/docker/hosts')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('docker-host-select');
            if (!select) return;
            
            select.innerHTML = '';
            
            // data.hosts is an object, not an array
            Object.keys(data.hosts).forEach(host => {
                const option = document.createElement('option');
                option.value = host;
                option.textContent = host;
                
                // Check if it's connected
                if (!data.hosts[host].connected) {
                    option.textContent += ' (offline)';
                }
                
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

// Load and display hosts list in management tab
function loadHostsList() {
    fetch('/api/docker/hosts')
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('hosts-list-content');
            if (!container) return;
            
            container.innerHTML = '';
            
            Object.entries(data.hosts).forEach(([name, info]) => {
                const hostDiv = document.createElement('div');
                hostDiv.className = 'host-item';
                hostDiv.innerHTML = `
                    <div class="host-info">
                        <strong>${name}</strong>
                        <span class="host-status ${info.connected ? 'connected' : 'disconnected'}">
                            ${info.connected ? '● Connected' : '○ Disconnected'}
                        </span>
                        ${info.current ? '<span class="current-badge">Current</span>' : ''}
                    </div>
                    <div class="host-actions">
                        ${name !== 'local' ? `<button class="btn btn-error btn-sm" onclick="removeDockerHost('${name}')">Remove</button>` : ''}
                        <button class="btn btn-primary btn-sm" onclick="testDockerHost('${name}')">Test</button>
                    </div>
                `;
                container.appendChild(hostDiv);
            });
        })
        .catch(error => {
            console.error('Failed to load hosts:', error);
        });
}

// Add a new Docker host
function addDockerHost() {
    const name = document.getElementById('new-host-name').value.trim();
    const url = document.getElementById('new-host-url').value.trim();
    const group = document.getElementById('new-host-group').value.trim();
    
    if (!name || !url) {
        showMessage('error', 'Name and URL are required');
        return;
    }
    
    fetch('/api/docker/hosts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, group })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            showMessage('success', result.message);
            // Clear form
            document.getElementById('new-host-name').value = '';
            document.getElementById('new-host-url').value = '';
            document.getElementById('new-host-group').value = '';
            // Reload lists
            loadHostsList();
            loadDockerHosts();
        } else {
            showMessage('error', result.message);
        }
    })
    .catch(error => {
        showMessage('error', 'Failed to add host');
    });
}

// Remove a Docker host
function removeDockerHost(name) {
    if (!confirm(`Remove Docker host "${name}"?`)) {
        return;
    }
    
    fetch('/api/docker/hosts/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            showMessage('success', result.message);
            loadHostsList();
            loadDockerHosts();
        } else {
            showMessage('error', result.message);
        }
    })
    .catch(error => {
        showMessage('error', 'Failed to remove host');
    });
}

// Test a Docker host connection
function testDockerHost(name) {
    setLoading(true, `Testing connection to ${name}...`);
    
    // First get the host URL
    fetch('/api/docker/hosts')
        .then(response => response.json())
        .then(data => {
            const hostUrl = data.hosts[name]?.url;
            if (!hostUrl) {
                throw new Error('Host URL not found');
            }
            
            return fetch('/api/docker/hosts/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: hostUrl })
            });
        })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            if (result.status === 'success') {
                showMessage('success', `Connection to ${name} successful`);
                loadHostsList(); // Refresh the list
            } else {
                showMessage('error', result.message);
            }
        })
        .catch(error => {
            setLoading(false);
            showMessage('error', 'Connection test failed');
        });
}

// Export functions for use in main.js
window.loadDockerHosts = loadDockerHosts;
window.switchDockerHost = switchDockerHost;
window.loadHostsList = loadHostsList;
window.addDockerHost = addDockerHost;
window.removeDockerHost = removeDockerHost;
window.testDockerHost = testDockerHost;