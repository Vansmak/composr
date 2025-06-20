![Composr Logo](https://github.com/user-attachments/assets/1266525a-c298-4abb-b86a-b8afdd57bcdb)

# Composr - Docker Compose Companion

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/vansmak)

A web-based interface for managing Docker containers and docker-compose configurations across multiple Docker hosts with powerful project creation and backup capabilities.

Created using AI - use at your own ris.

## Key Features

### Multi-Host Docker Management 🆕
- **Centralized Control**: Manage multiple Docker hosts from a single Composr interface
- **Host Discovery**: Connect to remote Docker hosts via TCP connections
- **Cross-Host Deployment**: Deploy compose projects to any connected Docker host
- **Unified Container View**: See containers from all hosts in one interface with host badges
- **Per-Host Filtering**: Filter and group containers by host for easy organization
- **Host Status Monitoring**: Real-time connection status and system stats for each host

### Container Management
- View, start, stop, restart, and delete containers across all connected hosts
- Real-time logs viewing and container inspection
- Resource usage stats (CPU, memory, uptime) aggregated across hosts
- Container tagging and custom launch URLs
- Built-in terminal for executing commands within containers on any host
- **Cross-Host Operations**: Perform batch operations across multiple hosts

### Docker Compose Integration
- **Project Creation Wizard**: Step-by-step tool for creating new Docker Compose projects
- **Multi-location Support**: Create projects in different directories with flexible location management
- **Multi-Host Deployment**: Deploy projects to any connected Docker host from the creation wizard
- Edit and apply compose files directly from the web interface
- **Create & Deploy**: One-click project creation with intelligent deployment and error handling
- Visual tracking of compose stack status and stats across all hosts

### Docker Host Management
- **Add Remote Hosts**: Connect to Docker hosts via TCP (e.g., `tcp://192.168.1.100:2375`)
- **Host Configuration**: Easy setup with connection testing and validation
- **System Overview**: View aggregated stats across all connected hosts
- **Host Details**: Individual host information including Docker version and system resources
- **Connection Management**: Test, add, remove, and monitor Docker host connections

### Backup & Restore System
- **Complete Configuration Backup**: One-click backup of all containers, compose files, and settings
- **Multi-Host Backup**: Backup configurations from all connected Docker hosts
- **Unified Backup Archives**: Downloadable ZIP files containing everything needed for restoration
- **Metadata Preservation**: Container tags, custom URLs, and stack assignments included
- **Automated Restore**: Included restore scripts for easy deployment on new systems
- **Backup History**: Track and manage previous backups locally

### Advanced Organization
- **Stack Grouping**: Automatically groups containers by Docker Compose project across hosts
- **Host Grouping**: Group and filter containers by Docker host
- **Tag-based Organization**: Categorize containers with custom tags
- **Multiple Sorting Options**: By name, CPU, memory, uptime, host, or tag
- **Advanced Filtering**: By status, tags, stacks, hosts, or text search

### User Interface
- Four theme options (Refined Dark, Night Owl, Nord, Light Breeze)
- **Mobile-optimized design** with responsive layouts
- **CodeMirror Editor**: Lightweight, fast syntax highlighting for YAML, shell scripts, and configuration files
- **Dual View Modes**: Switch between grid and table views for optimal viewing
- Batch operations for multiple containers across hosts
- Desktop/mobile filter layout optimization
- **Host Badges**: Visual indicators showing which host each container belongs to

**🔄 Scheduled Repulls** *(Experimental)* see below
**🤖 Auto-Safe Updates** *(Experimental)* see below

## Multi-Host Setup

### Enabling Docker Remote API

To connect to remote Docker hosts, you need to enable the Docker Remote API on each target host.

#### Method 1: Docker Daemon Configuration
```bash
# Edit /etc/docker/daemon.json on the target host
{
  "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2375"]
}

# Restart Docker
sudo systemctl restart docker
```

#### Method 2: Environment Variable Configuration
Add to your Composr docker-compose.yml:
```yaml
services:
  composr:
    environment:
      - DOCKER_HOSTS=local=unix:///var/run/docker.sock,prod=tcp://192.168.1.100:2375,staging=tcp://192.168.1.101:2375
```

