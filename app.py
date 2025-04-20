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

COMPOSE_PATH = '/home/joe/media-server/docker-compose.yml'

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
        logger.debug(f"Retrieved {len(containers)} containers")
        return jsonify(containers)
    except Exception as e:
        logger.error(f"Failed to list containers: {e}")
        return jsonify([])  # Return empty list to avoid breaking frontend

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
        with open(COMPOSE_PATH, 'r') as f:
            content = f.read()
        logger.debug("Retrieved compose file")
        return jsonify({'content': content})
    except Exception as e:
        logger.error(f"Failed to read compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose', methods=['POST'])
def save_compose():
    try:
        content = request.json.get('content')
        with open(COMPOSE_PATH, 'w') as f:
            f.write(content)
        logger.debug("Saved compose file")
        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Failed to save compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose/apply', methods=['POST'])
def apply_compose():
    try:
        compose_dir = os.path.dirname(COMPOSE_PATH)
        subprocess.run(['docker', 'compose', 'up', '-d'], cwd=compose_dir, check=True)
        logger.debug("Applied compose file")
        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Failed to apply compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=True)