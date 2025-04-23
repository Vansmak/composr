from flask import Flask, render_template, jsonify, request
import docker
import os
import logging
import threading
import time
from datetime import datetime
import pytz
from functools import lru_cache
import yaml

app = Flask(__name__)

# Setup logging
logging.basicConfig(filename='/app/composr.log', level=logging.DEBUG)
logger = logging.getLogger(__name__)

try:
    client = docker.from_env()
except Exception as e:
    logger.error(f"Failed to initialize Docker client: {e}")
    client = None

COMPOSE_DIR = os.getenv('COMPOSE_DIR', '/app/projects')
EXTRA_COMPOSE_DIRS = os.getenv('EXTRA_COMPOSE_DIRS', '').split(':')

# Caching variables
_system_stats_cache = {}
_system_stats_timestamp = 0
_container_cache = {}
_cache_timestamp = 0
_cache_lock = threading.Lock()  # Prevent race conditions
CACHE_TTL = 10  # seconds

def calculate_uptime(started_at):
    if not started_at:
        return {"display": "N/A", "minutes": 0}
    try:
        started = datetime.strptime(started_at[:19], "%Y-%m-%dT%H:%M:%S")
        started = started.replace(tzinfo=pytz.UTC)
        now = datetime.now(pytz.UTC)
        delta = now - started
        days = delta.days
        hours = delta.seconds // 3600
        minutes = (delta.seconds % 3600) // 60
        total_minutes = days * 24 * 60 + hours * 60 + minutes
        
        if days > 0:
            display = f"{days}d {hours}h"
        elif hours > 0:
            display = f"{hours}h {minutes}m"
        else:
            display = f"{minutes}m"
            
        return {"display": display, "minutes": total_minutes}
    except Exception as e:
        logger.error(f"Failed to calculate uptime: {e}")
        return {"display": "N/A", "minutes": 0}

@lru_cache(maxsize=32)
def get_compose_files_cached():
    return get_compose_files()

def get_compose_files():
    try:
        compose_files = []
        search_dirs = [COMPOSE_DIR] + [d for d in EXTRA_COMPOSE_DIRS if d]
        for search_dir in search_dirs:
            if not os.path.exists(search_dir):
                logger.warning(f"Search directory doesn't exist: {search_dir}")
                continue
            for root, dirs, files in os.walk(search_dir, topdown=True):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for file in files:
                    if file in ['docker-compose.yml', 'compose.yml'] or file.startswith('docker-compose.'):
                        file_path = os.path.join(root, file)
                        relative_path = os.path.relpath(file_path, COMPOSE_DIR)
                        compose_files.append(relative_path)
                        logger.debug(f"Found compose file: {relative_path}")
        logger.debug(f"Total compose files found: {len(compose_files)}")
        return compose_files
    except Exception as e:
        logger.error(f"Failed to find compose files: {e}")
        return []

def scan_all_compose_files():
    try:
        compose_files = []
        search_dirs = ['/home/joe', '/mnt/media']
        for search_dir in search_dirs:
            if not os.path.exists(search_dir):
                logger.warning(f"Scan directory doesn't exist: {search_dir}")
                continue
            for root, dirs, files in os.walk(search_dir, topdown=True):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for file in files:
                    if file in ['docker-compose.yml', 'compose.yml'] or file.startswith('docker-compose.'):
                        file_path = os.path.join(root, file)
                        compose_files.append(file_path)
                        logger.debug(f"Found compose file during scan: {file_path}")
        logger.debug(f"Total compose files found during scan: {len(compose_files)}")
        return compose_files
    except Exception as e:
        logger.error(f"Failed to scan compose files: {e}")
        return []

def parse_env_file(file_path):
    try:
        env_vars = {}
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        key_value = line.split('=', 1)
                        if len(key_value) == 2:
                            key, value = key_value
                            # Remove quotes if present
                            value = value.strip('"\'')
                            env_vars[key] = value
        return env_vars
    except Exception as e:
        logger.error(f"Failed to parse .env file {file_path}: {e}")
        return {}

