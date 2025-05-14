// Monaco Editor Configuration and Initialization
let monacoEditors = {};

// Monaco Editor loader configuration
function initMonacoLoader() {
    require.config({
        paths: {
            'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs'
        }
    });
}

// Initialize Monaco Editor for a specific textarea
function initializeMonacoEditor(elementId, language = 'yaml') {
    console.log(`Initializing Monaco editor for ${elementId}`);
    
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element ${elementId} not found`);
        return;
    }
    
    // If editor already exists, dispose it first
    if (monacoEditors[elementId]) {
        monacoEditors[elementId].dispose();
    }
    
    // Hide original textarea and create editor container
    element.style.display = 'none';
    
    // Create Monaco container if it doesn't exist
    let monacoContainer = document.getElementById(`${elementId}-monaco`);
    if (!monacoContainer) {
        monacoContainer = document.createElement('div');
        monacoContainer.id = `${elementId}-monaco`;
        monacoContainer.className = 'monaco-editor-container';
        element.parentNode.insertBefore(monacoContainer, element.nextSibling);
    }
    
    // Load Monaco and create editor
    require(['vs/editor/editor.main'], function() {
        // Get current theme
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const monacoTheme = currentTheme && currentTheme.includes('dark') ? 'vs-dark' : 'vs';
        
        const editor = monaco.editor.create(monacoContainer, {
            value: element.value,
            language: language,
            theme: monacoTheme,
            automaticLayout: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 14,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            suggestOnTriggerCharacters: true,
            folding: true,
            foldingStrategy: 'indentation',
            formatOnPaste: true,
            formatOnType: true,
            scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10
            }
        });
        
        // Store editor instance
        monacoEditors[elementId] = editor;
        
        // Sync content back to textarea
        editor.onDidChangeModelContent(() => {
            element.value = editor.getValue();
        });
        
        // Update editor theme when app theme changes
        window.addEventListener('themeChanged', () => {
            const newTheme = document.documentElement.getAttribute('data-theme');
            editor.updateOptions({
                theme: newTheme && newTheme.includes('dark') ? 'vs-dark' : 'vs'
            });
        });
    });
}

// Function to update editor content
function updateMonacoContent(elementId, content) {
    const editor = monacoEditors[elementId];
    if (editor) {
        editor.setValue(content);
    } else {
        const element = document.getElementById(elementId);
        if (element) {
            element.value = content;
        }
    }
}

// Function to get editor content
function getMonacoContent(elementId) {
    const editor = monacoEditors[elementId];
    if (editor) {
        return editor.getValue();
    } else {
        const element = document.getElementById(elementId);
        return element ? element.value : '';
    }
}

// Function to set editor language
function setMonacoLanguage(elementId, language) {
    const editor = monacoEditors[elementId];
    if (editor) {
        monaco.editor.setModelLanguage(editor.getModel(), language);
    }
}

// Initialize Monaco when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initMonacoLoader();
    
    // Initialize editors after a short delay to ensure Monaco is loaded
    setTimeout(() => {
        // Initialize compose editor
        if (document.getElementById('compose-editor')) {
            initializeMonacoEditor('compose-editor', 'yaml');
        }
        
        // Initialize env editor
        if (document.getElementById('env-editor')) {
            initializeMonacoEditor('env-editor', 'ini');
        }
        
        // Initialize caddy editor
        if (document.getElementById('caddy-editor')) {
            initializeMonacoEditor('caddy-editor', 'text');
        }
    }, 1000);
});

// Export functions for use in main.js
window.initializeMonacoEditor = initializeMonacoEditor;
window.updateMonacoContent = updateMonacoContent;
window.getMonacoContent = getMonacoContent;
window.setMonacoLanguage = setMonacoLanguage;