#### Method 3: Web Interface (Recommended)
1. Go to the **Hosts** tab in Composr
2. Click **Add New Docker Host**
3. Enter the host details:
   - **Display Name**: e.g., "Production Server"
   - **Docker URL**: e.g., "tcp://192.168.1.100:2375"
   - **Description**: Optional description
4. Click **Test Connection** to verify
5. Click **Add Host** to save

### Security Considerations
⚠️ **Important**: Only enable the Docker Remote API on trusted networks. For production environments, consider using TLS certificates for secure connections.

## Project Creation Wizard

The Project Creation feature supports multi-host deployment:

### How to Use
1. Go to **Config** tab → **Create** subtab
2. **Step 1**: Enter project name, choose location, and customize the compose template
3. **Step 2**: Review your project and choose deployment target:
   - **Local Docker**: Deploy to the local Composr host
   - **Remote Host**: Select any connected Docker host for deployment
   - **Create Only**: Just create the project files without deployment

### Multi-Host Features
- **Host Selection**: Choose which Docker host to deploy your new project to
- **Cross-Host Deployment**: Deploy from Composr to any connected Docker host
- **Host-Specific Validation**: Ensures target host is available before deployment
- **Deployment Feedback**: Detailed success/failure information for multi-host deployments

## Container Operations Across Hosts

### Supported Operations
- **Start/Stop/Restart**: Control containers on any connected host
- **Remove**: Delete containers from remote hosts
- **Logs**: View real-time logs from containers on any host
- **Terminal**: Execute commands in containers regardless of host location
- **Inspect**: View detailed container information across hosts
- **Batch Operations**: Perform actions on multiple containers across different hosts

### Host Identification
- **Host Badges**: Every container shows which host it belongs to
- **Host Filtering**: Filter view to show containers from specific hosts only
- **Host Grouping**: Group containers by host for better organization
- **Cross-Host Search**: Search for containers across all connected hosts

## Installation

### Platform-Specific Installation

#### x86_64 / AMD64 Systems

```yaml
services:
  composr:
    image: vansmak/composr:latest
    container_name: composr
    ports:
      - "5003:5003"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /path/to/docker/projects:/app/projects
      - /path/to/config/composr:/app/data
      - /path/to/config/caddy:/caddy_config  # Optional
    environment:
      COMPOSE_DIR: /app/projects
      METADATA_DIR: /app/data
      CONTAINER_METADATA_FILE: /app/data/metadata.json
      CADDY_CONFIG_DIR: /caddy_config  # Optional
      CADDY_CONFIG_FILE: Caddyfile     # Optional
      EXTRA_COMPOSE_DIRS: /path1:/path2:/path3  # Optional
      # Multi-host configuration (optional)
      DOCKER_HOSTS: local=unix:///var/run/docker.sock,prod=tcp://192.168.1.100:2375
    restart: unless-stopped
```

#### Raspberry Pi / ARM Devices

```yaml
services:
  composr:
    image: vansmak/composr:latest
    platform: linux/arm64  # Use this for 64-bit ARM (Pi 4)
    # OR use platform: linux/arm/v7 for 32-bit ARM (older Pi models)
    container_name: composr
    ports:
      - "5003:5003"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /path/to/docker/projects:/app/projects
      - /path/to/config/composr:/app/data
    environment:
      COMPOSE_DIR: /app/projects
      METADATA_DIR: /app/data
      # Multi-host configuration (optional)
      DOCKER_HOSTS: local=unix:///var/run/docker.sock,server2=tcp://192.168.1.101:2375
    restart: unless-stopped
```

### Environment Variables

**`COMPOSE_DIR`**  
Main directory for compose projects  
*Default:* `/app/projects`  
*Example:* `/home/user/docker`

**`METADATA_DIR`**  
Directory for Composr metadata  
*Default:* `/app/data`  
*Example:* `/config/composr`

**`DOCKER_HOSTS`**  
Comma-separated list of Docker hosts  
*Default:* `local=unix:///var/run/docker.sock`  
*Example:* `local=unix:///var/run/docker.sock,prod=tcp://192.168.1.100:2375`

