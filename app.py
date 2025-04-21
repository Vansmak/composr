from flask import Flask, render_template, jsonify, request
import docker
import os
import subprocess
import logging

app = Flask(__name__)

# Setup logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

try:
    client = docker.from_env()
except Exception as e:
    logger.error(f"Failed to initialize Docker client: {e}")
    client = None

# Change this line from COMPOSE_PATH to COMPOSE_DIR
COMPOSE_DIR = os.getenv('COMPOSE_DIR', '/app/projects')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/containers')
def get_containers():
    if client is None:
        logger.error("Docker client not initialized")
        return jsonify([])  # Return empty list to match original behavior
    
    try:
        containers = []
        for container in client.containers.list(all=True):
            containers.append({
                'id': container.short_id,
                'name': container.name,
                'status': container.status,
                'image': container.image.tags[0] if container.image.tags else 'unknown'
            })
        # Add sorting here
        containers.sort(key=lambda x: x['name'].lower())
        logger.debug(f"Retrieved {len(containers)} containers")
        return jsonify(containers)
    except Exception as e:
        logger.error(f"Failed to list containers: {e}")
        return jsonify([])  # Return empty list to avoid breaking frontend

# Add this new function
@app.route('/api/compose/files')
def get_compose_files():
    try:
        compose_files = []
        for root, dirs, files in os.walk(COMPOSE_DIR):
            for file in files:
                if file in ['docker-compose.yml', 'compose.yml'] or file.startswith('docker-compose.'):
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, COMPOSE_DIR)
                    compose_files.append(relative_path)
        compose_files.sort()  # Sort alphabetically
        return jsonify({'files': compose_files})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<container_id>/<action>', methods=['POST'])
def container_action(container_id, action):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        container = client.containers.get(container_id)
        if action == 'start':
            container.start()
        elif action == 'stop':
            container.stop()
        elif action == 'restart':
            container.restart()
        else:
            return jsonify({'status': 'error', 'message': 'Invalid action'})
        logger.debug(f"Performed {action} on container {container_id}")
        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Failed to {action} container {container_id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<container_id>/delete', methods=['POST'])
def delete_container(container_id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        container = client.containers.get(container_id)
        if container.status == 'running':
            return jsonify({'status': 'error', 'message': 'Stop the container before deleting'})
        container.remove()
        logger.debug(f"Deleted container {container_id}")
        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Failed to delete container {container_id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<container_id>/logs', methods=['GET'])
def get_container_logs(container_id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        container = client.containers.get(container_id)
        logs = container.logs(tail=100).decode('utf-8')
        logger.debug(f"Retrieved logs for container {container_id}")
        return jsonify({'status': 'success', 'logs': logs})
    except Exception as e:
        logger.error(f"Failed to get logs for container {container_id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<container_id>/inspect', methods=['GET'])
def inspect_container(container_id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        container = client.containers.get(container_id)
        inspection = container.attrs
        filtered = {
            'Id': inspection['Id'][:12],
            'Name': inspection['Name'],
            'State': inspection['State'],
            'Config': {
                'Image': inspection['Config']['Image'],
                'Env': inspection['Config']['Env'],
                'Cmd': inspection['Config']['Cmd']
            },
            'NetworkSettings': {
                'Ports': inspection['NetworkSettings']['Ports']
            },
            'Mounts': inspection['Mounts']
        }
        logger.debug(f"Inspected container {container_id}")
        return jsonify({'status': 'success', 'data': filtered})
    except Exception as e:
        logger.error(f"Failed to inspect container {container_id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<container_id>/stats', methods=['GET'])
def get_container_stats(container_id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        container = client.containers.get(container_id)
        stats = container.stats(stream=False)
        cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - stats['precpu_stats']['cpu_usage']['total_usage']
        system_delta = stats['cpu_stats']['system_cpu_usage'] - stats['precpu_stats']['system_cpu_usage']
        cpu_percent = (cpu_delta / system_delta * 100) if system_delta > 0 else 0
        memory_usage = stats['memory_stats']['usage'] / (1024 * 1024)  # MB
        memory_limit = stats['memory_stats']['limit'] / (1024 * 1024)  # MB
        memory_percent = (memory_usage / memory_limit * 100) if memory_limit > 0 else 0
        logger.debug(f"Retrieved stats for container {container_id}")
        return jsonify({
            'status': 'success',
            'cpu': f'{cpu_percent:.2f}%',
            'memory': f'{memory_usage:.2f}/{memory_limit:.2f} MB ({memory_percent:.2f}%)'
        })
    except Exception as e:
        logger.error(f"Failed to get stats for container {container_id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Replace the get_compose function
@app.route('/api/compose', methods=['GET'])
def get_compose():
    try:
        file_path = request.args.get('file')
        if file_path:
            full_path = os.path.join(COMPOSE_DIR, file_path)
        else:
            # Default to first file found or error
            files = []
            for root, dirs, files_list in os.walk(COMPOSE_DIR):
                for file in files_list:
                    if file in ['docker-compose.yml', 'compose.yml'] or file.startswith('docker-compose.'):
                        relative_path = os.path.relpath(os.path.join(root, file), COMPOSE_DIR)
                        files.append(relative_path)
            
            if files:
                file_path = files[0]
                full_path = os.path.join(COMPOSE_DIR, file_path)
            else:
                return jsonify({'status': 'error', 'message': 'No docker-compose files found'})
        
        if not os.path.exists(full_path):
            return jsonify({'status': 'error', 'message': f'File not found: {full_path}'})
        
        with open(full_path, 'r') as f:
            content = f.read()
        return jsonify({'content': content, 'file': os.path.relpath(full_path, COMPOSE_DIR)})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

# Replace the save_compose function
@app.route('/api/compose', methods=['POST'])
def save_compose():
    try:
        content = request.json.get('content')
        file_path = request.json.get('file')
        
        if file_path:
            full_path = os.path.join(COMPOSE_DIR, file_path)
        else:
            return jsonify({'status': 'error', 'message': 'No file specified'})
        
        # Ensure the directory exists
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, 'w') as f:
            f.write(content)
        
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

# Replace the apply_compose function
@app.route('/api/compose/apply', methods=['POST'])
def apply_compose():
    try:
        file_path = request.json.get('file')
        if file_path:
            full_path = os.path.join(COMPOSE_DIR, file_path)
            compose_dir = os.path.dirname(full_path)
        else:
            return jsonify({'status': 'error', 'message': 'No file specified'})
            
        subprocess.run(['docker', 'compose', 'up', '-d'], cwd=compose_dir, check=True)
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=True)