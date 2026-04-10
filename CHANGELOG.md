# Changelog
All notable changes to Composr will be documented in this file.

## [1.8.2] - 2026-04-09
### Fixed
- **Container Updates**: Fixed rollback endpoint calling `deploy_updated_compose` with missing `host_manager` argument — rollbacks would crash with a `TypeError`

## [1.8.1] - 2026-04-09
### Fixed
- **Container Updates**: Fixed `is_safe_update`, `should_auto_update`, `should_scheduled_repull`, `perform_auto_updates`, `repull_container`, `repull_compose_container`, and `repull_standalone_container` being defined outside the `ContainerUpdateManager` class — every call to these methods would crash with `AttributeError`
- **Container Updates**: Fixed `should_skip_image` being called with a `container_name` argument it didn't accept — now accepts and checks container name against a new `exclude_container_patterns` setting
- **Container Updates**: Fixed remote host deploys silently targeting local Docker instead of the specified host — `deploy_updated_compose` and `repull_compose_container` now correctly look up the host URL via `host_manager` and set `DOCKER_HOST`
- **Container Updates**: Fixed `update_compose_file_image` destroying compose file formatting — replaced `yaml.safe_load` + `yaml.dump` round-trip (which strips comments and reformats) with a text-based replacement that preserves the original file structure

## [1.8.0] - 2026-03-02
### Added
- **🔒 Optional Authentication**: Session-based login system
  - Set `AUTH_USERNAME` and `AUTH_PASSWORD` environment variables to enable
  - Leave unset to run without authentication (backwards compatible)
  - Login page styled to match app theme
  - Logout button in the header when authenticated
  - `SECRET_KEY` environment variable for secure session signing

### Fixed
- **Container Actions**: `start`, `stop`, and `restart` buttons no longer show "showModal is not defined" error — missing `showModal`/`closeModal` functions now implemented
- **Container Actions**: Fixed "container is not defined" error when a successful action tried to reference `container.name` (now correctly uses `id`)
- **Container Updates**: Removed duplicate form fields (`auto-check-enabled` and `check-interval-hours` appeared twice in the update settings modal)
- **Table View**: `getContainerHealth` now guarded against being undefined, preventing crashes when table view loads before main.js
- **Remote Hosts**: Fixed null `hostInfo` access that could crash the hosts display when the API returns incomplete host data
- **Error Handling**: Replaced bare `except:` clauses in `app.py` (backup cleanup, compose validation, env extraction) and `remote_hosts.py` (client close) with specific exception types to prevent silently swallowing critical errors

## [1.7.7] - 2025-07-01
### Added
- **🎯 Smart Health Indicators**: Intelligent container health assessment system
  - Real-time health evaluation based on container status, uptime, and resource usage
  - Visual health indicators with color-coded status (green=healthy, yellow=warning, red=error)
  - Smart warning detection for recently restarted containers (< 5 minutes uptime)
  - Health tooltips showing specific issues and recommendations
- **📊 Persistent Operation Results**: Enhanced operation feedback system
  - Detailed operation result modals showing actual docker-compose command output
  - Persistent error messages that stay visible until manually dismissed
  - Success messages with auto-close after 10 seconds
  - Full command output display for debugging deployment failures
  - Network error handling with detailed error information
- **🔒 Scroll Position Preservation**: Automatic scroll position retention
  - Container list maintains scroll position after refresh operations
  - No more jumping back to top after container actions or page updates
  - Improved user experience for large container lists

### Changed
- **Container Status Display**: Replaced basic status badges with health-aware color coding
  - Container status text now changes color based on health level
  - Removed separate health column for cleaner table layout
  - Unified health indication across both card and table views
- **Card Layout Redesign**: Modernized container card appearance and organization
  - 4-row compact layout: Name → Host/Status/Uptime/More → Ports → Actions
  - Reduced card height (240px → 120px) for better screen utilization
  - Modern gradient backgrounds with improved hover effects
  - Better content organization with proper spacing and alignment
- **Table Structure Optimization**: Streamlined table columns for better usability
  - Consolidated health and status into single color-coded status column
  - Improved column alignment and responsive design
  - Fixed group header colspan to match new column structure

### Fixed
- **Operation Feedback**: Replaced generic "success/failed" messages with actual command output
  - Users now see real docker-compose errors instead of "operation failed"
  - Full deployment logs visible for troubleshooting
  - Network errors properly captured and displayed