**`EXTRA_COMPOSE_DIRS`**  
Additional directories to scan for compose files  
*Default:* None  
*Example:* `/opt/stacks:/srv/docker`

---

## Backup & Restore

### Multi-Host Backup Support

Composr's backup system now includes multi-host support:

#### Creating Backups
1. Go to the **Backup** tab
2. Enter a backup name (or use the auto-generated timestamp)
3. Choose what to include (compose files, environment files)
4. Click **Create Backup** to download a ZIP archive containing configurations from all hosts

#### What's Included in Multi-Host Backups
- **All Host Configurations**: Container settings from all connected Docker hosts
- **Host Metadata**: Information about which containers belong to which hosts
- **Compose Files**: All docker-compose.yml files across all locations
- **Environment Files**: All .env files from your projects
- **Container Metadata**: Tags, custom URLs, and stack assignments across hosts
- **Host Connection Info**: Details about connected Docker hosts (excluding sensitive data)

## Advanced Features

### Host Management
- **Connection Monitoring**: Real-time status of all Docker host connections
- **System Statistics**: CPU, memory, and container counts across all hosts
- **Host Details**: Individual host information and Docker version
- **Bulk Operations**: Perform actions across multiple hosts simultaneously

### Cross-Host Container Management
- **Unified Interface**: Manage containers from multiple hosts in one view
- **Host-Aware Operations**: All container operations include host context
- **Intelligent Routing**: Commands automatically route to the correct Docker host
- **Error Handling**: Detailed error reporting for cross-host operations

### Smart Filtering and Grouping
- **Multi-Dimensional Filtering**: Filter by host, stack, status, and tags simultaneously
- **Host-Based Grouping**: Group containers by Docker host for organized viewing
- **Cross-Host Search**: Search for containers across all connected hosts
- **Stack Management**: Manage Docker Compose stacks across multiple hosts

## Quick Start

1. **Install Composr** using the docker-compose examples above
2. **Access the interface** at `http://localhost:5003`
3. **Add Docker hosts** via the Hosts tab (optional, starts with local host)
4. **Create projects** using the Config → Create wizard
5. **Deploy across hosts** by selecting target hosts during project creation
6. **Manage containers** from the unified Containers view

## Security Notice

⚠️ **Warning**: This application has full control over Docker containers on all connected hosts. It should only be deployed in trusted environments and should not be exposed to the public internet without proper authentication.

**Multi-Host Security**: When connecting to remote Docker hosts, ensure the Docker Remote API is only accessible on trusted networks. Consider using VPN or SSH tunnels for added security.

**Backup Security**: Backup files contain your complete Docker configuration from all hosts including environment variables. Store backup files securely and avoid sharing them unless necessary.

### Container Update Management 🆕 ⚠️ **EXPERIMENTAL - UNTESTED**

**⚠️ WARNING: This feature is experimental and has not been thoroughly tested. Use with caution in production environments. Always test in a development environment first.**

Composr can automatically detect and manage updates for your Docker containers across all connected hosts.

#### Update Detection Features
- **Smart Version Detection**: Automatically detects newer versions of container images
- **Semantic Versioning Support**: Understands version patterns like `1.0.0 → 1.0.1`
- **Docker Hub Integration**: Checks Docker Hub API for latest image versions
- **Latest Tag Monitoring**: Detects when "latest" tags have been updated with newer images
- **Multi-Host Scanning**: Scans containers across all connected Docker hosts

#### Update Types Supported

**🤖 Auto-Safe Updates** *(Experimental)*
- Automatically applies **patch version updates only** (e.g., `1.2.3 → 1.2.4`)
- **Skips minor/major versions** that may contain breaking changes (e.g., `1.2.x → 1.3.x`)
- Only updates containers with specified safe tags (e.g., `stable`, `prod`)
- Creates automatic backups before updating
- Configurable schedule (default: disabled for safety)

**🔄 Scheduled Repulls** *(Experimental)*
- Automatically repulls same version tags to get latest images
- Useful for `latest`, `main`, or `stable` tags that get updated regularly
- Configurable interval (e.g., daily, weekly)
- Preserves exact same container configuration

#### Exclusion System
Multiple ways to exclude containers from automatic updates:

