import os
import json
from flask import Flask, request, Response, stream_with_context
import docker
import logging

# Import your existing agent functionality
from composr_agent import app as agent_app

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create a new Flask app for Docker API compatibility
docker_app = Flask(__name__)

# Docker client initialization
try:
    docker_socket = os.getenv('DOCKER_SOCKET', 'unix:///var/run/docker.sock')
    client = docker.DockerClient(base_url=docker_socket, timeout=5)
    client.ping()
    logger.info(f"Connected to Docker at {docker_socket}")
except Exception as e:
    logger.error(f"Failed to connect to Docker: {e}")
    client = None

# Map Docker API endpoints to Docker client methods
@docker_app.route('/v1.41/containers/json', methods=['GET'])
def list_containers():
    """Docker API endpoint for listing containers"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        # Parse parameters that Docker clients might send
        all_containers = request.args.get('all', 'false').lower() == 'true'
        
        # Get containers from Docker
        containers = client.containers.list(all=all_containers)
        
        # Format response to match Docker API
        response_data = []
        for container in containers:
            response_data.append({
                'Id': container.id,
                'Names': [f"/{container.name}"],
                'Image': container.image.tags[0] if container.image.tags else container.image.id,
                'ImageID': container.image.id,
                'Command': container.attrs.get('Config', {}).get('Cmd', [])[0] if container.attrs.get('Config', {}).get('Cmd') else "",
                'Created': container.attrs.get('Created', 0),
                'State': container.status,
                'Status': container.status,
                'Ports': container.attrs.get('NetworkSettings', {}).get('Ports', {}),
                'Labels': container.labels,
                'HostConfig': {
                    'NetworkMode': container.attrs.get('HostConfig', {}).get('NetworkMode', '')
                },
                'NetworkSettings': container.attrs.get('NetworkSettings', {})
            })
        
        return Response(json.dumps(response_data), status=200, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error listing containers: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

@docker_app.route('/v1.41/info', methods=['GET'])
def system_info():
    """Docker API endpoint for system info"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        # Get info from Docker
        info = client.info()
        return Response(json.dumps(info), status=200, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error getting system info: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

@docker_app.route('/v1.41/images/json', methods=['GET'])
def list_images():
    """Docker API endpoint for listing images"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        # Get images from Docker
        images = client.images.list()
        
        # Format response to match Docker API
        response_data = []
        for image in images:
            response_data.append({
                'Id': image.id,
                'RepoTags': image.tags,
                'Created': image.attrs.get('Created', 0),
                'Size': image.attrs.get('Size', 0),
                'Labels': image.labels,
                'Containers': len([c for c in client.containers.list(all=True) if c.image.id == image.id])
            })
        
        return Response(json.dumps(response_data), status=200, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error listing images: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

@docker_app.route('/_ping', methods=['GET'])
def ping():
    """Docker API endpoint for ping"""
    if client is None:
        return Response("ERROR: Docker daemon not available", status=500)
    
    try:
        client.ping()
        return Response("OK", status=200)
    except Exception as e:
        logger.error(f"Error pinging Docker: {e}")
        return Response("ERROR", status=500)

@docker_app.route('/v1.41/version', methods=['GET'])
def version():
    """Docker API endpoint for version"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        # Get version from Docker
        version_info = client.version()
        return Response(json.dumps(version_info), status=200, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error getting version: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

# For container-specific actions, we'll implement the most common ones
@docker_app.route('/v1.41/containers/<container_id>/json', methods=['GET'])
def inspect_container(container_id):
    """Docker API endpoint for inspecting a container"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        container = client.containers.get(container_id)
        return Response(json.dumps(container.attrs), status=200, mimetype='application/json')
    except docker.errors.NotFound:
        return Response(json.dumps({"message": f"Container {container_id} not found"}), status=404, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error inspecting container {container_id}: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

@docker_app.route('/v1.41/containers/<container_id>/start', methods=['POST'])
def start_container(container_id):
    """Docker API endpoint for starting a container"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        container = client.containers.get(container_id)
        container.start()
        return Response("", status=204)
    except docker.errors.NotFound:
        return Response(json.dumps({"message": f"Container {container_id} not found"}), status=404, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error starting container {container_id}: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

@docker_app.route('/v1.41/containers/<container_id>/stop', methods=['POST'])
def stop_container(container_id):
    """Docker API endpoint for stopping a container"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        container = client.containers.get(container_id)
        container.stop()
        return Response("", status=204)
    except docker.errors.NotFound:
        return Response(json.dumps({"message": f"Container {container_id} not found"}), status=404, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error stopping container {container_id}: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

@docker_app.route('/v1.41/containers/<container_id>/restart', methods=['POST'])
def restart_container(container_id):
    """Docker API endpoint for restarting a container"""
    if client is None:
        return Response(json.dumps({"message": "Docker daemon not available"}), status=500, mimetype='application/json')
    
    try:
        container = client.containers.get(container_id)
        container.restart()
        return Response("", status=204)
    except docker.errors.NotFound:
        return Response(json.dumps({"message": f"Container {container_id} not found"}), status=404, mimetype='application/json')
    except Exception as e:
        logger.error(f"Error restarting container {container_id}: {e}")
        return Response(json.dumps({"message": str(e)}), status=500, mimetype='application/json')

# Add a catch-all route for unimplemented API endpoints
@docker_app.route('/', defaults={'path': ''})
@docker_app.route('/<path:path>')
def catch_all(path):
    """Catch-all endpoint for Docker API compatibility"""
    logger.info(f"Unimplemented Docker API endpoint requested: {request.method} /{path}")
    return Response(json.dumps({"message": "API endpoint not implemented in agent"}), status=501, mimetype='application/json')

# Combined application for both agent and Docker API
class CombinedApp:
    def __init__(self, agent_app, docker_app):
        self.agent_app = agent_app
        self.docker_app = docker_app
    
    def __call__(self, environ, start_response):
        # Parse the path to determine which app to route to
        path = environ.get('PATH_INFO', '')
        
        # If the path starts with anything like /v1.xx/ or /_ping, route to Docker API
        if path.startswith('/v') or path == '/_ping':
            return self.docker_app(environ, start_response)
        else:
            # Otherwise, route to the agent API
            return self.agent_app(environ, start_response)

# Create the combined application
application = CombinedApp(agent_app, docker_app)

if __name__ == "__main__":
    # Run the combined application
    from werkzeug.serving import run_simple
    run_simple('0.0.0.0', 5005, application)