- **Card View Consistency**: Fixed container card sizing and layout inconsistencies
  - All cards now maintain uniform height regardless of content
  - Proper content overflow handling for long port lists
  - Consistent button placement and spacing
- **Health Indicator Integration**: Seamless health status across all views
  - Card view health dots properly positioned in top-right corner
  - Table view health coloring applied consistently
  - Health assessment working for both grouped and ungrouped views
- **Page Navigation**: Fixed scroll position jumping to top after container operations
  - Maintains user's current scroll position during refresh operations
  - Better UX for managing large numbers of containers

### Technical
- **Health Assessment Engine**: Comprehensive container health evaluation system
- **Operation Result Modal**: New modal system for displaying command outputs
- **Scroll Management**: Intelligent scroll position preservation system
- **CSS Optimization**: Streamlined styling with improved responsiveness
- **Error Handling**: Enhanced error capture and display throughout the application

This release significantly improves user experience by providing clear visual feedback about container health, detailed information when operations fail, and seamless navigation that maintains user context during operations.
## [1.7.6] - 2025-06-20
- **Fixed critical bug where container labels were lost during backup/restore**
- **All original container labels (watchtower, traefik, custom, etc.) are now 
- **changed default updates logic to include verion #
## [1.7.5] - 2025-06-20
- **Fixed critical bug where Docker hosts were not persisting across container restarts**
- **Fixed HostManager to properly use METADATA_DIR environment variable**


## [1.7.4] - 2025-06-20
- **Removed cached host data from image build**
- **Removed instance selector - deprecated**
- **Increased editor window size**
## [1.7.2] - 2025-06-18
### Fixed
- **UI Consistency**: Fixed button alignment and spacing issues across all themes
- **Mobile Layout**: Improved container card layouts on mobile devices
- **Theme Switching**: Resolved dark mode toggle inconsistencies in navigation
- **Table Responsiveness**: Fixed column alignment issues in container table view
- **Modal Positioning**: Improved modal centering and backdrop behavior
- **Typography**: Standardized font sizes and weights across interface elements

### Changed
- **Visual Polish**: Enhanced visual consistency with refined spacing and borders
- **Loading States**: Improved loading indicators and transitions
- **Color Scheme**: Fine-tuned color contrasts for better accessibility
- **Icon Consistency**: Standardized icon usage throughout the interface

## [1.7.1] - 2025-06-15
### Added
- **🔄 Automatic Container Update System**: Complete container update management
  - Smart version detection with semantic versioning support
  - Docker Hub API integration for latest version checking
  - Auto-safe updates for patch versions only (e.g., 1.2.3 → 1.2.4)
  - Scheduled repulls for latest/stable tags
  - Configurable update intervals and exclusion patterns
  - Automatic backup creation before updates
  - Rollback support for failed updates
- **Update Management Interface**: Dedicated update settings and control panel
  - Batch update operations across multiple containers
  - Individual container update with version selection
  - Update preview and dry-run capabilities
  - Comprehensive exclusion system (tags, images, containers)
- **Multi-Host Update Support**: Update management across all connected Docker hosts
  - Host-aware update routing and status tracking
  - Unified update interface for all hosts
  - Per-host update statistics and monitoring

### Changed
- **Enhanced Container Monitoring**: Improved container status detection for updates
- **API Extensions**: New endpoints for update checking and management
- **Performance Optimization**: Reduced API calls through intelligent caching

### Security
- **Update Safety**: Multiple safety layers to prevent accidental breaking changes
- **Backup Integration**: Automatic backups before any update operations
- **Permission Validation**: Enhanced Docker permission checking for update operations

⚠️ **Note**: Container update system is experimental. Test thoroughly before using in production.

