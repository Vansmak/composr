
// Project Creation Functions
// =========================

// Variables for project creation
let templates = [];
let currentStep = 1;
// CodeMirror Editor functions
let codeMirrorEditors = {};

function initializeCodeMirrorEditor(elementId, language = 'yaml') {
    console.log(`Initializing CodeMirror editor for ${elementId}`);
    
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element ${elementId} not found`);
        return;
    }
    
    // Check if editor already exists
    if (codeMirrorEditors[elementId]) {
        console.log(`Editor ${elementId} already exists, skipping`);
        return;
    }
    
    // Wait for CodeMirror to be available
    if (typeof CodeMirror === 'undefined') {
        console.log('CodeMirror not yet loaded, retrying...');
        setTimeout(() => initializeCodeMirrorEditor(elementId, language), 1000);
        return;
    }
    
    // Create CodeMirror editor using fromTextArea (this automatically hides the textarea)
    const editor = CodeMirror.fromTextArea(element, {
        mode: language,
        theme: 'darcula',
        lineNumbers: true,
        lineWrapping: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        height: '400px'  // Set a fixed height
    });
    
    // Store editor instance
    codeMirrorEditors[elementId] = editor;
    console.log(`Successfully created CodeMirror editor for ${elementId}`);
}

function updateCodeMirrorContent(elementId, content) {
    const editor = codeMirrorEditors[elementId];
    if (editor) {
        editor.setValue(content);
    } else {
        const element = document.getElementById(elementId);
        if (element) element.value = content;
    }
}

function getCodeMirrorContent(elementId) {
    const editor = codeMirrorEditors[elementId];
    if (editor) {
        return editor.getValue();
    } else {
        const element = document.getElementById(elementId);
        return element ? element.value : '';
    }
}

function setCodeMirrorLanguage(elementId, language) {
    const editor = codeMirrorEditors[elementId];
    if (editor) {
        editor.setOption('mode', language);
    }
}

function initCodeMirrorLoader() {
    console.log('CodeMirror loader initialized');
}
// Load available templates when compose tab is opened
function loadTemplates() {
    console.log('Loading templates...');
    fetch('/api/compose/templates')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success' && data.templates.length > 0) {
                templates = data.templates;
                // Just auto-load the first (and only) template
                setTimeout(() => {
                    updateTemplateContent(templates[0].id);
                }, 500);
            }
        })
        .catch(error => {
            console.error('Failed to load templates:', error);
        });
}

// Update template content when selection changes
function updateTemplateContent(templateId) {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
   
    // Update the compose content
    const composeContent = document.getElementById('compose-content');
    if (composeContent) {
        composeContent.value = template.compose_content;
        
        // Also update CodeMirror editor if it exists
        if (codeMirrorEditors['compose-content']) {
            codeMirrorEditors['compose-content'].setValue(template.compose_content);
            // Force refresh to make content visible
            setTimeout(() => {
                codeMirrorEditors['compose-content'].refresh();
            }, 100);
        }
    }
   
    // Update the env content
    const envContent = document.getElementById('env-content');
    if (envContent) {
        envContent.value = template.env_content;
        
        // Also update CodeMirror editor if it exists
        if (codeMirrorEditors['env-content']) {
            codeMirrorEditors['env-content'].setValue(template.env_content);
            setTimeout(() => {
                codeMirrorEditors['env-content'].refresh();
            }, 100);
        }
    }
}


// Add this to editor.js
function showProjectCreationForm() {
    // Get references to elements
    const projectCreationForm = document.getElementById('project-creation-form');
    const composeEditorContainer = document.getElementById('compose-editor-codemirror') || 
                                   document.getElementById('compose-editor').parentNode;
    const editorActions = document.querySelector('.editor-actions');
    
    // Show the project creation form
    if (projectCreationForm) {
        projectCreationForm.style.display = 'block';
    }
    
    // Hide the editor and actions
    if (composeEditorContainer) {
        composeEditorContainer.style.display = 'none';
    }
    
    if (editorActions) {
        editorActions.style.display = 'none';
    }
    
    // Load templates
    loadTemplates();
    
    // Reset form to step 1
    goToStep(1);
}

// Add function to return to editor view
function hideProjectCreationForm() {
    const projectCreationForm = document.getElementById('project-creation-form');
    const composeEditor = document.getElementById('compose-editor');
    const codeMirrorContainer = document.getElementById('compose-editor-codemirror');
    const editorActions = document.querySelector('.editor-actions');
    const select = document.getElementById('compose-files');
    
    // Hide the project creation form
    if (projectCreationForm) {
        projectCreationForm.style.display = 'none';
    }
    
    // Show the editor and actions
    if (codeMirrorContainer) {
        codeMirrorContainer.style.display = 'block';
    }
    if (composeEditor) {
        composeEditor.style.display = 'none';
    }
    if (editorActions) {
        editorActions.style.display = 'flex';
    }
    
    // Clear the Monaco editor content
    if (window.updateCodeMirrorContent) {
        window.updateCodeMirrorContent('compose-editor', '');
    }
    
    // Reset dropdown selection
    if (select) {
        select.value = '';
    }
    
    // Reset form inputs
    document.getElementById('project-name').value = '';
    if (document.getElementById('custom-path')) {
        document.getElementById('custom-path').value = '';
    }
    document.getElementById('compose-content').value = '';
    document.getElementById('env-content').value = '';
    document.getElementById('create-env-file').checked = true;
    if (window.updateCodeMirrorContent) {
        window.updateCodeMirrorContent('compose-content', '');
        window.updateCodeMirrorContent('env-content', '');
    }
}


// FIX: Update the extract environment variables function for compose subtab
function extractEnvFromCompose() {
    // Check if we're in the create subtab or compose subtab
    const createSubtab = document.getElementById('create-subtab');
    const composeSubtab = document.getElementById('compose-subtab');
    
    let composeContent = '';
    
    if (createSubtab && createSubtab.classList.contains('active')) {
        // We're in create subtab - get content from create form
        composeContent = document.getElementById('compose-content').value;
        if (codeMirrorEditors['compose-content']) {
            composeContent = codeMirrorEditors['compose-content'].getValue();
        }
        
        if (!composeContent) {
            showMessage('error', 'Please enter compose file content first');
            return;
        }
        
        extractFromContent(composeContent, 'env-content');
        
    } else if (composeSubtab && composeSubtab.classList.contains('active')) {
        // We're in compose subtab - get content from compose editor
        composeContent = document.getElementById('compose-editor').value;
        if (codeMirrorEditors['compose-editor']) {
            composeContent = codeMirrorEditors['compose-editor'].getValue();
        }
        
        if (!composeContent) {
            showMessage('error', 'Please load a compose file first');
            return;
        }
        
        // For compose subtab, create a new .env file
        extractFromContent(composeContent, null, true);
    }
}
// Helper function to extract from content
function extractFromContent(composeContent, targetElementId, createNewEnvFile = false) {
    setLoading(true, 'Extracting environment variables...');
    
    fetch('/api/compose/extract-env-from-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: composeContent })
    })
    .then(response => response.json())
    .then(data => {
        setLoading(false);
        
        if (data.status === 'success') {
            if (createNewEnvFile) {
                // For compose subtab - create new .env file modal
                showEnvCreationModal(data.content);
            } else if (targetElementId) {
                // For create subtab - update the env-content textarea
                const envContentEl = document.getElementById(targetElementId);
                if (envContentEl) {
                    envContentEl.value = data.content.trim();
                    
                    // Update CodeMirror editor if it exists
                    if (codeMirrorEditors[targetElementId]) {
                        codeMirrorEditors[targetElementId].setValue(data.content.trim());
                    }
                }
                
                showMessage('success', 'Environment variables extracted successfully');
            }
        } else {
            showMessage('error', data.message || 'Failed to extract environment variables');
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to extract environment variables:', error);
        showMessage('error', 'Failed to extract environment variables');
    });
}

// New function to show env creation modal for compose subtab
function showEnvCreationModal(envContent) {
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Create Environment File</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <div class="form-group">
                <label for="env-file-name">File name:</label>
                <input type="text" id="env-file-name" value=".env" class="url-input">
                <p class="help-text">The file will be created in the same directory as the compose file</p>
            </div>
            <div class="form-group">
                <label for="extracted-env-content">Environment variables:</label>
                <textarea id="extracted-env-content" style="width: 100%; height: 300px; font-family: monospace;">${envContent}</textarea>
            </div>
            <div class="form-actions" style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1rem;">
                <button class="btn btn-secondary" onclick="this.closest('.logs-modal').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="createEnvFileFromModal()">Create File</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Function to handle creating env file from modal
function createEnvFileFromModal() {
    const fileName = document.getElementById('env-file-name').value;
    const envContent = document.getElementById('extracted-env-content').value;
    
    if (!fileName || !envContent) {
        showMessage('error', 'Please provide both file name and content');
        return;
    }
    
    if (!currentComposeFile) {
        showMessage('error', 'No compose file selected');
        return;
    }
    
    // Determine the path for the .env file (same directory as compose file)
    const composePath = currentComposeFile;
    const envPath = composePath.substring(0, composePath.lastIndexOf('/') + 1) + fileName;
    
    setLoading(true, 'Creating environment file...');
    
    fetch('/api/env/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            path: envPath, 
            content: envContent 
        })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        
        if (result.status === 'success') {
            showMessage('success', `Environment file created: ${envPath}`);
            
            // Close modal
            document.querySelectorAll('.logs-modal').forEach(modal => modal.remove());
            
            // Refresh env files list if user switches to env tab
            scanEnvFiles();
        } else {
            showMessage('error', result.message || 'Failed to create environment file');
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to create environment file:', error);
        showMessage('error', 'Failed to create environment file');
    });
}

// Update goToStep for the new workflow
function goToStep(step) {
    let nextStepEl;
    
    if (step === 1) {
        nextStepEl = document.getElementById('step-project-info');
    /*
    } else if (step === 2) {
        nextStepEl = document.getElementById('step-env-vars');
        
        // Validate project name before proceeding
        const projectName = document.getElementById('project-name').value;
        if (!projectName) {
            showMessage('error', 'Please enter a project name');
            return;
        }
        
        // IMPORTANT: Get the current content from the CodeMirror editor
        if (codeMirrorEditors['compose-content']) {
            const currentComposeContent = codeMirrorEditors['compose-content'].getValue();
            document.getElementById('compose-content').value = currentComposeContent;
        }
    */
    } else if (step === 2) {
        nextStepEl = document.getElementById('step-project-review');
        
        // Capture current editor content before proceeding
        if (codeMirrorEditors['compose-content']) {
            const currentComposeContent = codeMirrorEditors['compose-content'].getValue();
            document.getElementById('compose-content').value = currentComposeContent;
        }
        if (codeMirrorEditors['env-content']) {
            const currentEnvContent = codeMirrorEditors['env-content'].getValue();
            document.getElementById('env-content').value = currentEnvContent;
        }
        
        // Update review page
        const projectName = document.getElementById('project-name').value;
        const projectLocation = document.getElementById('project-location').value;
        const customPath = document.getElementById('custom-path').value;
        const composeContent = document.getElementById('compose-content').value; // Now has the updated content
        //const createEnvFile = document.getElementById('create-env-file').checked;
        //const envContent = createEnvFile ? document.getElementById('env-content').value : '';
        
        // ... rest of the function
        // Update preview
        document.getElementById('preview-project-name').textContent = projectName;
        document.getElementById('preview-location').textContent = 
            projectLocation === 'default' ? 'default directory' : customPath;
        document.getElementById('preview-compose-content').textContent = composeContent;
        
        // Show/hide env preview
        /*const envPreview = document.getElementById('preview-env-file');
        if (envPreview) {
            envPreview.style.display = createEnvFile ? 'block' : 'none';
            if (createEnvFile) {
                document.getElementById('preview-env-content').textContent = envContent;
            }
        }*/
    }
    
    // Hide all steps
    document.querySelectorAll('.form-step').forEach(el => {
        el.classList.remove('active');
    });
    
    // Show the requested step
    if (nextStepEl) {
        nextStepEl.classList.add('active');
        currentStep = step;
    }
}

// Update createProject function for the new options
function createProject() {
    // FIX: Get the current content from CodeMirror editors before submitting
    const projectName = document.getElementById('project-name').value;
    const projectLocation = document.getElementById('project-location').value;
    const customPathEl = document.getElementById('custom-path');
    const customPath = customPathEl ? customPathEl.value : '';
    const templateId = 'generic'; 
    
    // FIX: Get content from CodeMirror editors if they exist
    let composeContent = document.getElementById('compose-content').value;
    if (codeMirrorEditors['compose-content']) {
        composeContent = codeMirrorEditors['compose-content'].getValue();
    }
    
    const createEnvFile = document.getElementById('create-env-file').checked;
    let envContent = '';
    if (createEnvFile) {
        envContent = document.getElementById('env-content').value;
        if (codeMirrorEditors['env-content']) {
            envContent = codeMirrorEditors['env-content'].getValue();
        }
    }
   
    // Debugging
    console.log('=== PROJECT CREATION DEBUG ===');
    console.log('projectName:', projectName);
    console.log('projectLocation:', projectLocation);
    console.log('createEnvFile:', createEnvFile);
    console.log('envContent exists:', !!envContent);
    console.log('envContent length:', envContent.length);
    console.log('composeContent length:', composeContent.length);
   
    setLoading(true, 'Creating project...');
   
    fetch('/api/compose/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            project_name: projectName,
            location_type: projectLocation,  // FIX: Send location_type not location
            custom_path: customPath,
            template_id: templateId,
            compose_content: composeContent,
            create_env_file: createEnvFile,
            env_content: envContent
        })
    })
    .then(response => response.json())
    .then(result => {
        setLoading(false);
        
        if (result.status === 'success') {
            showMessage('success', result.message);
            
            // FIX: Properly reset the form and return to compose view
            resetCreateForm();
            returnToComposeFiles();
        } else {
            showMessage('error', result.message);
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to create project:', error);
        showMessage('error', 'Failed to create project');
    });
}
// Handle compose file selection, including "Create New" option
function handleComposeFileSelection() {
    const select = document.getElementById('compose-files');
    const creationForm = document.getElementById('project-creation-form');
    const editorInterface = document.getElementById('compose-editor-interface');
    
    if (select.value === '__new__') {
        // Show project creation form, hide editor
        creationForm.style.display = 'block';
        editorInterface.style.display = 'none';
        
        // Load templates for the creation form
        loadTemplates();
        
        // Reset form to step 1
        goToStep(1);
    } else if (select.value) {
        // Show editor, hide creation form
        creationForm.style.display = 'none';
        editorInterface.style.display = 'block';
        
        // Load the selected file (existing functionality)
        currentComposeFile = select.value;
        loadCompose();
    }
}
// Enhanced returnToComposeFiles to also close any open modals
function returnToComposeFiles() {
    // Close any open modals first
    document.querySelectorAll('.logs-modal').forEach(modal => modal.remove());
    
    // Hide project creation form
    const projectCreationForm = document.getElementById('project-creation-form');
    if (projectCreationForm) {
        projectCreationForm.style.display = 'none';
    }
    
    // Switch back to compose subtab
    switchSubTab('compose');
    
    // Reset dropdown and clear editor
    const select = document.getElementById('compose-files');
    if (select) {
        select.value = '';
    }
    
    if (window.updateCodeMirrorContent && codeMirrorEditors['compose-editor']) {
        window.updateCodeMirrorContent('compose-editor', '');
    }
    
    // Clear the compose editor content to avoid confusion
    currentComposeFile = '';
    
    // Reload compose files to show all projects including the newly created one
    loadComposeFiles();
}



// Also add a function to return to editor after project creation
function returnToEditor() {
    const creationForm = document.getElementById('project-creation-form');
    const editorInterface = document.getElementById('compose-editor-interface');
    const select = document.getElementById('compose-files');
    
    // Show editor, hide creation form
    creationForm.style.display = 'none';
    editorInterface.style.display = 'block';
    
    // Reset dropdown selection
    select.value = '';
    
    // Reload compose files to show the newly created project
    loadComposeFiles();
}
function createAndDeployProject() {
    // Get current content from CodeMirror editors
    const projectName = document.getElementById('project-name').value;
    const projectLocation = document.getElementById('project-location').value;
    const templateId = 'generic';
    
    let composeContent = document.getElementById('compose-content').value;
    if (codeMirrorEditors['compose-content']) {
        composeContent = codeMirrorEditors['compose-content'].getValue();
    }
    
    const createEnvFile = document.getElementById('create-env-file').checked;
    let envContent = '';
    if (createEnvFile) {
        envContent = document.getElementById('env-content').value;
        if (codeMirrorEditors['env-content']) {
            envContent = codeMirrorEditors['env-content'].getValue();
        }
    }
    
    setLoading(true, 'Creating project...');
    
    // First create the project
    fetch('/api/compose/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            project_name: projectName,
            location_type: projectLocation,
            template_id: templateId,
            compose_content: composeContent,
            create_env_file: createEnvFile,
            env_content: envContent
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.status === 'success') {
            // Project created successfully - now try to deploy
            setLoading(true, 'Project created! Now deploying...');
            
            const composeFile = `${projectName}/docker-compose.yml`;
            
            return fetch('/api/compose/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file: composeFile,
                    action: 'restart',
                    pull: true
                })
            })
            .then(deployResponse => deployResponse.json())
            .then(deployResult => {
                setLoading(false);
                
                if (deployResult.status === 'success') {
                    // Both creation and deployment successful
                    showMessage('success', `Project ${projectName} created and deployed successfully!`);
                    
                    // Reset form and return to compose view
                    resetCreateForm();
                    returnToComposeFiles();
                    
                    // Refresh containers to show new ones
                    refreshContainers();
                } else {
                    // Project created but deployment failed
                    handlePartialSuccess(projectName, composeFile, deployResult.message);
                }
            })
            .catch(deployError => {
                setLoading(false);
                console.error('Deployment failed:', deployError);
                handlePartialSuccess(projectName, composeFile, deployError.message);
            });
            
        } else {
            // Project creation failed
            setLoading(false);
            showMessage('error', `Failed to create project: ${result.message}`);
        }
    })
    .catch(error => {
        setLoading(false);
        console.error('Failed to create project:', error);
        showMessage('error', `Failed to create project: ${error.message}`);
    });
}

// New function to handle partial success (project created but deployment failed)
function handlePartialSuccess(projectName, composeFile, deployError) {
    // Show success message with deployment failure info
    showMessage('warning', `Project ${projectName} created successfully, but deployment failed. Opening compose file for review.`);
    
    // Create a detailed modal with options
    const modal = document.createElement('div');
    modal.className = 'logs-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Project Created - Deployment Failed</h3>
            <span class="close-x" onclick="this.closest('.logs-modal').remove()">×</span>
        </div>
        <div class="modal-content" style="padding: 1rem;">
            <div class="success-section" style="padding: 1rem; background: var(--success-bg, #d4edda); border-radius: 4px; margin-bottom: 1rem;">
                <h4 style="color: var(--success-color, #155724); margin: 0 0 0.5rem 0;">✅ Project Created Successfully</h4>
                <p style="margin: 0; color: var(--success-color, #155724);">
                    Project <strong>${projectName}</strong> has been created with all files in place.
                </p>
            </div>
            
            <div class="error-section" style="padding: 1rem; background: var(--error-bg, #f8d7da); border-radius: 4px; margin-bottom: 1rem;">
                <h4 style="color: var(--error-color, #721c24); margin: 0 0 0.5rem 0;">⚠️ Deployment Failed</h4>
                <p style="margin: 0 0 0.5rem 0; color: var(--error-color, #721c24);">
                    The containers could not be started. This might be due to:
                </p>
                <ul style="margin: 0; padding-left: 1.5rem; color: var(--error-color, #721c24);">
                    <li>Port conflicts with existing containers</li>
                    <li>Missing or incorrect environment variables</li>
                    <li>Docker image pull failures</li>
                    <li>Volume mount path issues</li>
                </ul>
                <div style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(0,0,0,0.1); border-radius: 3px; font-family: monospace; font-size: 0.85rem; word-break: break-word;">
                    ${deployError}
                </div>
            </div>
            
            <div class="actions" style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                <button class="btn btn-primary" onclick="openProjectInEditor('${composeFile}'); this.closest('.logs-modal').remove();">
                    Edit Compose File
                </button>
                <button class="btn btn-success" onclick="retryDeployment('${composeFile}'); this.closest('.logs-modal').remove();">
                    Retry Deployment
                </button>
                <button class="btn btn-secondary" onclick="this.closest('.logs-modal').remove(); returnToComposeFiles();">
                    Return to Projects
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Reset the create form but don't return to compose files yet
    resetCreateForm();
}

// Function to open the newly created project in the editor
function openProjectInEditor(composeFile) {
    console.log('Opening newly created project in editor:', composeFile);
    
    // Switch to config tab and compose subtab
    switchTab('config');
    
    setTimeout(() => {
        switchSubTab('compose');
        
        // Store the file to load
        localStorage.setItem('pendingComposeFile', composeFile);
        
        setTimeout(() => {
            // Try to load the file
            const select = document.getElementById('compose-files');
            if (select) {
                // First scan for files to pick up the new project
                scanComposeFiles();
            }
        }, 200);
    }, 100);
}

// Function to retry deployment
function retryDeployment(composeFile) {
    console.log('Retrying deployment for:', composeFile);
    
    // Switch to config tab first to show the user where we are
    switchTab('config');
    switchSubTab('compose');
    
    setTimeout(() => {
        // Execute the compose restart
        setLoading(true, 'Retrying deployment...');
        
        fetch('/api/compose/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file: composeFile,
                action: 'restart',
                pull: false  // Don't pull on retry to make it faster
            })
        })
        .then(response => response.json())
        .then(result => {
            setLoading(false);
            
            if (result.status === 'success') {
                showMessage('success', 'Deployment successful! 🎉');
                refreshContainers();
            } else {
                showMessage('error', `Deployment failed again: ${result.message}`);
                // Open the compose file for editing
                openProjectInEditor(composeFile);
            }
        })
        .catch(error => {
            setLoading(false);
            console.error('Retry deployment failed:', error);
            showMessage('error', `Deployment retry failed: ${error.message}`);
            // Open the compose file for editing
            openProjectInEditor(composeFile);
        });
    }, 100);
}

// FIX: Add a proper form reset function
function resetCreateForm() {
    // Reset form fields
    const projectNameEl = document.getElementById('project-name');
    if (projectNameEl) projectNameEl.value = '';
    
    const customPathEl = document.getElementById('custom-path');
    if (customPathEl) customPathEl.value = '';
    
    const createEnvEl = document.getElementById('create-env-file');
    if (createEnvEl) createEnvEl.checked = true;
    
    // Reset CodeMirror editors
    if (codeMirrorEditors['compose-content']) {
        codeMirrorEditors['compose-content'].setValue('');
    } else {
        document.getElementById('compose-content').value = '';
    }
    
    if (codeMirrorEditors['env-content']) {
        codeMirrorEditors['env-content'].setValue('');
    } else {
        document.getElementById('env-content').value = '';
    }
    
    // Reset steps
    currentStep = 1;
    document.querySelectorAll('.form-step').forEach(el => {
        el.classList.remove('active');
    });
    const step1 = document.getElementById('step-project-info');
    if (step1) {
        step1.classList.add('active');
    }
}
// Add this function to load available project locations
function loadProjectLocations() {
    fetch('/api/compose/available-locations')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                const locationSelect = document.getElementById('project-location');
                if (locationSelect) {
                    locationSelect.innerHTML = ''; // Clear existing options
                    
                    // Add options for each available location
                    data.locations.forEach(location => {
                        const option = document.createElement('option');
                        option.value = location.path;
                        option.textContent = location.display_name;
                        locationSelect.appendChild(option);
                    });
                }
            }
        })
        .catch(error => {
            console.error('Failed to load project locations:', error);
        });
}



// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Monaco loader
    initCodeMirrorLoader();
   
    // Set up template selector event listener
    const templateSelect = document.getElementById('template-select');
    if (templateSelect) {
        templateSelect.addEventListener('change', function() {
            updateTemplateContent(this.value);
        });
    }
   
    // Check if compose tab is active initially and load templates if it is
    const composeTab = document.querySelector('.subtab[onclick="switchSubTab(\'compose\')"]');
    if (composeTab && composeTab.classList.contains('active')) {
        loadTemplates();
    }
   
    // Project location selection
    const locationSelect = document.getElementById('project-location');
    const customLocationGroup = document.getElementById('custom-location-group');
    
    if (locationSelect && customLocationGroup) {
        locationSelect.addEventListener('change', function() {
            customLocationGroup.style.display = this.value === 'custom' ? 'block' : 'none';
        });
    }
    
    // Env file checkbox
    const createEnvFileCheckbox = document.getElementById('create-env-file');
    const envFileOptions = document.getElementById('env-file-options');
    
    if (createEnvFileCheckbox && envFileOptions) {
        createEnvFileCheckbox.addEventListener('change', function() {
            envFileOptions.style.display = this.checked ? 'block' : 'none';
        });
    }
   
    // Initialize Monaco editors after a short delay to ensure Monaco is loaded
    setTimeout(() => {
        // Initialize compose editor (only if not already initialized)
        if (document.getElementById('compose-editor') && !codeMirrorEditors['compose-editor']) {
            initializeCodeMirrorEditor('compose-editor', 'yaml');
        }
        
        // Initialize env editor (only if not already initialized)
        if (document.getElementById('env-editor') && !codeMirrorEditors['env-editor']) {
            initializeCodeMirrorEditor('env-editor', 'ini');
        }
        
        // Initialize caddy editor (only if not already initialized)
        if (document.getElementById('caddy-editor') && !codeMirrorEditors['caddy-editor']) {
            initializeCodeMirrorEditor('caddy-editor', 'text');
        }
        
        // Initialize the template content editors if they exist (only if not already initialized)
        if (document.getElementById('compose-content') && !codeMirrorEditors['compose-content']) {
            initializeCodeMirrorEditor('compose-content', 'yaml');
        }
        
        if (document.getElementById('env-content') && !codeMirrorEditors['env-content']) {
            initializeCodeMirrorEditor('env-content', 'ini');
        }
    }, 1500);
});
// Export functions to make them available globally
window.loadTemplates = loadTemplates;
window.updateTemplateContent = updateTemplateContent;
window.goToStep = goToStep;
window.createProject = createProject;
window.createAndDeployProject = createAndDeployProject;
window.initializeCodeMirrorEditor = initializeCodeMirrorEditor;
window.updateCodeMirrorContent = updateCodeMirrorContent;
window.getCodeMirrorContent = getCodeMirrorContent;
window.setCodeMirrorLanguage = setCodeMirrorLanguage;

// Keep the old names for backward compatibility
window.initializeCodeMirrorEditor = initializeCodeMirrorEditor;
window.updateCodeMirrorContent = updateCodeMirrorContent;
window.getMonacoContent = getCodeMirrorContent;
window.setMonacoLanguage = setCodeMirrorLanguage;
// Export these functions to window
window.showProjectCreationForm = showProjectCreationForm;
window.hideProjectCreationForm = hideProjectCreationForm;
window.resetCreateForm = resetCreateForm;
window.extractFromContent = extractFromContent;
window.showEnvCreationModal = showEnvCreationModal;
window.createEnvFileFromModal = createEnvFileFromModal;
window.handlePartialSuccess = handlePartialSuccess;
window.openProjectInEditor = openProjectInEditor;
window.retryDeployment = retryDeployment;