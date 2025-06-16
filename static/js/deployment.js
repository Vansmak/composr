// Integration script to enhance existing Composr with multi-host deployment
// Add this to your main.js or create a new deployment.js file

// Initialize enhanced config tab when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Add jsyaml library for YAML parsing
    if (!window.jsyaml) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
        script.onload = function() {
            console.log('js-yaml library loaded');
        };
        document.head.appendChild(script);
    }
    
    // Initialize enhanced features when config tab is first opened
    const configTab = document.querySelector('.tab[onclick="switchTab(\'config\')"]');
    if (configTab) {
        const originalSwitchTab = window.switchTab;
        window.switchTab = function(tabName) {
            originalSwitchTab(tabName);
            
            if (tabName === 'config') {
                setTimeout(() => {
                    if (typeof initializeEnhancedConfig === 'function') {
                        initializeEnhancedConfig();
                    }
                }, 100);
            }
        };
    }
});

// Enhanced switchSubTab function with deployment features
const originalSwitchSubTab = window.switchSubTab;
window.switchSubTab = function(subtabName) {
    if (originalSwitchSubTab) {
        originalSwitchSubTab(subtabName);
    }
    
    if (subtabName === 'compose') {
        setTimeout(() => {
            enhanceComposeSubtab();
            loadAvailableHosts();
        }, 100);
    } else if (subtabName === 'create') {
        setTimeout(() => {
            enhanceProjectCreation();
            loadAvailableHosts();
        }, 100);
    }
};

// Override the existing composeAction function to use new deployment system
window.composeAction = function(action, file = null) {
    const composeFile = file || currentComposeFile;
    if (!composeFile) {
        showMessage('error', 'No compose file selected');
        return;
    }
    
    // Check if enhanced deployment is available
    const deployHostSelect = document.getElementById('deploy-host-select');
    const selectedHost = deployHostSelect ? deployHostSelect.value : 'local';
    
    if (deployHostSelect && selectedHost !== 'local') {
        // Use enhanced deployment
        deployToSelectedHost(action);
    } else {
        // Use original deployment method
        deployOriginal(action, composeFile);
    }
};

// Original deployment method (fallback)
function deployOriginal(action, composeFile) {
    setLoading(true, `Performing ${action} on ${composeFile}...`);
    
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
        showMessage('error', `Failed to ${action} compose: ${error.message}`);
    });
}

// Enhanced create project function with deployment
const originalCreateProject = window.createProject;
window.createProject = async function() {
    // Check if deployment options are present
    const deployHost = document.getElementById('create-deploy-host');
    const autoStart = document.getElementById('auto-start');
    
    if (deployHost && deployHost.value) {
        // Use enhanced create and deploy
        return await createAndDeployToHost();
    } else if (originalCreateProject) {
        // Use original create project
        return originalCreateProject();
    } else {
        // Fallback implementation
        return await createProjectFallback();
    }
};

// Fallback create project implementation
async function createProjectFallback() {
    try {
        const projectName = document.getElementById('project-name')?.value;
        const location = document.getElementById('project-location')?.value || 'default';
        const composeContent = window.getCodeMirrorContent ? 
            window.getCodeMirrorContent('compose-content') : 
            document.getElementById('compose-content')?.value || '';
        const envContent = window.getCodeMirrorContent ? 
            window.getCodeMirrorContent('env-content') : 
            document.getElementById('env-content')?.value || '';
        const createEnvFile = document.getElementById('create-env-file')?.checked || false;
        
        if (!projectName) {
            showMessage('error', 'Project name is required');
            return false;
        }
        
        const response = await fetch('/api/compose/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_name: projectName,
                location_type: location,
                compose_content: composeContent,
                env_content: envContent,
                create_env_file: createEnvFile
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            showMessage('success', result.message);
            // Switch to compose tab and load the new file
            switchTab('config');
            setTimeout(() => {
                switchSubTab('compose');
                if (result.project && result.project.compose_file) {
                    localStorage.setItem('pendingComposeFile', result.project.compose_file);
                    loadComposeFiles();
                }
            }, 100);
            return true;
        } else {
            showMessage('error', result.message);
            return false;
        }
        
    } catch (error) {
        console.error('Create project error:', error);
        showMessage('error', `Failed to create project: ${error.message}`);
        return false;
    }
}

