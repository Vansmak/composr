// static/js/remote.js - Composr Instance Bookmarks Management



// Switch to another Composr instance
function switchDockerHost() {
    const select = document.getElementById('composr-instance-selector') || 
                  document.getElementById('docker-host-select');
    if (!select) return;
    
    const newHostUrl = select.value;
    if (!newHostUrl) return;
    
    // Simply redirect to the selected Composr instance
    window.location.href = newHostUrl;
}



// Add a new Composr instance
function addDockerHost() {
    const name = document.getElementById('new-host-name').value.trim();
    const url = document.getElementById('new-host-url').value.trim();
    const group = document.getElementById('new-host-group').value.trim();
    
    if (!name || !url) {
        showMessage('error', 'Name and URL are required');
        return;
    }
    
    // Validate URL format
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        showMessage('error', 'URL must start with http:// or https://');
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
        showMessage('error', 'Failed to add instance');
    });
}

// Remove a Composr instance bookmark
function removeDockerHost(name) {
    if (!confirm(`Remove Composr instance "${name}" from bookmarks?`)) {
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
        showMessage('error', 'Failed to remove instance');
    });
}

// Open a Composr instance in a new tab
function openComposrInstance(url) {
    window.open(url, '_blank');
}

// Test if a Composr instance is reachable
function testComposrInstance(name, url) {
    setLoading(true, `Testing connection to ${name}...`);
    
    // Use fetch with a timeout to test if the URL is reachable
    const timeoutDuration = 5000; // 5 seconds timeout
    
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), timeoutDuration);
    });
    
    Promise.race([
        fetch(url, { mode: 'no-cors' }), // no-cors mode to test if URL is reachable
        timeoutPromise
    ])
    .then(() => {
        setLoading(false);
        showMessage('success', `Connection to ${name} successful`);
    })
    .catch(error => {
        setLoading(false);
        showMessage('error', `Connection to ${name} failed: ${error.message}`);
    });
}

// Load available hosts
function loadDockerHosts() {
    fetch('/api/docker/hosts')
        .then(response => response.json())
        .then(data => {
            const instanceSelector = document.getElementById('composr-instance-selector');
            if (instanceSelector) {
                instanceSelector.innerHTML = '<option value="">Current Instance</option>';
                
                Object.keys(data.hosts).forEach(host => {
                    if (host !== 'local') {
                        const option = document.createElement('option');
                        option.value = data.hosts[host].url;
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

// Load and display hosts list
function loadHostsList() {
    fetch('/api/docker/hosts')
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('hosts-list-content');
            if (!container) return;
            
            container.innerHTML = '';
            
            Object.entries(data.hosts).forEach(([name, info]) => {
                if (name === 'local') return;
                
                const hostDiv = document.createElement('div');
                hostDiv.className = 'host-item';
                hostDiv.innerHTML = `
                    <div class="host-info">
                        <strong>${name}</strong>
                        <span>${info.url}</span>
                    </div>
                    <div class="host-actions">
                        <button class="btn btn-primary btn-sm" onclick="window.open('${info.url}', '_blank')">Open</button>
                        <button class="btn btn-error btn-sm" onclick="removeDockerHost('${name}')">Remove</button>
                    </div>
                `;
                container.appendChild(hostDiv);
            });
        })
        .catch(error => {
            console.error('Failed to load hosts:', error);
        });
}

// Add simplified event listener for instance selector
document.addEventListener('DOMContentLoaded', () => {
    const instanceSelector = document.getElementById('composr-instance-selector');
    if (instanceSelector) {
        instanceSelector.addEventListener('change', () => {
            const selectedUrl = instanceSelector.value;
            if (selectedUrl) {
                window.location.href = selectedUrl;
            }
        });
    }
});

// Export functions for use in main.js
window.loadDockerHosts = loadDockerHosts;
window.switchDockerHost = switchDockerHost;
window.loadHostsList = loadHostsList;
window.addDockerHost = addDockerHost;
window.removeDockerHost = removeDockerHost;
window.testComposrInstance = testComposrInstance;
window.openComposrInstance = openComposrInstance;