def extract_env_from_compose(compose_file_path, modify_compose=False):
    """
    Extract environment variables from a compose file to create a .env file
    If modify_compose is True, also updates the compose file to use the .env
    """
    try:
        with open(compose_file_path, 'r') as f:
            compose_data = yaml.safe_load(f)
        
        # Parse environment variables
        env_vars = {}
        compose_modified = False
        
        if compose_data and 'services' in compose_data:
            for service_name, service_config in compose_data['services'].items():
                if 'environment' in service_config:
                    env_section = service_config['environment']
                    
                    # Environment can be a list or a dictionary
                    if isinstance(env_section, list):
                        # Extract env vars
                        for item in env_section:
                            if isinstance(item, str) and '=' in item:
                                key, value = item.split('=', 1)
                                env_vars[key.strip()] = value.strip()
                        
                        # If requested, modify compose file to reference .env
                        if modify_compose:
                            # Replace with just variable names
                            new_env = []
                            for key in env_vars.keys():
                                new_env.append(key)
                            service_config['environment'] = new_env
                            compose_modified = True
                            
                    elif isinstance(env_section, dict):
                        # Extract env vars
                        for key, value in env_section.items():
                            if value is not None:  # Some vars might just be keys without values
                                env_vars[key.strip()] = str(value).strip()
                        
                        # If requested, modify compose file to reference .env
                        if modify_compose:
                            # Replace with just variable names
                            new_env = {}
                            for key in env_vars.keys():
                                new_env[key] = None  # Use null value to indicate it's from .env
                            service_config['environment'] = new_env
                            compose_modified = True
        
        # Generate .env file content
        env_content = "# Auto-generated .env file from compose\n"
        env_content += "# Created: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "\n\n"
        
        for key, value in env_vars.items():
            env_content += f"{key}={value}\n"
        
        # If requested, save the modified compose file
        if modify_compose and compose_modified:
            with open(compose_file_path, 'w') as f:
                yaml.dump(compose_data, f, sort_keys=False)
            
        return env_content, compose_modified
    
    except Exception as e:
        logger.error(f"Failed to extract environment variables from compose file: {e}")
        return None, False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/containers')
def get_containers():
    if client is None:
        logger.error("Docker client not initialized")
        return jsonify([])
    try:
        search = request.args.get('search', '').lower()
        status = request.args.get('status', '')
        sort_by = request.args.get('sort', 'name')
        
        # Use a global cache for containers
        global _container_cache, _cache_timestamp
        current_time = time.time()
        
        # Check if we have a valid cache (less than 10 seconds old)
        if current_time - _cache_timestamp < CACHE_TTL and _container_cache:
            logger.debug("Using cached container data")
            containers = _container_cache.copy()
        else:
            # If no cache or expired, fetch basic container info (fast)
            containers = []
            for container in client.containers.list(all=True):
                labels = container.labels
                compose_project = labels.get('com.docker.compose.project', None)
                compose_file = None
                config_files = labels.get('com.docker.compose.project.config_files', None)
                if config_files:
                    file_path = config_files.split(',')[0]
                    if os.path.exists(file_path):
                        compose_file = os.path.relpath(file_path, COMPOSE_DIR)
                    else:
                        compose_file = os.path.basename(file_path)

                # Only include the basic info initially - no stats
                container_data = {
                    'id': container.short_id,
                    'name': container.name,
                    'status': container.status,
                    'image': container.image.tags[0] if container.image.tags else 'unknown',
                    'compose_project': compose_project,
                    'compose_file': compose_file,
                    'uptime': calculate_uptime(container.attrs['State']['StartedAt']),
                    'cpu_percent': 0,
                    'memory_usage': 0
                }
                containers.append(container_data)
            
            # Update the cache immediately with basic info
            _container_cache = containers.copy()
            _cache_timestamp = current_time
            
            # Start a background thread to fetch stats
            def update_stats():
                for container in containers:
                    if container['status'] == 'running':
                        try:
                            # Get container object
                            c = client.containers.get(container['id'])
                            stats = c.stats(stream=False)
                            
                            # Update CPU stats
                            if 'cpu_stats' in stats and 'precpu_stats' in stats:
                                cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - stats['precpu_stats']['cpu_usage']['total_usage']
                                system_delta = stats['cpu_stats']['system_cpu_usage'] - stats['precpu_stats']['system_cpu_usage']
                                if system_delta > 0:
                                    cpu_percent = (cpu_delta / system_delta) * stats['cpu_stats']['online_cpus'] * 100
                                    container['cpu_percent'] = round(cpu_percent, 2)
                            
                            # Update memory stats
                            if 'memory_stats' in stats and 'usage' in stats['memory_stats']:
                                memory_usage = stats['memory_stats']['usage'] / (1024 * 1024)
                                container['memory_usage'] = round(memory_usage, 2)
                        except Exception as e:
                            logger.warning(f"Failed to get stats for container {container['id']}: {e}")
                
                # Update the cache with the stats
                global _container_cache
                _container_cache = containers.copy()
            
            # Start the background thread
            threading.Thread(target=update_stats).start()
        
        # Apply filters to the cached data (very fast)
        filtered_containers = []
        for container in containers:
            if search and not (
                search in container['name'].lower() or
                search in (container['image'] or '').lower() or
                search in (container['compose_file'] or '').lower()
            ):
                continue

            if status and container['status'] != status:
                continue

            filtered_containers.append(container)
        
        # Sort the filtered data
        if sort_by == 'name':
            filtered_containers.sort(key=lambda x: x['name'].lower())
        elif sort_by == 'status':
            filtered_containers.sort(key=lambda x: x['status'])
        elif sort_by == 'cpu':
            filtered_containers.sort(key=lambda x: x['cpu_percent'], reverse=True)
        elif sort_by == 'memory':
            filtered_containers.sort(key=lambda x: x['memory_usage'], reverse=True)
        elif sort_by == 'uptime':
            filtered_containers.sort(key=lambda x: x['uptime']['minutes'], reverse=True)

        return jsonify(filtered_containers)
    except Exception as e:
        logger.error(f"Failed to list containers: {e}")
        return jsonify([])