## [1.7.0] - 2025-06-10
### Added
- **🌐 Multi-Host Docker Management**: Complete multi-host support
  - Centralized control of multiple Docker hosts from single interface
  - Remote Docker host connections via TCP (e.g., tcp://192.168.1.100:2375)
  - Cross-host container deployment and management
  - Unified container view with host badges and filtering
  - Per-host system statistics and monitoring
  - Host connection status tracking and management
- **Host Management Interface**: Dedicated hosts configuration panel
  - Add/remove Docker hosts with connection testing
  - Host discovery and automatic configuration
  - Real-time connection status monitoring
  - Individual host details and Docker version info
- **Cross-Host Operations**: All container operations work across hosts
  - Start/stop/restart containers on any connected host
  - View logs and execute commands in remote containers
  - Deploy compose projects to specific hosts
  - Batch operations across multiple hosts simultaneously
- **Enhanced Project Creation**: Multi-host deployment support
  - Choose target host during project creation
  - Cross-host project deployment validation
  - Host-specific deployment feedback and error handling

### Changed
- **Container Interface**: Added host identification badges to all containers
- **Filtering System**: Enhanced filtering with host-based grouping options
- **Navigation**: Updated interface to accommodate multi-host features
- **API Architecture**: Redesigned API to support multiple Docker connections

### Technical
- **Connection Management**: Robust Docker connection handling and failover
- **Error Handling**: Improved error reporting for multi-host operations
- **Performance**: Optimized multi-host data fetching and caching
- **Security**: Enhanced validation for remote Docker connections

### Migration
- **Backward Compatibility**: Existing single-host setups continue to work unchanged
- **Configuration**: Optional DOCKER_HOSTS environment variable for multi-host setup
- **Data Migration**: Automatic migration of existing container metadata
## [1.6.1] - 2025-06-01
Changed

    Container Display: Replaced CPU/Memory stats with port mappings in main container view
        Container cards now show exposed ports (e.g., "8080:80, 443:443") instead of resource usage
        Table view has single "Ports" column instead of separate CPU/Memory columns
        CPU and Memory stats moved to detailed container popup for better organization
        "No ports" displayed for containers without exposed ports

Fixed

    Table View Controls: Fixed button placement and filter synchronization issues
        Toggle view button now appears in correct column (Ports, not Actions)
        Group By filter now works properly in table view
        Improved bidirectional sync between table and grid view filters

Technical

    Enhanced container data fetching to include port information via inspection API
    Updated table column structure from 10 to 8 columns
    Added responsive CSS styling for port display across all themes
    Maintained backward compatibility with existing sorting and filtering


## [1.6.0] - 2025-05-25
### Added
- **Project Creation Tool**: New "Create" subtab with step-by-step project wizard
  - Template-based project creation with environment variable extraction
  - Support for multiple project locations (main directory + extra directories)
  - Create & Deploy functionality with intelligent error handling
  - Automatic .env file generation from compose templates
- **Backup & Restore System**: Complete configuration backup and restore
  - One-click backup creation with downloadable ZIP archives
  - Unified backup compose files for easy deployment
  - Container metadata preservation (tags, custom URLs, stack assignments)
  - Automated restore scripts included in backup archives
  - Backup history tracking with local storage
- **Enhanced Environment Variable Management**:
  - Extract variables from compose files in both Create and Compose tabs
  - Create new .env files directly from extracted variables
  - Improved environment file editor with better mobile support

### Changed
- **Editor Migration**: Switched from Monaco Editor to CodeMirror 5
  - Reduced Docker image size significantly
  - Improved loading performance and stability
  - Maintained syntax highlighting for YAML, shell, and JavaScript
  - Better mobile editor experience with responsive heights
- **Docker Image Optimization**: Multi-stage build implementation
  - Switched to Alpine Linux base for smaller footprint
  - Multi-stage build separates build dependencies from runtime
  - Multi-architecture build support (AMD64, ARM64, ARMv7)
  - Automated version management in build pipeline
  - Significantly reduced final image size while maintaining full functionality
- **Mobile Interface Improvements**:
  - Fixed Config tab layout issues with better button stacking
  - Forced Images tab to card view on mobile (removed confusing table view)
  - Improved header layout and tab navigation on mobile devices
  - Better modal positioning and sizing for mobile screens
- **Create & Deploy Workflow Enhancement**:
  - Intelligent partial success handling (project created but deployment failed)
  - Detailed error modals with retry options and file editing access
  - Better user feedback throughout the creation process

### Fixed
- **Mobile Layout Issues**:
  - Config subtabs now wrap properly on mobile screens
  - Images tab displays correctly as cards instead of table format
  - System stats header maintains proper alignment on mobile
  - All navigation tabs visible and properly sized for mobile devices
- **Project Creation Edge Cases**:
  - Fixed environment file creation in both create-only and create-deploy scenarios
  - Proper handling of project location selection (extra directories vs main directory)
  - Form state management when switching between tabs
- **Editor Improvements**:
  - Better CodeMirror initialization timing
  - Improved content synchronization between editors and forms
  - Fixed mobile editor height and responsiveness issues

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