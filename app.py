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
        return jsonify([])
    
    try:
        containers = []
        for container in client.containers.list(all=True):
            labels = container.labels
            compose_project = labels.get('com.docker.compose.project', None)
            compose_config_files = labels.get('com.docker.compose.project.config_files', None)
            compose_working_dir = labels.get('com.docker.compose.project.working_dir', None)
            
            compose_file = None
            if compose_config_files:
                # Get full relative path from COMPOSE_DIR
                try:
                    file_path = compose_config_files.split(',')[0]  # Get first file if multiple
                    if os.path.exists(file_path):
                        compose_file = os.path.relpath(file_path, COMPOSE_DIR)
                    elif compose_working_dir and os.path.exists(compose_working_dir):
                        # Try to get path from working directory and filename 
                        base_name = os.path.basename(file_path)
                        possible_path = os.path.join(compose_working_dir, base_name)
                        if os.path.exists(possible_path):
                            compose_file = os.path.relpath(possible_path, COMPOSE_DIR)
                        else:
                            compose_file = base_name  # Fallback to just the filename
                    else:
                        compose_file = os.path.basename(file_path)
                except Exception as e:
                    logger.error(f"Error getting compose file path: {e}")
                    compose_file = os.path.basename(file_path) if file_path else None
            
            containers.append({
                'id': container.short_id,
                'name': container.name,
                'status': container.status,
                'image': container.image.tags[0] if container.image.tags else 'unknown',
                'compose_project': compose_project,
                'compose_file': compose_file
            })
        containers.sort(key=lambda x: x['name'].lower())
        logger.debug(f"Retrieved {len(containers)} containers")
        return jsonify(containers)
    except Exception as e:
        logger.error(f"Failed to list containers: {e}")
        return jsonify([])

@app.route('/api/container/<container_id>/compose', methods=['GET'])
def get_container_compose(container_id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        container = client.containers.get(container_id)
        labels = container.labels
        compose_config_files = labels.get('com.docker.compose.project.config_files', None)
        
        if not compose_config_files:
            return jsonify({'status': 'error', 'message': 'No compose file found for this container'})
        
        # Get the first config file
        file_path = compose_config_files.split(',')[0]
        
        if not os.path.exists(file_path):
            return jsonify({'status': 'error', 'message': f'Compose file not found: {file_path}'})
        
        # Get relative path from COMPOSE_DIR
        relative_path = os.path.relpath(file_path, COMPOSE_DIR)
        
        with open(file_path, 'r') as f:
            content = f.read()
        
        return jsonify({
            'status': 'success', 
            'file': relative_path,
            'content': content
        })
    except Exception as e:
        logger.error(f"Failed to get compose file for container {container_id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Keep all the rest of your functions
@app.route('/api/compose/files')
def get_compose_files():
    try:
        compose_files = []
        logger.debug(f"Searching for compose files in: {COMPOSE_DIR}")
        
        if not os.path.exists(COMPOSE_DIR):
            logger.error(f"COMPOSE_DIR doesn't exist: {COMPOSE_DIR}")
            return jsonify({'files': [], 'error': f'Directory not found: {COMPOSE_DIR}'})
        
        for root, dirs, files in os.walk(COMPOSE_DIR):
            logger.debug(f"Searching in directory: {root}")
            for file in files:
                if file in ['docker-compose.yml', 'compose.yml'] or file.startswith('docker-compose.'):
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, COMPOSE_DIR)
                    compose_files.append(relative_path)
                    logger.debug(f"Found compose file: {relative_path}")
        
        logger.debug(f"Total compose files found: {len(compose_files)}")
        return jsonify({'files': compose_files})
    except Exception as e:
        logger.error(f"Failed to find compose files: {e}")
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