// Add deployment status monitoring
function monitorDeployment(deploymentId, callback) {
    const checkStatus = () => {
        fetch(`/api/deployment/status/${deploymentId}`)
            .then(response => response.json())
            .then(data => {
                if (data.deployment_status === 'completed' || data.deployment_status === 'failed') {
                    callback(data);
                } else {
                    setTimeout(checkStatus, 2000); // Check again in 2 seconds
                }
            })
            .catch(error => {
                console.error('Status check failed:', error);
                callback({ deployment_status: 'error', message: error.message });
            });
    };
    
    checkStatus();
}

// Add volume path validation helper
function validateVolumePaths(composePath, targetHost) {
    return new Promise((resolve) => {
        if (targetHost === 'local') {
            resolve({ valid: true, warnings: [] });
            return;
        }
        
        fetch('/api/compose/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: composePath,
                host: targetHost
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                const warnings = data.analysis.warnings || [];
                const volumeWarnings = warnings.filter(w => w.includes('Volume path'));
                
                resolve({
                    valid: volumeWarnings.length === 0,
                    warnings: volumeWarnings,
                    analysis: data.analysis
                });
            } else {
                resolve({ valid: false, warnings: [`Analysis failed: ${data.message}`] });
            }
        })
        .catch(error => {
            resolve({ valid: false, warnings: [`Validation error: ${error.message}`] });
        });
    });
}

// Add pre-deployment check function
async function performPreDeploymentCheck(composePath, targetHost) {
    try {
        const response = await fetch('/api/compose/pre-deploy-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: composePath,
                host: targetHost
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            return result.checks;
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error('Pre-deployment check failed:', error);
        return {
            ready_to_deploy: false,
            warnings: [`Pre-deployment check failed: ${error.message}`]
        };
    }
}

// Enhanced deployment with pre-checks
async function deployWithPreChecks(composePath, targetHost, action) {
    try {
        setLoading(true, 'Performing pre-deployment checks...');
        
        // Perform pre-deployment checks
        const checks = await performPreDeploymentCheck(composePath, targetHost);
        
        if (!checks.ready_to_deploy) {
            const warningsText = checks.warnings.join('\n');
            const proceed = confirm(`Pre-deployment checks found issues:\n\n${warningsText}\n\nDo you want to proceed anyway?`);
            
            if (!proceed) {
                setLoading(false);
                return;
            }
        }
        
        // Proceed with deployment
        setLoading(true, `Deploying to ${targetHost}...`);
        
        const response = await fetch('/api/compose/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: composePath,
                host: targetHost,
                action: action
            })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            showMessage('success', `Successfully deployed to ${targetHost}`);
            
            if (result.warnings && result.warnings.length > 0) {
                setTimeout(() => {
                    showMessage('warning', `Deployment completed with warnings: ${result.warnings.join(', ')}`);
                }, 2000);
            }
            
            // Show deployment log if available
            if (result.output) {
                setTimeout(() => {
                    showDeploymentLog(action, targetHost, result.output);
                }, 1000);
            }
            
            // Refresh containers
            if (typeof refreshContainers === 'function') {
                setTimeout(() => refreshContainers(), 1000);
            }
        } else {
            showMessage('error', `Deployment failed: ${result.message}`);
            
            if (result.output) {
                showDeploymentLog(action, targetHost, result.output);
            }
        }
        
    } catch (error) {
        console.error('Deployment error:', error);
        showMessage('error', `Deployment failed: ${error.message}`);
    } finally {
        setLoading(false);
    }
}

