![logo](https://github.com/user-attachments/assets/1266525a-c298-4abb-b86a-b8afdd57bcdb)

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
- **Multiple Sorting Options**: By name, CPU, memory, uptime, tag, or stack
- **Filter Support**: By status, tags, stacks, or text search

### User Interface
- Four theme options (Refined Dark, Night Owl, Nord, Light Breeze)
- Mobile-responsive design
- Batch operations for multiple containers
- Desktop/mobile filter layout optimization

## Installation

### Using Docker Compose (Recommended)

```yaml
services:
  composr:
    image: vansmak/composr:latest or  vansmak/composr:v1.1.0
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

##Accessing Composr
After installation, access Composr in your web browser at:
  http://localhost:5003

  *The metadata will be stored in a file called container_metadata.json in the specified directory.
  
##Compose File Management:

  - Compose File Editor: Edit docker-compose files directly in the web interface
  - Auto-discovery: Automatically finds compose files in configured directories
  - Apply Changes: Apply edited compose files directly from the interface

##Environment Variables Management

  - Extract to Clipboard: Extract environment variables from compose files to clipboard
    Use the extracted variables to create .env files

##Optional Caddyfile tab
  - Edit caddyfile and restart

Stack Management
Composr automatically identifies Docker Compose stacks by:

Using the com.docker.compose.project label
Parsing compose file directory names
Checking custom composr.stack labels

When viewing containers, you can:

Group by stack to see all containers in a project together
Click on stack headers to open the associated compose file
See aggregate stack stats (running containers, total CPU/memory)

Enhanced Container Organization

Custom Tags: Add multiple tags to any container for flexible organization
Custom Launch URLs: Set specific URLs for accessing container web interfaces
Smart Sorting: Group by stack or tag for logical view of your Docker environment
    

## Building from Source
## Prerequisites

- Docker Engine installed and running
- Python 3.7+
- Access to Docker socket
- Flask and docker Python packages (see requirements.txt)

1. Clone this repository:
```bash
git clone https://github.com/Vansmak/composr
cd composr
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure the path to your docker-compose.yml file you want to manage in app.py:
```python
COMPOSE_DIR = '/path/to/your/projects' #parent dir
```

## Running the Application

### Option 1: Run directly with Python
```bash
python app.py
```
Access the web interface at: http://localhost:5003

### Option 2: Run with Docker
```bash
docker build -t composr .
docker compose up -d
```

## Project Structure
```
docker-manager/
├── app.py, functions.py              # Flask application
├── requirements.txt    # Python dependencies
├── Dockerfile         # Docker configuration
├── docker-compose.yml # Compose file for the manager itself
├── templates/ #web
│   └── index.html
├── static/
│   ├── css/styles.css
│   └── js/main.js       
└── README.md         # Documentation
```

## Configuration

The application expects a specific path to your parent Directory before your docker-compose.yml files. Make sure to update the `COMPOSE_DIR` variable before running.

## Security Notice

⚠️ **Warning**: This application has full control over Docker containers on your system. It should only be deployed in trusted environments and should not be exposed to the public internet without proper authentication.
![Screenshot 2025-04-25 at 13-59-38 Composr](https://github.com/user-attachments/assets/49876da2-7131-4430-817a-d16f4ef6f673)
![Screenshot 2025-04-25 at 14-00-56 Composr](https://github.com/user-attachments/assets/dc4b4347-2032-4ede-b302-229d828c0b1c)![Screenshot_20250425-142844](https://github.com/user-attachments/assets/e0225c62-83cb-4a38-928f-2f56b033e393)
