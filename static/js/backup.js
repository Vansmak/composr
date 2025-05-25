// Add these backup functions to your main.js or create a new backup.js file

// Backup Management Functions
let backupPreviewData = null;

// Load backup preview when backup tab is opened
function loadBackupPreview() {
    setLoading(true, 'Loading backup preview...');
    
    fetch('/api/backup/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        setLoading(false);
        
        if (data.status === 'success') {
            backupPreviewData = data.preview;
            updateBackupPreview(data.preview);
        } else {
            showMessage('error', data.message || 'Failed to load backup preview');
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to load backup preview:', error);
        showMessage('error', 'Failed to load backup preview');
    });
}

// Update the backup preview display
function updateBackupPreview(preview) {
    const previewElement = document.getElementById('backup-preview');
    if (!previewElement) return;
    
    previewElement.innerHTML = `
        <div class="backup-preview-stats">
            <div class="backup-stat">
                <span class="backup-stat-number">${preview.compose_files}</span>
                <span class="backup-stat-label">Compose</span>
            </div>
            <div class="backup-stat">
                <span class="backup-stat-number">${preview.env_files}</span>
                <span class="backup-stat-label">Env Files</span>
            </div>
            <div class="backup-stat">
                <span class="backup-stat-number">${preview.containers}</span>
                <span class="backup-stat-label">Containers</span>
            </div>
        </div>
    `;
}

