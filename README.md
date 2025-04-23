![logo](https://github.com/user-attachments/assets/1266525a-c298-4abb-b86a-b8afdd57bcdb)


# Composr - Docker Compose Companion

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/vansmak)

A web-based interface for managing Docker containers and docker-compose configurations.

## Features

- View all Docker containers (running and stopped)
- Start, stop, restart, and delete containers
- Real-time container logs viewing
- Container inspection with detailed information
- Container resource usage stats (CPU, memory)
- Edit and apply docker-compose.yml directly from the web interface
- Sort containers by:

  Name (alphabetically)
  CPU usage (high to low)
  Memory usage (high to low)
  Uptime (high to low)


- Filter containers by:

Status (running/stopped)
Text search (matches container name, image, or compose file

Compose File Management

Compose File Editor: Edit docker-compose files directly in the web interface
Auto-discovery: Automatically finds compose files in configured directories
Apply Changes: Apply edited compose files directly from the interface

Environment Variables Management

Extract to Clipboard: Extract environment variables from compose files to clipboard

Easily extract variables from existing compose files
Use the extracted variables to create .env files


Env Files Tab: View and edit .env files

Scan for existing .env files
Create new .env files
Edit and save existing .env files

Performance Optimizations

Caching: Improved responsiveness with intelligent caching
Background Processing: Statistics update in the background without blocking the UI
Efficient Filtering: In-memory filtering for fast response times

Using Environment Variables

Extracting Variables from Compose Files:

  Select a compose file in the Compose Editor tab
  Click "Extract Env to Clipboard"
  Variables will be copied to clipboard and also displayed in the Env Files tab


Creating/Editing .env Files:

  Go to the Env Files tab
  Click "Scan for .env Files" to find existing files
  Select an existing file or create a new one
  Edit the content and click "Save .env File"


Using .env Files with Compose:

To use an .env file with a compose file, you need to either:

  Place the .env file in the same directory as your compose file
  Add env_file: .env to your compose file
  Or use the --env-file flag with docker-compose

## Prerequisites

- Docker Engine installed and running
- Python 3.7+
- Access to Docker socket
- Flask and docker Python packages (see requirements.txt)

## Installation
## Quick Start with Docker Hub

The easiest way to use this application is to add it directly to your existing docker-compose.yml file:
## Configuration for Multiple Compose Files

If you manage containers with multiple docker-compose files in different directories:

```yaml
composr:
  image: vansmak/composr:latest
  container_name: composr
  ports:
    - "5003:5003"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - /path/to/your/project:/app/projectname
    - /different/path/to/anotherproject:/app/projectname2 # optional
  environment:
    - COMPOSE_DIR=/app/compose_files
    - EXTRA_COMPOSE_DIRS=/app/projectname2:/app/projectname3:/app/projectname4 #optional
  restart: unless-stopped
```

Then run:
```bash
docker compose up -d
```

Access the web interface at: http://localhost:5003

## Building from Source

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
├── app.py              # Flask application
├── requirements.txt    # Python dependencies
├── Dockerfile         # Docker configuration
├── docker-compose.yml # Compose file for the manager itself
├── templates/
│   └── index.html    # Web interface
└── README.md         # Documentation
```

## Configuration

The application expects a specific path to your parent Directory before your docker-compose.yml files. Make sure to update the `COMPOSE_DIR` variable in app.py before running.

## Security Notice

⚠️ **Warning**: This application has full control over Docker containers on your system. It should only be deployed in trusted environments and should not be exposed to the public internet without proper authentication.
