# Changelog
All notable changes to Composr will be documented in this file.

## [2.1.2] - 2026-08-28
### Fixed
- **Container update checks silently failing for namespaced images**: `check_updates` parsed each image's Docker Hub namespace (e.g. `linuxserver` in `linuxserver/sabnzbd`) but never stored it on the container record, then rebuilt a stripped image-info dict without it and indexed it directly (not `.get()`) - any image that wasn't an official single-word Docker Hub image (i.e. almost everything except things like `nginx`/`redis`) crashed with `KeyError: 'namespace'` on every check. The exception was caught generically and reported as `update_available: False`, so the UI showed "all containers up to date" while actually just failing silently on most containers. Production example: sabnzbd, radarr, and others all reported up to date despite real newer tags on Docker Hub.
- **Update-check timestamp parsing failing on real Docker/Docker Hub output**: once the above was fixed, comparing timestamps via `datetime.fromisoformat()` on Python 3.9 broke on both sides of the comparison - Docker Hub's `last_updated` field can carry 5-digit fractional seconds and Docker Engine's container `Created` field carries 9-digit (nanosecond) fractional seconds, neither of which Python's `fromisoformat` accepts before 3.11. Also silently caught and reported as "no update available." Added a small timestamp normalizer that truncates/pads the fractional-second component to microseconds before parsing.

## [2.1.1] - 2026-07-20
### Fixed
- **Scheduled updates**: gunicorn runs 4 worker processes, and the background update-checker thread was started at module import time - every worker ran its own independent copy, all reading the same settings/cache file and firing scheduled repulls/auto-updates for the same containers within seconds of each other. Concurrent `docker compose up --force-recreate` calls from sibling workers raced on the same container, and the previous stale-container retry (v1.8.3) only covered a single process's own interrupted attempt, not a sibling worker's simultaneous one. Production incident: dispatcharr, autoscan, and jellyfin left stuck in `Created` state overnight. Now an exclusive non-blocking file lock ensures only one worker's thread runs the scheduler; the rest skip immediately.
- Removed a fully-shadowed duplicate `start_container_update_checker` definition left over from an earlier edit - dead code, no behavior change.

## [2.0.0] - 2026-07-14

### Added
- **🎯 Service-Centric Model**: a service's profile, compose file, and host are now attributes you change directly, not scattered one-off buttons
  - **Compose Profiles**: select which optional profiles are active for a stack (toggle chips + Deploy in the stack modal), and mark any core service "Inactive" with one click — edits the file with a line-based insert/removal (never rewrites the whole file, so comments and formatting survive) and immediately redeploys, stopping (not removing) the container so it shows up as a normal `Exited`/`Inactive` status rather than vanishing
  - **Move a Service**: move a service from one compose file to another via the container popup — two-step preview/commit flow shows a diff of both files and flags real risks before you confirm (cross-file `depends_on`, top-level volumes/networks the target doesn't declare, `${VAR}` references missing from the target's `.env`, name/port collisions, and `network_mode: host` or `build:` services that may not be portable to a different location)
  - **Per-Stack Deploy Host**: send a stack to a specific connected host from its properties — file stays local, only where the containers run changes. If the target host is offline, the deploy is refused outright rather than silently landing on local (no silent fallback, ever)
  - **Port-Conflict Resolution**: before any deploy, host ports are checked against what's already published on the target — a conflict shows which container holds it, suggests the nearest free port, or offers to deploy to a different connected (and architecture-aware) host instead
  - **Service Properties Panel**: the container "More" popup now leads with Profile / Compose file / Host as live attribute-changers, with the existing logs/inspect/terminal/repull/remove actions below
- **Images — Multi-Select & Bulk Remove**: "Select Multiple" toggle with checkboxes (grid and table view) to remove several images at once, instead of one at a time
- **Intermittent Host Support**: mark a host as "expect offline" (e.g. a Windows Docker Desktop PC that isn't always on) so it shows as paused rather than an error — display only, doesn't relax the no-silent-fallback deploy rule

### Fixed
- **Security**: path traversal in the compose/env file read+write endpoints — an absolute or `../` path could escape the configured compose directory; now resolved and validated against the allowed directories before every read or write
- **Security**: `remote_hosts.py`'s background health-check thread mutated shared connection state without a lock, racing request threads — could produce a "dictionary changed size during iteration" error under real concurrent use
- **Security**: batch container actions (start/stop/restart/remove) ignored which host a selected container was actually on in multi-host setups, always acting against the local/last-switched host instead
- **Security**: startup now logs a clear warning when running without `AUTH_USERNAME`/`AUTH_PASSWORD` set, and `/login` has basic rate-limiting (5 attempts, 5 minute lockout) — was previously unlimited
- **Backup**: `create_backup`/`preview_backup` now accept a `host` parameter and correctly resolve a per-host Docker client, instead of always operating on local regardless of which host was intended
- **Images**: "Prune Images" had a duplicate event listener causing every click to fire the request twice — the second request would hit Docker's daemon-level prune lock and fail with "a prune operation is already running"
- **Stale static assets**: local JS/CSS files had no cache-busting at all, so a browser could keep serving old code indefinitely across upgrades — every static asset now carries a version query string that changes on each restart
- Removed a substantial amount of dead code left over from the pre-multi-host "bookmark era" (unreachable duplicate endpoints, orphaned functions, dead frontend call sites) with no behavior change for anything actually reachable from the UI

### Changed
- The module-level Docker client global was removed entirely — every endpoint now resolves its own per-request, per-host client, closing a class of "wrong host in multi-host setups" bugs at the root

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