- **Tag Patterns**: Exclude containers with tags like `dev`, `test`, `latest`
- **Image Patterns**: Exclude images with names containing `test-`, `debug-`
- **Container Patterns**: Exclude containers with names like `temp-`, `backup-`
- **Specific Exclusions**: Manually exclude individual containers
- **Include-Only Mode**: Only check containers with specific tags like `prod`, `stable`

#### How to Use

1. **Enable Update Checking**:
   - Go to **Hosts** tab → Container Update Management
   - Click **⚙️ Update Settings**
   - Enable **"Automatically check for container updates"**

2. **Configure Safe Auto-Updates** *(Optional)*:
   ```
   ☑️ Automatically apply safe updates (patch versions only)
   Tags to auto-update: stable, prod
   ```

3. **Configure Scheduled Repulls** *(Optional)*:
   ```
   ☑️ Automatically repull containers on schedule
   Repull interval: 24 hours
   Tags to repull: latest, main, stable
   ```

4. **Set Exclusion Patterns**:
   ```
   Exclude tag patterns: dev, test, nightly
   Include tag patterns: stable, prod (optional)
   ```

#### Manual Update Operations
- **Check for Updates**: Click "📦 Updates" button to scan all containers
- **Batch Updates**: Update multiple containers simultaneously with checkboxes
- **Individual Updates**: Update single containers with version selection
- **Update Preview**: See what would be updated before applying changes

#### Update Detection Examples

| Container Image | Detection Method | Update Available |
|---|---|---|
| `nginx:1.20` | Version comparison | `nginx:1.21` ✅ |
| `postgres:latest` | Timestamp comparison | Newer `latest` image ✅ |
| `myapp:v2.1.0` | Semantic versioning | `v2.1.1`, `v2.2.0` ✅ |
| `redis:alpine` | Tag-based | Updated `alpine` tag ✅ |
| `custom:dev` | Excluded by pattern | Skipped ⏭️ |

#### Safety Features
- **Backup Creation**: Automatic backups before any updates
- **Rollback Support**: Restore previous version if update fails
- **Compose Integration**: Updates compose files and redeploys safely
- **Error Handling**: Detailed error reporting and recovery options
- **Dry Run Mode**: Preview what would be updated without applying changes

#### Multi-Host Support
- Works across all connected Docker hosts
- Host-aware update routing
- Unified update management interface
- Per-host update status and statistics

#### API Endpoints *(For Advanced Users)*
```bash
# Check for updates
POST /api/container-updates/check

# Update specific container
POST /api/container-updates/update

# Batch update multiple containers
POST /api/container-updates/batch-update

# Manage exclusions
GET/POST /api/container-updates/exclusions

# Trigger auto-maintenance
POST /api/container-updates/auto-maintenance
```

#### ⚠️ Important Safety Notes

**🔴 CRITICAL: This feature is experimental and untested in production environments.**

- **Test thoroughly** in development before using in production
- **Always backup** your containers and compose files before enabling auto-updates
- **Start with exclusions** - exclude critical production containers initially
- **Monitor logs** for update operations and errors
- **Verify updates** work correctly before enabling automation
- **Have rollback plan** ready in case updates cause issues

**Recommended First Steps:**
1. Enable update **checking only** (disable auto-updates)
2. Test manual updates on non-critical containers
3. Verify backup and rollback functionality
4. Gradually enable auto-updates for safe containers only
5. Monitor for several weeks before fully trusting the system

**Not Recommended For:**
- Database containers without proper backup strategies
- Containers with custom configurations that may break
- Production systems without thorough testing
- Containers that require manual intervention during updates
- Any container where downtime is not acceptable

#### Configuration Location
Update settings are stored in: `${METADATA_DIR}/container_update_settings.json`

## Screenshots

![Composr Main Screen](https://github.com/user-attachments/assets/49876da2-7131-4430-817a-d16f4ef6f673)
![Composr Config Screen](https://github.com/user-attachments/assets/dc4b4347-2032-4ede-b302-229d828c0b1c)
![Composr Mobile](https://github.com/user-attachments/assets/e0225c62-83cb-4a38-928f-2f56b033e393)
