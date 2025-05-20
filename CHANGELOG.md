# Changelog
All notable changes to Composr will be documented in this file.

## [1.5.0] - 2025-05-19
### Added
- Instance Bookmarks feature - easily switch between different Composr instances
- Improved user interface with consistent styling across themes
- Dropdown menu for quick switching between bookmarked instances
- Server-side bookmark storage for reliability across browsers

### Changed
- Simplified multi-host approach to use bookmarks instead of direct connections
- Updated README with clearer installation instructions for different platforms
- Improved dropdown menu styling in dark themes
- Refined UI elements for better consistency

### Fixed
- ARM platform detection for Raspberry Pi and other ARM devices
- Docker image building for multi-architecture support
- Toggle view button styling issues
- Dropdown menu background colors in dark themes

## [1.4.1] - 2025-05-15
### Added
- multi-host support*
    *Multi-host management is still in development. The Agent connection type is recommended for production use as it's more secure than exposing Docker directly.
    Important: limited or no support is available for connection types other than the Composr Agent. For best results and future compatibility, use the Agent connection method. Even it is still untested
    
**Components**
- **Main Application**: Web UI and API for Docker management
- **Composr Agent**: Lightweight API-only component for remote hosts
       
- Monaco Editor for improved code editing experience
- Syntax highlighting for YAML, INI, and Caddyfile
- Theme-aware editor that switches with app theme
- Debug mode toggle via DEBUG environment variable

### Changed
- Improved editor height for desktop displays (600px default, 700px on large screens)
- Moved log files to persist in metadata directory
- Switched to Gunicorn for production deployment

### Fixed
- Production deployment warnings

## [1.4] - 2025-05
### Added
- Previous features...