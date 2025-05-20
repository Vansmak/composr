![Composr Logo](https://github.com/user-attachments/assets/1266525a-c298-4abb-b86a-b8afdd57bcdb)

# Composr - Docker Compose Companion

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/vansmak)

A web-based interface for managing Docker containers and docker-compose configurations.

## Key Features

### Container Management
- View, start, stop, restart, and delete containers
- Real-time logs viewing and container inspection
- Resource usage stats (CPU, memory, uptime)
- Container tagging and custom launch URLs

### Docker Compose Integration
- Edit and apply compose files directly from the web interface
- Extract environment variables to clipboard for creating .env files
- Visual tracking of compose stack status and stats

### Advanced Organization
- **Stack Grouping**: Automatically groups containers by Docker Compose project
- **Tag-based Organization**: Categorize containers with custom tags
- **Multiple Sorting Options**: By name, CPU, memory, uptime, or tag
- **Filter Support**: By status, tags, stacks, or text search

### User Interface
- Four theme options (Refined Dark, Night Owl, Nord, Light Breeze)
- Mobile-responsive design
- Batch operations for multiple containers
- Desktop/mobile filter layout optimization

### Instance Bookmarks
- Save bookmarks to quickly access other Composr instances on your network
- Open multiple Composr instances managing different servers
- Test connections to ensure your bookmarked instances are available

## Terminal Feature

Composr includes a container terminal feature, allowing you to execute commands directly within your containers from the web interface.

### How to Use

1. Click on a container card to open the container details popup
2. Click the "Terminal" button in the actions section
3. Enter commands in the terminal prompt that appears

### Notes

- The available commands depend on what's installed in the target container
- Minimal containers (like Alpine-based images) may have limited command availability
- Common commands that work in most containers:
  - `echo $PATH` - Show the PATH environment variable
  - `pwd` - Show current directory
  - `cat /etc/os-release` - Show OS information (if available)
  - `env` - List all environment variables

**For Alpine-based containers**: If you want to enhance terminal capabilities in your containers, you can add utilities to your Dockerfile:
```dockerfile
# Example addition to your own Alpine-based Dockerfile
RUN apk update && apk add busybox-extras
```

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
    restart: unless-stopped
```

#### Raspberry Pi / ARM Devices

For ARM-based devices like Raspberry Pi, you need to specify the platform:

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
    restart: unless-stopped
```

### Quick Start

Create a new directory for Composr:

```bash
mkdir -p ~/composr/data
```

Create a `docker-compose.yml` file:

```bash
nano ~/composr/docker-compose.yml
```

Paste the appropriate compose example for your system (see above).

Start Composr:

```bash
cd ~/composr
docker compose up -d
```

## Accessing Composr

After installation, access Composr in your web browser at:
```
http://localhost:5003
```

## Compose File Management

- **Compose File Editor**: Edit docker-compose files directly in the web interface
- **Auto-discovery**: Automatically finds compose files in configured directories
- **Apply Changes**: Apply edited compose files directly from the interface

## Environment Variables Management

- **Extract to Clipboard**: Extract environment variables from compose files
- **Use extracted variables**: Create .env files for your Docker Compose projects

## Optional Caddyfile Tab

- Edit Caddyfile and restart your Caddy server
- Useful for managing web proxies for your containers

## Stack Management

Composr automatically identifies Docker Compose stacks by:

- Using the com.docker.compose.project label
- Parsing compose file directory names
- Checking custom composr.stack labels

When viewing containers, you can:

- Group by stack to see all containers in a project together
- Click on stack headers to open the associated compose file
- See aggregate stack stats (running containers, total CPU/memory)

## Enhanced Container Organization

- **Custom Tags**: Add multiple tags to any container for flexible organization
- **Custom Launch URLs**: Set specific URLs for accessing container web interfaces
- **Smart Sorting**: Group by stack or tag for logical view of your Docker environment

## Instance Bookmarks

The bookmarks feature allows you to:

1. Access multiple Composr instances across your network
2. Quickly switch between different servers running Composr
3. Organize your Docker infrastructure by purpose or location

To add a bookmark:

1. Go to the "Hosts" tab
2. Enter a name and URL for the Composr instance
3. Click "Add Instance"
4. Use the dropdown in the filter menu to quickly switch between instances

## Building from Source

### Prerequisites

- Docker Engine installed and running
- Python 3.9+
- Access to Docker socket
- Required Python packages (see requirements.txt)

1. Clone the repository:
```bash
git clone https://github.com/Vansmak/composr
cd composr
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure the path to your projects directory:
```python
COMPOSE_DIR = '/path/to/your/projects'
```

### Running from Source

#### Option 1: Run directly with Python
```bash
python app.py
```

#### Option 2: Build and run with Docker
```bash
docker build -t composr:local .
docker run -d \
  --name composr \
  -p 5003:5003 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /path/to/projects:/app/projects \
  composr:local
```

## Security Notice

⚠️ **Warning**: This application has full control over Docker containers on your system. It should only be deployed in trusted environments and should not be exposed to the public internet without proper authentication.

## Screenshots

![Composr Main Screen](https://github.com/user-attachments/assets/49876da2-7131-4430-817a-d16f4ef6f673)
![Composr Config Screen](https://github.com/user-attachments/assets/dc4b4347-2032-4ede-b302-229d828c0b1c)
![Composr Mobile](https://github.com/user-attachments/assets/e0225c62-83cb-4a38-928f-2f56b033e393)