@app.route('/api/system')
def get_system_stats():
    global _system_stats_cache, _system_stats_timestamp
    
    if client is None:
        logger.error("Docker client not initialized")
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    current_time = time.time()
    with _cache_lock:
        if current_time - _system_stats_timestamp < CACHE_TTL and _system_stats_cache:
            logger.debug("Using cached system stats")
            return jsonify(_system_stats_cache)
    
    try:
        info = client.info()
        if not info:
            logger.error("Empty response from client.info()")
            return jsonify({'status': 'error', 'message': 'No system info available'})
        
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
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose/files')
def get_compose_files_endpoint():
    return jsonify({'files': get_compose_files_cached()})

@app.route('/api/compose/scan')
def scan_compose_files():
    return jsonify({'files': scan_all_compose_files()})

@app.route('/api/compose', methods=['GET'])
def get_compose():
    try:
        file_path = request.args.get('file')
        full_path = os.path.join(COMPOSE_DIR, file_path) if file_path else None
        if full_path and os.path.exists(full_path):
            with open(full_path, 'r') as f:
                content = f.read()
            return jsonify({'content': content, 'file': os.path.relpath(full_path, COMPOSE_DIR)})
        return jsonify({'status': 'error', 'message': 'No valid compose file found'})
    except Exception as e:
        logger.error(f"Failed to load compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose', methods=['POST'])
def save_compose():
    try:
        data = request.json
        if not data or 'content' not in data or 'file' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'})
            
        file_path = data['file']
        content = data['content']
        
        full_path = os.path.join(COMPOSE_DIR, file_path) if not os.path.isabs(file_path) else file_path
        
        # Ensure the directory exists
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, 'w') as f:
            f.write(content)
            
        return jsonify({'status': 'success', 'message': 'Compose file saved successfully'})
    except Exception as e:
        logger.error(f"Failed to save compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})



@app.route('/api/env/files')
def get_env_files():
    try:
        env_files = []
        search_dirs = [COMPOSE_DIR] + [d for d in EXTRA_COMPOSE_DIRS if d]
        
        logger.info(f"Scanning for .env files in: {search_dirs}")
        
        for search_dir in search_dirs:
            if not os.path.exists(search_dir):
                logger.warning(f"Search directory doesn't exist: {search_dir}")
                continue
                
            for root, dirs, files in os.walk(search_dir, topdown=True):
                for file in files:
                    if file == '.env':
                        file_path = os.path.join(root, file)
                        logger.info(f"Found .env file: {file_path}")
                        env_files.append(file_path)
        
        logger.info(f"Total .env files found: {len(env_files)}")
        return jsonify({'files': env_files})
    except Exception as e:
        logger.error(f"Failed to find .env files: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e), 'files': []})
@app.route('/api/env/file')
def get_env_file_content():  # New name to avoid conflicts
    try:
        file_path = request.args.get('path')
        if not file_path:
            return jsonify({'status': 'error', 'message': 'No file path provided'})
        
        full_path = os.path.join(COMPOSE_DIR, file_path) if not os.path.isabs(file_path) else file_path
        
        if not os.path.exists(full_path):
            return jsonify({'status': 'error', 'message': 'File not found'})
        
        with open(full_path, 'r') as f:
            content = f.read()
        
        return jsonify({
            'status': 'success',
            'content': content,
            'file': file_path
        })
    except Exception as e:
        logger.error(f"Failed to get .env file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
@app.route('/api/env/file', methods=['POST'])
def save_env_file():
    try:
        data = request.json
        if not data or 'path' not in data or 'content' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'})
        
        file_path = data['path']
        content = data['content']
        
        full_path = os.path.join(COMPOSE_DIR, file_path) if not os.path.isabs(file_path) else file_path
        
        # Ensure the directory exists
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, 'w') as f:
            f.write(content)
        
        return jsonify({'status': 'success', 'message': 'Environment file saved successfully'})
    except Exception as e:
        logger.error(f"Failed to save .env file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
    
@app.route('/api/compose/extract-env', methods=['POST'])
def extract_env_vars():
    try:
        data = request.json
        if not data or 'compose_file' not in data:
            return jsonify({'status': 'error', 'message': 'No compose file provided'})
            
        compose_file = data['compose_file']
        modify_compose = data.get('modify_compose', False)
        full_path = os.path.join(COMPOSE_DIR, compose_file) if not os.path.isabs(compose_file) else compose_file
        
        if not os.path.exists(full_path):
            return jsonify({'status': 'error', 'message': 'Compose file not found'})
            
        env_content, compose_modified = extract_env_from_compose(full_path, modify_compose)
        
        if not env_content:
            return jsonify({'status': 'error', 'message': 'Failed to extract environment variables'})
            
        # Generate .env file path
        env_path = os.path.join(os.path.dirname(full_path), '.env')
        
        # If requested to save directly
        if data.get('save_directly', False):
            try:
                # Save .env file
                with open(env_path, 'w') as f:
                    f.write(env_content)
                
                return jsonify({
                    'status': 'success',
                    'message': 'Environment variables extracted and saved to .env file' + 
                              (' and compose file updated' if compose_modified else ''),
                    'env_path': env_path
                })
            except Exception as e:
                logger.error(f"Failed to save .env file: {e}")
                return jsonify({'status': 'error', 'message': f'Failed to save .env file: {str(e)}'})
        
        # Otherwise just return the content
        return jsonify({
            'status': 'success',
            'content': env_content,
            'suggested_path': env_path,
            'compose_modified': compose_modified,
            'compose_content': open(full_path, 'r').read() if compose_modified else None
        })
    except Exception as e:
        logger.error(f"Failed to extract environment variables: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<id>/compose')
def get_container_compose(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        container = client.containers.get(id)
        labels = container.labels
        config_files = labels.get('com.docker.compose.project.config_files', None)
        if not config_files:
            return jsonify({'status': 'error', 'message': 'No compose file associated with this container'})
        file_path = config_files.split(',')[0]
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                content = f.read()
            return jsonify({
                'status': 'success',
                'content': content,
                'file': file_path
            })
        return jsonify({'status': 'error', 'message': 'Compose file not found'})
    except Exception as e:
        logger.error(f"Failed to get compose file for container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<id>/<action>', methods=['POST'])
def container_action(id, action):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        container = client.containers.get(id)
        if action == 'start':
            container.start()
        elif action == 'stop':
            container.stop()
        elif action == 'restart':
            container.restart()
        else:
            return jsonify({'status': 'error', 'message': 'Invalid action'})
        return jsonify({'status': 'success', 'message': f'Container {action}ed'})
    except Exception as e:
        logger.error(f"Failed to perform action {action} on container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<id>/inspect')
def inspect_container(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        container = client.containers.get(id)
        inspect_data = container.attrs
        return jsonify({'status': 'success', 'data': inspect_data})
    except Exception as e:
        logger.error(f"Failed to inspect container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<id>/logs')
def get_container_logs(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        container = client.containers.get(id)
        logs = container.logs(tail=100).decode('utf-8')
        return jsonify({'status': 'success', 'logs': logs})
    except Exception as e:
        logger.error(f"Failed to get logs for container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose/apply', methods=['POST'])
def apply_compose():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        data = request.json
        if not data or 'file' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'})
            
        compose_file = data['file']
        env_file = data.get('env_file')
        
        full_path = os.path.join(COMPOSE_DIR, compose_file) if not os.path.isabs(compose_file) else compose_file
        
        if not os.path.exists(full_path):
            return jsonify({'status': 'error', 'message': 'Compose file not found'})
        
        cmd = ['docker-compose', '-f', full_path]
        
        # Add env file if provided
        if env_file and os.path.exists(env_file):
            cmd.extend(['--env-file', env_file])
            
        cmd.append('up')
        cmd.append('-d')
        
        # Execute the command
        import subprocess
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"Failed to apply compose file: {result.stderr}")
            return jsonify({'status': 'error', 'message': result.stderr})
            
        return jsonify({'status': 'success', 'message': 'Compose file applied successfully'})
    except Exception as e:
        logger.error(f"Failed to apply compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=True)