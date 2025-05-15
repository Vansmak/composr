import os
import logging
import threading
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler

from flask import Flask, jsonify, request
import docker

# Import helper functions (we'll create a minimal version)
from agent_functions import (
    load_container_metadata, save_container_metadata, 
    calculate_uptime, scan_all_compose_files, 
    resolve_compose_file_path, get_compose_files_cached
)

# Configuration
AGENT_VERSION = "1.0.0"
COMPOSE_DIR = os.getenv('COMPOSE_DIR', '/app/projects')
EXTRA_COMPOSE_DIRS = os.getenv('EXTRA_COMPOSE_DIRS', '').split(':')
METADATA_DIR = os.environ.get('METADATA_DIR', '/app')
CONTAINER_METADATA_FILE = os.path.join(METADATA_DIR, 'container_metadata.json')

# Ensure metadata directory exists
os.makedirs(os.path.dirname(CONTAINER_METADATA_FILE), exist_ok=True)

# Flask setup
app = Flask(__name__)

# Logging setup
log_file = os.path.join(METADATA_DIR, 'composr-agent.log')
log_handler = RotatingFileHandler(log_file, maxBytes=1024*1024, backupCount=5)
log_level = logging.DEBUG if os.getenv('DEBUG', 'false').lower() == 'true' else logging.INFO
log_handler.setLevel(log_level)
logger = logging.getLogger(__name__)
logger.addHandler(log_handler)
logger.setLevel(log_level)

logger.info(f"Composr Agent v{AGENT_VERSION} starting up")

# Docker client initialization
try:
    docker_socket = os.getenv('DOCKER_SOCKET', 'unix:///var/run/docker.sock')
    client = docker.DockerClient(base_url=docker_socket, timeout=5)
    client.ping()
    logger.info(f"Connected to Docker at {docker_socket}")
except Exception as e:
    logger.error(f"Failed to connect to Docker: {e}")
    client = None

# Caching
_container_cache = {}
_system_stats_cache = {}
_system_stats_timestamp = 0
_cache_timestamp = 0
_cache_lock = threading.Lock()
CACHE_TTL = 10  # seconds

# API Routes

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'version': AGENT_VERSION,
        'docker_connected': client is not None
    })

@app.route('/api/info')
def agent_info():
    """Agent information endpoint"""
    return jsonify({
        'agent_version': AGENT_VERSION,
        'hostname': os.environ.get('HOSTNAME', 'unknown'),
        'compose_dir': COMPOSE_DIR,
        'extra_compose_dirs': EXTRA_COMPOSE_DIRS,
        'docker_connected': client is not None
    })