// Utility function to check if enhanced features are available
function isEnhancedDeploymentAvailable() {
    return (
        typeof loadAvailableHosts === 'function' &&
        typeof deployToSelectedHost === 'function' &&
        document.getElementById('deploy-host-select') !== null
    );
}

// Add host management integration
function integrateHostManagement() {
    // Add quick host switcher to header if not present
    const systemStats = document.querySelector('.system-stats');
    if (systemStats && !document.getElementById('quick-host-switcher')) {
        const hostSwitcher = document.createElement('div');
        hostSwitcher.id = 'quick-host-switcher';
        hostSwitcher.className = 'quick-host-switcher';
        hostSwitcher.innerHTML = `
            <select id="quick-host-select" class="host-select-mini" title="Current Docker Host">
                <option value="local">Local</option>
            </select>
        `;
        
        systemStats.appendChild(hostSwitcher);
        
        // Load hosts for quick switcher
        loadHostsForQuickSwitcher();
        
        // Add change handler
        document.getElementById('quick-host-select').addEventListener('change', function() {
            const newHost = this.value;
            if (newHost !== 'local') {
                if (confirm(`Switch context to ${newHost}? This will reload the container view.`)) {
                    switchToHost(newHost);
                } else {
                    this.value = 'local'; // Reset selection
                }
            }
        });
    }
}

// Load hosts for quick switcher
function loadHostsForQuickSwitcher() {
    fetch('/api/hosts')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('quick-host-select');
            if (!select) return;
            
            // Clear existing options except local
            select.innerHTML = '<option value="local">Local</option>';
            
            if (data.status === 'success' && data.hosts) {
                Object.entries(data.hosts).forEach(([hostName, hostInfo]) => {
                    if (hostName !== 'local' && hostInfo.connected) {
                        const option = document.createElement('option');
                        option.value = hostName;
                        option.textContent = hostInfo.name || hostName;
                        
                        if (hostName === data.current_host) {
                            option.selected = true;
                        }
                        
                        select.appendChild(option);
                    }
                });
            }
        })
        .catch(error => {
            console.error('Failed to load hosts for quick switcher:', error);
        });
}

// Initialize enhanced deployment features
function initializeEnhancedDeployment() {
    console.log('Initializing enhanced multi-host deployment features...');
    
    // Integrate host management
    integrateHostManagement();
    
    // Add deployment status to system stats
    addDeploymentStatusToStats();
    
    // Initialize keyboard shortcuts
    initializeDeploymentShortcuts();
    
    console.log('Enhanced deployment features initialized');
}

// Add deployment status to system stats
function addDeploymentStatusToStats() {
    const statsGrid = document.querySelector('.stats-grid');
    if (statsGrid && !document.getElementById('deployment-status-stat')) {
        const deploymentStat = document.createElement('div');
        deploymentStat.id = 'deployment-status-stat';
        deploymentStat.className = 'stat-item';
        deploymentStat.innerHTML = `
            <span>Active Deployments: <span id="active-deployments">0</span></span>
        `;
        statsGrid.appendChild(deploymentStat);
    }
}

// Initialize keyboard shortcuts for deployment
function initializeDeploymentShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ctrl+Shift+D: Quick deploy to local
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            if (currentComposeFile) {
                deployToSelectedHost('up');
            } else {
                showMessage('warning', 'No compose file selected');
            }
        }
        
        // Ctrl+Shift+S: Stop current deployment
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            if (currentComposeFile) {
                deployToSelectedHost('down');
            } else {
                showMessage('warning', 'No compose file selected');
            }
        }
    });
}

// Auto-initialize when script loads
setTimeout(() => {
    initializeEnhancedDeployment();
}, 1000);

// Export enhanced functions for global access
window.deployWithPreChecks = deployWithPreChecks;
window.monitorDeployment = monitorDeployment;
window.validateVolumePaths = validateVolumePaths;
window.performPreDeploymentCheck = performPreDeploymentCheck;
window.isEnhancedDeploymentAvailable = isEnhancedDeploymentAvailable;
window.integrateHostManagement = integrateHostManagement;