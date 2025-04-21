![composr1](https://github.com/user-attachments/assets/05402063-aa5f-41bb-a69a-9c2d49069cef)

# Composr, Docker Container Manager

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/vansmak)

A web-based interface for managing Docker containers and docker-compose configurations.

## Features

- View all Docker containers (running and stopped)
- Start, stop, restart, and delete containers
- Real-time container logs viewing
- Container inspection with detailed information
- Container resource usage stats (CPU, memory)
- Edit and apply docker-compose.yml directly from the web interface

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
docker-manager:
  image: vansmak/docker-manager:latest
  container_name: docker_manager
  ports:
    - "5003:5003"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - /path/to/your/projects:/app/compose_files
  environment:
    - COMPOSE_DIR=/app/compose_files
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
cd docker-manager
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
docker build -t docker-manager .
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

The application expects a specific path to your parent DirectoRy before your docker-compose.yml files. Make sure to update the `COMPOSE_DIR` variable in app.py before running.

## Security Notice

⚠️ **Warning**: This application has full control over Docker containers on your system. It should only be deployed in trusted environments and should not be exposed to the public internet without proper authentication.