// Create a backup
function createBackup() {
    const backupName = document.getElementById('backup-name').value.trim();
    const includeEnvFiles = document.getElementById('include-env-files').checked;
    const includeComposeFiles = document.getElementById('include-compose-files').checked;
    
    if (!backupName) {
        showMessage('error', 'Please enter a backup name');
        return;
    }
    
    // Validate backup name (no special characters that would break filenames)
    if (!/^[a-zA-Z0-9_-]+$/.test(backupName)) {
        showMessage('error', 'Backup name can only contain letters, numbers, underscores, and hyphens');
        return;
    }
    
    const backupOptions = {
        backup_name: backupName,
        include_env_files: includeEnvFiles,
        include_compose_files: includeComposeFiles
    };
    
    setLoading(true, 'Creating backup... This may take a moment.');
    
    fetch('/api/backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupOptions)
    })
    .then(response => {
        setLoading(false);
        
        if (response.ok) {
            // File download - create blob and download
            return response.blob().then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${backupName}.zip`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                showMessage('success', `Backup created and downloaded: ${backupName}.zip`);
                
                // Reset form
                document.getElementById('backup-name').value = '';
                
                // Add to backup history
                addToBackupHistory(backupName, new Date().toISOString());
            });
        } else {
            return response.json().then(data => {
                throw new Error(data.message || 'Failed to create backup');
            });
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to create backup:', error);
        showMessage('error', `Failed to create backup: ${error.message}`);
    });
}

// Restore from backup file
function restoreBackup() {
    const fileInput = document.getElementById('backup-file-input');
    const file = fileInput.files[0];
    
    if (!file) {
        showMessage('error', 'Please select a backup file');
        return;
    }
    
    if (!file.name.endsWith('.zip')) {
        showMessage('error', 'Please select a valid backup file (.zip)');
        return;
    }
    
    const formData = new FormData();
    formData.append('backup_file', file);
    
    setLoading(true, 'Restoring backup... This may take a moment.');
    
    fetch('/api/backup/restore', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        
        if (result.status === 'success') {
            showBackupRestoreSuccess(result);
            
            // Clear file input
            fileInput.value = '';
            
            // Refresh compose files and containers
            if (typeof loadComposeFiles === 'function') loadComposeFiles();
            if (typeof refreshContainers === 'function') refreshContainers();
        } else {
            showMessage('error', result.message || 'Failed to restore backup');
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to restore backup:', error);
        showMessage('error', `Failed to restore backup: ${error.message}`);
    });
}

// Show backup restore success modal
function showBackupRestoreSuccess(result) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>✅ Backup Restored Successfully</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <div class="success-section">
                <h4>Backup Information</h4>
                <p><strong>Name:</strong> ${result.backup_info.name}</p>
                <p><strong>Created:</strong> ${new Date(result.backup_info.created).toLocaleString()}</p>
                <p><strong>Original Host:</strong> ${result.backup_info.host}</p>
                <p><strong>Containers:</strong> ${result.backup_info.container_count}</p>
            </div>
            
            <div class="restore-summary">
                <h4>Restored Items</h4>
                <ul>
                    <li><strong>${result.restored.compose_files}</strong> compose files</li>
                    <li><strong>${result.restored.env_files}</strong> environment files</li>
                    <li><strong>${result.restored.container_metadata}</strong> container settings (tags & URLs)</li>
                </ul>
            </div>
            
            <div class="next-steps">
                <h4>Next Steps</h4>
                <p>Your backup has been restored to the compose directory. You can now:</p>
                <ol>
                    <li>Go to the <strong>Config</strong> tab to review restored compose files</li>
                    <li>Deploy individual projects using the compose files</li>
                    <li>Or deploy everything at once using the backup compose file</li>
                </ol>
            </div>
            
            <div class="actions" style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
                <button class="btn btn-primary" onclick="switchTab('config'); this.closest('.logs-modal').remove();">
                    View Compose Files
                </button>
                <button class="btn btn-secondary" onclick="this.closest('.logs-modal').remove();">
                    Close
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Backup history management (stored in localStorage) - simplified to just track last backup
function addToBackupHistory(backupName, timestamp) {
    try {
        // Just store the last backup info
        const lastBackup = {
            name: backupName,
            created: timestamp
        };
        
        localStorage.setItem('composr-last-backup', JSON.stringify(lastBackup));
        updateBackupHistoryDisplay();
    } catch (error) {
        console.error('Failed to update backup history:', error);
    }
}

function updateBackupHistoryDisplay() {
    const historyElement = document.getElementById('backup-history');
    if (!historyElement) return;
    
    try {
        const lastBackup = JSON.parse(localStorage.getItem('composr-last-backup') || 'null');
        
        if (!lastBackup) {
            historyElement.innerHTML = '<p class="no-backups">No backups created yet</p>';
            return;
        }
        
        historyElement.innerHTML = `
            <h4>Last Backup</h4>
            <div class="last-backup-info">
                <div class="last-backup-details">
                    <span class="last-backup-name">${lastBackup.name}</span>
                    <span class="last-backup-date">${new Date(lastBackup.created).toLocaleString()}</span>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Failed to display backup history:', error);
        historyElement.innerHTML = '<p class="no-backups">Error loading backup history</p>';
    }
}

// Initialize backup tab when it's first opened
function initializeBackupTab() {
    // Set default backup name
    const now = new Date();
    const defaultName = `backup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    const backupNameInput = document.getElementById('backup-name');
    if (backupNameInput && !backupNameInput.value) {
        backupNameInput.value = defaultName;
    }
    
    // Load preview and history
    loadBackupPreview();
    updateBackupHistoryDisplay();
}

// File input change handler
function handleBackupFileSelect() {
    const fileInput = document.getElementById('backup-file-input');
    const fileName = document.getElementById('selected-file-name');
    
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        fileName.textContent = file.name;
        fileName.style.display = 'block';
    } else {
        fileName.style.display = 'none';
    }
}

// Export backup functions to global scope
window.createBackup = createBackup;
window.restoreBackup = restoreBackup;
window.loadBackupPreview = loadBackupPreview;
window.initializeBackupTab = initializeBackupTab;
window.handleBackupFileSelect = handleBackupFileSelect;
window.addToBackupHistory = addToBackupHistory;
window.updateBackupHistoryDisplay = updateBackupHistoryDisplay;