@app.route('/api/containers')
def get_containers():
    """Get containers with optional filtering"""
    if client is None:
        return jsonify({'error': 'Docker client not connected'}), 503
    
    try:
        search = request.args.get('search', '').lower()
        status = request.args.get('status', '')
        tag_filter = request.args.get('tag', '')
        
        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        current_time = time.time()
        
        # Use cache if available
        if current_time - _cache_timestamp < CACHE_TTL and _container_cache:
            containers = _container_cache.copy()
        else:
            containers = []
            for container in client.containers.list(all=True):
                labels = container.labels
                compose_project = labels.get('com.docker.compose.project', None)
                
                # Extract compose file info
                compose_file = None
                config_files = labels.get('com.docker.compose.project.config_files', None)
                if config_files:
                    file_path = config_files.split(',')[0]
                    if os.path.exists(file_path):
                        compose_file = os.path.relpath(file_path, COMPOSE_DIR)
                    else:
                        compose_file = os.path.basename(file_path)
                
                container_name = container.name
                container_metadata = metadata.get(container_name, {})
                container_tags = container_metadata.get('tags', [])
                
                container_data = {
                    'id': container.short_id,
                    'name': container_name,
                    'status': container.status,
                    'image': container.image.tags[0] if container.image.tags else 'unknown',
                    'compose_project': compose_project,
                    'compose_file': compose_file,
                    'uptime': calculate_uptime(container.attrs['State']['StartedAt'], logger),
                    'cpu_percent': 0,
                    'memory_usage': 0,
                    'tags': container_tags
                }
                containers.append(container_data)
            
            _container_cache = containers.copy()
            _cache_timestamp = current_time
            
            # Start background stats update
            threading.Thread(target=update_container_stats, args=(containers,)).start()
        
        # Apply filters
        filtered_containers = []
        for container in containers:
            if search and not (
                search in container['name'].lower() or
                search in (container['image'] or '').lower() or
                search in (container['compose_file'] or '').lower() or
                any(search in tag.lower() for tag in container.get('tags', []))
            ):
                continue
            if status and container['status'] != status:
                continue
            if tag_filter and tag_filter not in container.get('tags', []):
                continue
            filtered_containers.append(container)
        
        return jsonify(filtered_containers)
    
    except Exception as e:
        logger.error(f"Failed to get containers: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/container/<id>/<action>', methods=['POST'])
def container_action(id, action):
    """Perform action on container"""
    if client is None:
        return jsonify({'error': 'Docker client not connected'}), 503
    
    try:
        container = client.containers.get(id)
        
        if action == 'start':
            container.start()
        elif action == 'stop':
            container.stop()
        elif action == 'restart':
            container.restart()
        elif action == 'remove':
            if container.status == 'running':
                container.stop()
            container.remove()
        else:
            return jsonify({'error': 'Invalid action'}), 400
        
        return jsonify({'status': 'success', 'message': f'Container {action}ed'})
    
    except Exception as e:
        logger.error(f"Failed to {action} container {id}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/system')
def get_system_stats():
    """Get system statistics"""
    if client is None:
        return jsonify({'error': 'Docker client not connected'}), 503
    
    global _system_stats_cache, _system_stats_timestamp
    current_time = time.time()
    
    with _cache_lock:
        if current_time - _system_stats_timestamp < CACHE_TTL and _system_stats_cache:
            return jsonify(_system_stats_cache)
    
    try:
        info = client.info()
        
        # Calculate memory usage
        total_memory = 0
        used_memory = 0
        try:
            with open('/proc/meminfo', 'r') as f:
                meminfo = f.readlines()
            for line in meminfo:
                if line.startswith('MemTotal:'):
                    total_memory = int(line.split()[1]) / 1024
                elif line.startswith('MemAvailable:'):
                    mem_available = int(line.split()[1]) / 1024
                    used_memory = total_memory - mem_available
        except Exception as e:
            logger.warning(f"Failed to read /proc/meminfo: {e}")
            total_memory = info.get('MemTotal', 0) / (1024 * 1024)
            used_memory = total_memory - (info.get('MemFree', 0) / (1024 * 1024))
        
        stats = {
            'status': 'success',
            'total_containers': info.get('Containers', 0),
            'running_containers': info.get('ContainersRunning', 0),
            'cpu_count': info.get('NCPU', 0),
            'memory_used': round(used_memory, 2),
            'memory_total': round(total_memory, 2),
            'memory_percent': round((used_memory / total_memory * 100) if total_memory else 0, 2)
        }
        
        with _cache_lock:
            _system_stats_cache = stats
            _system_stats_timestamp = current_time
        
        return jsonify(stats)
    
    except Exception as e:
        logger.error(f"Failed to get system stats: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/compose/files')
def get_compose_files():
    """Get list of compose files"""
    try:
        files = get_compose_files_cached(COMPOSE_DIR, tuple(EXTRA_COMPOSE_DIRS))
        return jsonify({'status': 'success', 'files': files})
    except Exception as e:
        logger.error(f"Failed to get compose files: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/compose', methods=['GET'])
def get_compose():
    """Get compose file content"""
    try:
        file_path = request.args.get('file')
        if not file_path:
            return jsonify({'error': 'No file path provided'}), 400
            
        full_path = resolve_compose_file_path(file_path, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        if full_path and os.path.exists(full_path):
            with open(full_path, 'r') as f:
                content = f.read()
            return jsonify({'status': 'success', 'content': content, 'file': file_path})
        
        return jsonify({'error': 'File not found'}), 404
    
    except Exception as e:
        logger.error(f"Failed to load compose file: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/compose', methods=['POST'])
def save_compose():
    """Save compose file content"""
    try:
        data = request.json
        if not data or 'content' not in data or 'file' not in data:
            return jsonify({'error': 'Invalid request data'}), 400
            
        file_path = data['file']
        content = data['content']
        full_path = resolve_compose_file_path(file_path, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        
        if not full_path:
            full_path = os.path.join(COMPOSE_DIR, file_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, 'w') as f:
            f.write(content)
        
        return jsonify({'status': 'success', 'message': 'File saved'})
    
    except Exception as e:
        logger.error(f"Failed to save compose file: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/images')
def get_images():
    """Get Docker images"""
    if client is None:
        return jsonify({'error': 'Docker client not connected'}), 503
    
    try:
        images = []
        for image in client.images.list():
            tags = image.tags
            name = tags[0] if tags else '<none>:<none>'
            size_mb = round(image.attrs['Size'] / (1024 * 1024), 2)
            
            # Handle timestamps
            created_val = image.attrs['Created']
            if isinstance(created_val, (int, float)):
                created = datetime.fromtimestamp(created_val).strftime('%Y-%m-%d %H:%M:%S')
            else:
                try:
                    created_dt = datetime.strptime(created_val.split('.')[0], '%Y-%m-%dT%H:%M:%S')
                    created = created_dt.strftime('%Y-%m-%d %H:%M:%S')
                except:
                    created = 'Unknown'
            
            used_by = []
            for container in client.containers.list(all=True):
                if container.image.id == image.id:
                    used_by.append(container.name)
            
            images.append({
                'id': image.short_id,
                'name': name,
                'tags': tags,
                'size': size_mb,
                'created': created,
                'used_by': used_by
            })
        
        return jsonify(images)
    
    except Exception as e:
        logger.error(f"Failed to get images: {e}")
        return jsonify({'error': str(e)}), 500

# Helper functions

def update_container_stats(containers):
    """Update container stats in background"""
    if not client:
        return
    
    try:
        updated = []
        for container in containers:
            if container['status'] == 'running':
                try:
                    c = client.containers.get(container['id'])
                    stats = c.stats(stream=False)
                    
                    # Calculate CPU percentage
                    if 'cpu_stats' in stats and 'precpu_stats' in stats:
                        cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - stats['precpu_stats']['cpu_usage']['total_usage']
                        system_delta = stats['cpu_stats']['system_cpu_usage'] - stats['precpu_stats']['system_cpu_usage']
                        if system_delta > 0:
                            cpu_percent = (cpu_delta / system_delta) * stats['cpu_stats']['online_cpus'] * 100
                            container['cpu_percent'] = round(cpu_percent, 2)
                    
                    # Calculate memory usage
                    if 'memory_stats' in stats and 'usage' in stats['memory_stats']:
                        memory_usage = stats['memory_stats']['usage'] / (1024 * 1024)
                        container['memory_usage'] = round(memory_usage, 2)
                except Exception as e:
                    logger.warning(f"Failed to get stats for container {container['id']}: {e}")
            
            updated.append(container)
        
        global _container_cache
        _container_cache = updated
        
    except Exception as e:
        logger.error(f"Failed to update container stats: {e}")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005, debug=False)