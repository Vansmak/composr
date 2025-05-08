import json
import logging
import os
import threading
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler

from flask import Flask, render_template, jsonify, request

# Import helper functions
from functions import (
    initialize_docker_client, load_container_metadata, save_container_metadata, 
    get_compose_files, scan_all_compose_files, resolve_compose_file_path,
    extract_env_from_compose, calculate_uptime, find_caddy_container, get_compose_files_cached
)

# Initialize Flask app
app = Flask(__name__)

# Setup logging with rotation
log_handler = RotatingFileHandler('/app/composr.log', maxBytes=1024*1024, backupCount=5)
log_handler.setLevel(logging.DEBUG)
logger = logging.getLogger(__name__)
logger.addHandler(log_handler)
logger.setLevel(logging.INFO) #change to debug to troubleshoot
# Configuration
COMPOSE_DIR = os.getenv('COMPOSE_DIR', '/app/projects')
EXTRA_COMPOSE_DIRS = os.getenv('EXTRA_COMPOSE_DIRS', '').split(':')
METADATA_DIR = os.environ.get('METADATA_DIR', '/app')
CONTAINER_METADATA_FILE = os.path.join(METADATA_DIR, 'container_metadata.json')
CADDY_CONFIG_DIR = os.getenv('CADDY_CONFIG_DIR', '')
CADDY_CONFIG_FILE = os.getenv('CADDY_CONFIG_FILE', 'Caddyfile')

# Ensure metadata directory exists
os.makedirs(os.path.dirname(CONTAINER_METADATA_FILE), exist_ok=True)

# Caching variables
_system_stats_cache = {}
_system_stats_timestamp = 0
_container_cache = {}
_cache_timestamp = 0
_cache_lock = threading.Lock()
CACHE_TTL = 10  # seconds

# Initialize Docker client
client = initialize_docker_client(logger)

# Main route
@app.route('/')
def index():
    return render_template('index.html')

# Container routes
@app.route('/api/containers')
def get_containers():
    global _container_cache, _cache_timestamp
    if client is None:
        logger.error("Docker client not initialized")
        return jsonify([])

    try:
        search = request.args.get('search', '').lower()
        status = request.args.get('status', '')
        sort_by = request.args.get('sort', 'name')
        tag_filter = request.args.get('tag', '')

        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        current_time = time.time()

        if current_time - _cache_timestamp < CACHE_TTL and _container_cache:
            logger.debug("Using cached container data")
            containers = _container_cache.copy()
        else:
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

            # Save containers immediately without stats
            _container_cache = containers.copy()
            _cache_timestamp = current_time

            # Start background thread to update stats
            def update_stats():
                logger.debug("Updating container stats in background...")
                updated = []
                for container in containers:
                    if container['status'] == 'running':
                        try:
                            c = client.containers.get(container['id'])
                            stats = c.stats(stream=False)
                            if 'cpu_stats' in stats and 'precpu_stats' in stats:
                                cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - stats['precpu_stats']['cpu_usage']['total_usage']
                                system_delta = stats['cpu_stats']['system_cpu_usage'] - stats['precpu_stats']['system_cpu_usage']
                                if system_delta > 0:
                                    cpu_percent = (cpu_delta / system_delta) * stats['cpu_stats']['online_cpus'] * 100
                                    container['cpu_percent'] = round(cpu_percent, 2)
                            if 'memory_stats' in stats and 'usage' in stats['memory_stats']:
                                memory_usage = stats['memory_stats']['usage'] / (1024 * 1024)
                                container['memory_usage'] = round(memory_usage, 2)
                        except Exception as e:
                            logger.warning(f"Failed to get stats for container {container['id']}: {e}")
                    updated.append(container)

                global _container_cache
                _container_cache = updated
                logger.debug("Container stats updated!")

            threading.Thread(target=update_stats).start()

        # Apply filtering/sorting
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
        elif sort_by == 'tag':
            filtered_containers.sort(key=lambda x: (x.get('tags', [''])[0] if x.get('tags') else '', x['name'].lower()))

        return jsonify(filtered_containers)

    except Exception as e:
        logger.error(f"Failed to list containers: {e}")
        return jsonify([])

@app.route('/api/container/<id>/get_tags')
def get_container_tags(id):
    """Get tags for a specific container"""
    try:
        container = client.containers.get(id)
        container_name = container.name
        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        container_data = metadata.get(container_name, {})
        return jsonify({
            'status': 'success',
            'tags': container_data.get('tags', [])
        })
    except Exception as e:
        logger.error(f"Failed to get tags for container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<id>/custom_url')
def get_container_custom_url(id):
    """Get custom URL for a specific container"""
    try:
        container = client.containers.get(id)
        container_name = container.name
        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        container_data = metadata.get(container_name, {})
        return jsonify({
            'status': 'success',
            'url': container_data.get('custom_url', '')
        })
    except Exception as e:
        logger.error(f"Failed to get custom URL for container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<id>/settings', methods=['POST'])
def save_container_settings(id):
    """Save container settings (tags and custom URL)"""
    try:
        data = request.json
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'})
        
        container = client.containers.get(id)
        container_name = container.name
        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        
        # Initialize container metadata if not exists
        if container_name not in metadata:
            metadata[container_name] = {}
        
        # Update tags
        if 'tags' in data:
            metadata[container_name]['tags'] = data['tags']
        
        # Update custom URL
        if 'custom_url' in data:
            metadata[container_name]['custom_url'] = data['custom_url']
        
        # Save metadata
        if save_container_metadata(metadata, CONTAINER_METADATA_FILE, logger):
            return jsonify({'status': 'success', 'message': 'Settings saved successfully'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save settings'})
    except Exception as e:
        logger.error(f"Failed to save container settings: {e}")
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

@app.route('/api/container/<id>/<action>', methods=['POST'])
def container_action(id, action):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        container = client.containers.get(id)
        
        # Check if this is a Docker Compose container
        project_labels = {k: v for k, v in container.labels.items() if k.startswith('com.docker.compose')}
        
        if 'com.docker.compose.project' in project_labels and 'com.docker.compose.service' in project_labels:
            project = project_labels['com.docker.compose.project']
            service = project_labels['com.docker.compose.service']
            config_file = project_labels.get('com.docker.compose.project.config_files', '')
            
            if config_file and os.path.exists(config_file):
                compose_dir = os.path.dirname(config_file)
                compose_file = os.path.basename(config_file)
                
                # Use docker-compose to perform the action on this service
                import subprocess
                env = os.environ.copy()
                env["COMPOSE_PROJECT_NAME"] = project
                
                valid_actions = {'start': 'start', 'stop': 'stop', 'restart': 'restart'}
                if action not in valid_actions:
                    return jsonify({'status': 'error', 'message': 'Invalid action'})
                
                try:
                    logger.info(f"Using docker-compose to {action} container {container.name} (service: {service})")
                    result = subprocess.run(
                        ["docker", "compose", "-f", compose_file, valid_actions[action], service],
                        check=True,
                        cwd=compose_dir,
                        env=env,
                        text=True,
                        capture_output=True
                    )
                    logger.info(f"Docker Compose {action} completed: {result.stdout}")
                    return jsonify({'status': 'success', 'message': f'Container {action}ed via docker-compose'})
                except subprocess.CalledProcessError as e:
                    logger.error(f"Docker Compose {action} failed: {e.stderr}")
                    return jsonify({'status': 'error', 'message': f'Failed to {action} container: {e.stderr}'})
        
        # Fall back to direct Docker API for non-compose containers
        logger.info(f"Using Docker API to {action} container {container.name}")
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

@app.route('/api/container/<id>/remove', methods=['POST'])
def remove_container(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        container = client.containers.get(id)
        
        # Check if this is a Docker Compose container
        project_labels = {k: v for k, v in container.labels.items() if k.startswith('com.docker.compose')}
        
        if 'com.docker.compose.project' in project_labels and 'com.docker.compose.service' in project_labels:
            project = project_labels['com.docker.compose.project']
            service = project_labels['com.docker.compose.service']
            config_file = project_labels.get('com.docker.compose.project.config_files', '')
            
            if config_file and os.path.exists(config_file):
                compose_dir = os.path.dirname(config_file)
                compose_file = os.path.basename(config_file)
                
                # Use docker-compose to remove this service
                import subprocess
                env = os.environ.copy()
                env["COMPOSE_PROJECT_NAME"] = project
                
                try:
                    logger.info(f"Using docker-compose to remove container {container.name} (service: {service})")
                    result = subprocess.run(
                        ["docker", "compose", "-f", compose_file, "rm", "-sf", service],
                        check=True,
                        cwd=compose_dir,
                        env=env,
                        text=True,
                        capture_output=True
                    )
                    logger.info(f"Docker Compose remove completed: {result.stdout}")
                    return jsonify({'status': 'success', 'message': 'Container removed via docker-compose'})
                except subprocess.CalledProcessError as e:
                    logger.error(f"Docker Compose remove failed: {e.stderr}")
                    return jsonify({'status': 'error', 'message': f'Failed to remove container: {e.stderr}'})
        
        # Fall back to direct Docker API for non-compose containers
        logger.info(f"Using Docker API to remove container {container.name}")
        if container.status == 'running':
            container.stop()
        container.remove()
        return jsonify({'status': 'success', 'message': 'Container removed successfully'})
    except Exception as e:
        logger.error(f"Failed to remove container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/container/<id>/repull', methods=['POST'])
def repull_container(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        container = client.containers.get(id)
        
        # Check if this is a Docker Compose container
        project_labels = {k: v for k, v in container.labels.items() if k.startswith('com.docker.compose')}
        
        if 'com.docker.compose.project' in project_labels and 'com.docker.compose.service' in project_labels:
            project = project_labels['com.docker.compose.project']
            service = project_labels['com.docker.compose.service']
            config_file = project_labels.get('com.docker.compose.project.config_files', '')
            
            if config_file and os.path.exists(config_file):
                compose_dir = os.path.dirname(config_file)
                compose_file = os.path.basename(config_file)
                
                # Use docker-compose to pull and recreate this service
                import subprocess
                env = os.environ.copy()
                env["COMPOSE_PROJECT_NAME"] = project
                
                try:
                    # Pull the latest image
                    logger.info(f"Using docker-compose to pull image for {container.name} (service: {service})")
                    pull_result = subprocess.run(
                        ["docker", "compose", "-f", compose_file, "pull", service],
                        check=True,
                        cwd=compose_dir,
                        env=env,
                        text=True,
                        capture_output=True
                    )
                    logger.info(f"Docker Compose pull completed: {pull_result.stdout}")
                    
                    # Down and up this service
                    logger.info(f"Using docker-compose to recreate {container.name} (service: {service})")
                    up_result = subprocess.run(
                        ["docker", "compose", "-f", compose_file, "up", "-d", "--force-recreate", service],
                        check=True,
                        cwd=compose_dir,
                        env=env,
                        text=True,
                        capture_output=True
                    )
                    logger.info(f"Docker Compose up completed: {up_result.stdout}")
                    
                    return jsonify({
                        'status': 'success',
                        'message': f'Container {container.name} repulled and restarted via docker-compose'
                    })
                except subprocess.CalledProcessError as e:
                    logger.error(f"Docker Compose repull failed: {e.stderr}")
                    return jsonify({'status': 'error', 'message': f'Failed to repull container: {e.stderr}'})
        
        # Fall back to direct Docker API for non-compose containers
        logger.info(f"Using Docker API to repull container {container.name}")
        image_tag = None
        if container.image.tags:
            image_tag = container.image.tags[0]
        else:
            return jsonify({'status': 'error', 'message': 'Container has no image tag'})
        
        try:
            client.images.pull(image_tag)
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'Failed to pull image: {str(e)}'})
        
        was_running = container.status == 'running'
        if was_running:
            container.stop()
        container.remove()
        
        new_container = client.containers.run(
            image=image_tag,
            name=container.name,
            detach=True,
            ports=container.attrs.get('HostConfig', {}).get('PortBindings', {}),
            volumes=container.attrs.get('HostConfig', {}).get('Binds', []),
            environment=[f"{k}={v}" for k, v in container.attrs.get('Config', {}).get('Env', {}).items()],
            restart_policy=container.attrs.get('HostConfig', {}).get('RestartPolicy', {}),
            network_mode=container.attrs.get('HostConfig', {}).get('NetworkMode', 'default')
        )
        
        return jsonify({
            'status': 'success',
            'message': f'Container {container.name} repulled and restarted'
        })
    except Exception as e:
        logger.error(f"Failed to repull container {id}: {e}")
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
            logger.error(f"No compose file associated with container {id}")
            return jsonify({'status': 'error', 'message': 'No compose file associated with this container'})
        file_path = config_files.split(',')[0]
        logger.debug(f"Original compose file path: {file_path}")
        search_dirs = [COMPOSE_DIR] + [d for d in EXTRA_COMPOSE_DIRS if d]
        container_file_path = None
        for search_dir in search_dirs:
            file_name = os.path.basename(file_path)
            candidate_path = os.path.normpath(os.path.join(search_dir, file_name))
            logger.debug(f"Trying root candidate path: {candidate_path}")
            if os.path.exists(candidate_path):
                container_file_path = candidate_path
                break
            try:
                relative_path = os.path.relpath(file_path, os.path.dirname(os.path.dirname(search_dir)))
                candidate_path = os.path.normpath(os.path.join(search_dir, relative_path))
                logger.debug(f"Trying direct candidate path: {candidate_path}")
                if os.path.exists(candidate_path):
                    container_file_path = candidate_path
                    break
            except ValueError:
                pass
            for possible_base in ['/home', '/mnt', '/opt', '/var', '/data', '/']:
                if file_path.startswith(possible_base):
                    relative_path = file_path[len(possible_base):].lstrip('/')
                    candidate_path = os.path.normpath(os.path.join(search_dir, relative_path))
                    logger.debug(f"Trying mapped candidate path: {candidate_path}")
                    if os.path.exists(candidate_path):
                        container_file_path = candidate_path
                        break
            if container_file_path:
                break
        if not container_file_path:
            logger.error(f"Compose file not found for container {id}: {file_path}")
            return jsonify({
                'status': 'error',
                'message': f'Compose file {file_path} not found. Mount its directory to {COMPOSE_DIR} or add it to EXTRA_COMPOSE_DIRS in your docker-compose.yml.'
            })
        logger.debug(f"Found container file path: {container_file_path}")
        with open(container_file_path, 'r') as f:
            content = f.read()
        relative_path = os.path.relpath(container_file_path, COMPOSE_DIR)
        logger.debug(f"Returning relative path: {relative_path}")
        return jsonify({
            'status': 'success',
            'content': content,
            'file': relative_path
        })
    except Exception as e:
        logger.error(f"Failed to get compose file for container {id}: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to load compose file: {str(e)}'})

# System info route
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
        return jsonify({'status': 'error', 'message': str(e)})

# Compose file routes
@app.route('/api/compose/files')
def get_compose_files_endpoint():
    try:
        files = get_compose_files_cached(COMPOSE_DIR, tuple(EXTRA_COMPOSE_DIRS))
        logger.debug(f"Returning compose files: {files}")
        return jsonify({'status': 'success', 'files': files})
    except Exception as e:
        logger.error(f"Failed to get compose files: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to get compose files: {str(e)}', 'files': []})

@app.route('/api/compose/scan')
def scan_compose_files_endpoint():
    try:
        files = scan_all_compose_files(COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        logger.debug(f"Returning scanned compose files: {files}")
        return jsonify({'status': 'success', 'files': files})
    except Exception as e:
        logger.error(f"Failed to scan compose files: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to scan compose files: {str(e)}', 'files': []})

@app.route('/api/compose', methods=['GET'])
def get_compose():
    try:
        file_path = request.args.get('file')
        if not file_path:
            logger.error("No file path provided for compose file load")
            return jsonify({'status': 'error', 'message': 'No file path provided'})
        logger.debug(f"Attempting to load compose file: {file_path}")
        full_path = resolve_compose_file_path(file_path, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        if full_path and os.path.exists(full_path):
            with open(full_path, 'r') as f:
                content = f.read()
            logger.debug(f"Successfully loaded compose file: {full_path}")
            return jsonify({'status': 'success', 'content': content, 'file': file_path})
        logger.error(f"Compose file not found: {file_path}, resolved: {full_path}")
        return jsonify({
            'status': 'error',
            'message': f'Compose file {file_path} not found. Ensure it exists in {COMPOSE_DIR} or EXTRA_COMPOSE_DIRS.'
        })
    except Exception as e:
        logger.error(f"Failed to load compose file {file_path}: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to load compose file: {str(e)}'})

@app.route('/api/compose', methods=['POST'])
def save_compose():
    try:
        data = request.json
        if not data or 'content' not in data or 'file' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'})
        file_path = data['file']
        content = data['content']
        full_path = resolve_compose_file_path(file_path, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        if not full_path:
            full_path = os.path.join(COMPOSE_DIR, file_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w') as f:
            f.write(content)
        return jsonify({'status': 'success', 'message': 'Compose file saved successfully'})
    except Exception as e:
        logger.error(f"Failed to save compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose/extract-env', methods=['POST'])
def extract_env_vars():
    try:
        data = request.json
        if not data or 'compose_file' not in data:
            return jsonify({'status': 'error', 'message': 'No compose file provided'})
        compose_file = data['compose_file']
        modify_compose = data.get('modify_compose', False)
        full_path = resolve_compose_file_path(compose_file, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        if not full_path or not os.path.exists(full_path):
            return jsonify({'status': 'error', 'message': 'Compose file not found'})
        env_content, compose_modified = extract_env_from_compose(full_path, modify_compose, logger)
        if not env_content:
            return jsonify({'status': 'error', 'message': 'Failed to extract environment variables'})
        env_path = os.path.join(os.path.dirname(full_path), '.env')
        if data.get('save_directly', False):
            try:
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

@app.route('/api/compose/apply', methods=['POST'])
def apply_compose():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        data = request.json
        if not data or 'file' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'})
        
        compose_file = data['file']
        pull = data.get('pull', False)
        
        logger.info(f"Applying compose restart on file {compose_file}, pull={pull}")
        
        # Resolve the compose file path
        full_path = resolve_compose_file_path(compose_file, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        if not full_path or not os.path.exists(full_path):
            logger.error(f"Compose file not found: {compose_file}, resolved: {full_path}")
            return jsonify({'status': 'error', 'message': f'Compose file {compose_file} not found'})
        
        # Get the directory containing the compose file
        compose_dir = os.path.dirname(full_path)
        compose_filename = os.path.basename(full_path)
        
        # Use subprocess to run docker-compose commands
        import subprocess
        
        # Environment setup
        env = os.environ.copy()
        
        # First, check if the compose file has a "name:" property
        with open(full_path, 'r') as f:
            import yaml
            compose_data = yaml.safe_load(f)
            project_name = compose_data.get('name', os.path.basename(compose_dir))
        
        env["COMPOSE_PROJECT_NAME"] = project_name
        logger.info(f"Using project name: {project_name}")
        
        # Prepare the command logging handler
        def log_command(cmd, cwd):
            cmd_str = ' '.join(cmd)
            logger.info(f"Running command: {cmd_str} in {cwd}")
            return subprocess.run(
                cmd, 
                check=True, 
                cwd=cwd, 
                env=env,
                text=True,
                capture_output=True
            )
        
        # Step 1: If requested, pull latest images
        if pull:
            logger.info("Pulling latest images...")
            try:
                result = log_command(
                    ["docker", "compose", "-f", compose_filename, "pull"],
                    compose_dir
                )
                logger.info(f"Pull completed: {result.stdout}")
            except subprocess.CalledProcessError as e:
                logger.error(f"Pull failed: {e.stderr}")
                return jsonify({'status': 'error', 'message': f'Failed to pull images: {e.stderr}'})
        
        # Step 2: Stop the containers
        logger.info("Stopping containers...")
        try:
            result = log_command(
                ["docker", "compose", "-f", compose_filename, "down"],
                compose_dir
            )
            logger.info(f"Down completed: {result.stdout}")
        except subprocess.CalledProcessError as e:
            logger.error(f"Down failed: {e.stderr}")
            # Continue anyway, as some containers might not exist yet
        
        # Step 3: Start the containers
        logger.info("Starting containers...")
        try:
            result = log_command(
                ["docker", "compose", "-f", compose_filename, "up", "-d"],
                compose_dir
            )
            logger.info(f"Up completed: {result.stdout}")
        except subprocess.CalledProcessError as e:
            logger.error(f"Up failed: {e.stderr}")
            return jsonify({'status': 'error', 'message': f'Failed to start containers: {e.stderr}'})
        
        return jsonify({
            'status': 'success',
            'message': f'Successfully restarted containers for {project_name}'
        })
        
    except Exception as e:
        logger.error(f"Failed to apply compose file: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)})
# Environment file routes
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
        logger.error(f"Failed to find .env files: {e}")
        return jsonify({'status': 'error', 'message': str(e), 'files': []})

@app.route('/api/env/file')
def get_env_file_content():
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
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w') as f:
            f.write(content)
        return jsonify({'status': 'success', 'message': 'Environment file saved successfully'})
    except Exception as e:
        logger.error(f"Failed to save .env file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Image management routes
@app.route('/api/images')
def get_images():
    if client is None:
        logger.error("Docker client not initialized")
        return jsonify({'status': 'error', 'message': 'Docker service unavailable. Check Docker socket configuration.'})
    try:
        images = []
        for image in client.images.list():
            tags = image.tags
            name = tags[0] if tags else '<none>:<none>'
            size_mb = round(image.attrs['Size'] / (1024 * 1024), 2)
            # Handle both integer and string timestamps
            created_val = image.attrs['Created']
            if isinstance(created_val, (int, float)):
                created = datetime.fromtimestamp(created_val).strftime('%Y-%m-%d %H:%M:%S')
            else:
                # Assume string is ISO 8601 or similar
                try:
                    created_dt = datetime.strptime(created_val.split('.')[0], '%Y-%m-%dT%H:%M:%S')
                    created = created_dt.strftime('%Y-%m-%d %H:%M:%S')
                except (ValueError, TypeError) as e:
                    logger.warning(f"Invalid created timestamp for image {name}: {created_val}")
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
        logger.debug(f"Returning {len(images)} images")
        return jsonify(images)
    except Exception as e:
        logger.error(f"Failed to list images: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to list images: {str(e)}'})

@app.route('/api/images/prune', methods=['POST'])
def prune_images():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        result = client.images.prune()
        space_reclaimed = round(result['SpaceReclaimed'] / (1024 * 1024), 2)
        return jsonify({
            'status': 'success',
            'message': f'Pruned {len(result["ImagesDeleted"] or [])} images, reclaimed {space_reclaimed} MB'
        })
    except Exception as e:
        logger.error(f"Failed to prune images: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/images/remove_unused', methods=['POST'])
def remove_unused_images():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        force = request.args.get('force', 'false').lower() == 'true'
        logger.info(f"Removing unused images with force={force}")
        
        # Get all images
        images = client.images.list()
        
        # Get all running containers
        containers = client.containers.list(all=True)
        used_image_ids = set()
        
        # Collect image IDs used by containers
        for container in containers:
            used_image_ids.add(container.image.id)
        
        # Find unused images
        unused_images = []
        for image in images:
            if image.id not in used_image_ids and image.tags:  # Skip untagged images
                unused_images.append(image)
        
        # Remove unused images
        removed = 0
        failed = 0
        failure_reasons = []
        
        for image in unused_images:
            try:
                logger.info(f"Attempting to remove image {image.id} with force={force}")
                client.images.remove(image.id, force=force)
                removed += 1
            except Exception as e:
                logger.error(f"Failed to remove image {image.id}: {e}")
                failed += 1
                failure_reasons.append(f"{image.id}: {str(e)}")
        
        message = f'Removed {removed} unused images, {failed} failed'
        if failure_reasons and len(failure_reasons) <= 3:
            message += f". Failures: {'; '.join(failure_reasons)}"
            
        return jsonify({
            'status': 'success',
            'message': message
        })
    except Exception as e:
        logger.error(f"Failed to remove unused images: {e}")
        return jsonify({'status': 'error', 'message': str(e)})


@app.route('/api/images/<id>/remove', methods=['POST'])
def remove_image(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        force = request.args.get('force', 'false').lower() == 'true'
        client.images.remove(id, force=force)
        return jsonify({'status': 'success', 'message': 'Image removed successfully'})
    except Exception as e:
        logger.error(f"Failed to remove image {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
# Caddy file routes
@app.route('/api/caddy/file')
def get_caddy_file():
    try:
        if not CADDY_CONFIG_DIR:
            return jsonify({'status': 'error', 'message': 'Caddy config directory not configured'})
            
        file_path = os.path.join(CADDY_CONFIG_DIR, CADDY_CONFIG_FILE)
        if not os.path.exists(file_path):
            return jsonify({'status': 'error', 'message': 'Caddy config file not found'})
            
        with open(file_path, 'r') as f:
            content = f.read()
        return jsonify({'status': 'success', 'content': content, 'file': file_path})
    except Exception as e:
        logger.error(f"Failed to load Caddy file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/caddy/file', methods=['POST'])
def save_caddy_file():
    try:
        if not CADDY_CONFIG_DIR:
            return jsonify({'status': 'error', 'message': 'Caddy config directory not configured'})
            
        data = request.json
        if not data or 'content' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'})
            
        file_path = os.path.join(CADDY_CONFIG_DIR, CADDY_CONFIG_FILE)
        with open(file_path, 'w') as f:
            f.write(data['content'])
            
        # Optional: Reload Caddy to apply changes
        if data.get('reload', False):
            caddy_container = find_caddy_container(client, logger)
            if caddy_container:
                caddy_container.exec_run("caddy reload")
                
        return jsonify({'status': 'success', 'message': 'Caddy config saved successfully'})
    except Exception as e:
        logger.error(f"Failed to save Caddy file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
    
def perform_batch_action(action, container_ids):
    """Perform an action on multiple containers, using Docker Compose when possible"""
    results = {
        'success': 0,
        'failed': 0,
        'errors': []
    }
    
    # Group containers by compose project for more efficient operations
    compose_groups = {}
    non_compose_containers = []
    
    for id in container_ids:
        try:
            container = client.containers.get(id)
            project_labels = {k: v for k, v in container.labels.items() if k.startswith('com.docker.compose')}
            
            if ('com.docker.compose.project' in project_labels and 
                'com.docker.compose.service' in project_labels and
                'com.docker.compose.project.config_files' in project_labels):
                
                project = project_labels['com.docker.compose.project']
                service = project_labels['com.docker.compose.service']
                config_file = project_labels['com.docker.compose.project.config_files']
                
                if os.path.exists(config_file):
                    key = (project, config_file)
                    if key not in compose_groups:
                        compose_groups[key] = []
                    
                    compose_groups[key].append((container, service))
                    continue
            
            # If we get here, it's not a compose container or we couldn't determine compose details
            non_compose_containers.append(container)
            
        except Exception as e:
            logger.error(f"Failed to process container {id} for batch action: {e}")
            results['failed'] += 1
            results['errors'].append(f"Container {id}: {str(e)}")
    
    # Process compose groups
    for (project, config_file), containers in compose_groups.items():
        compose_dir = os.path.dirname(config_file)
        compose_file = os.path.basename(config_file)
        
        # Get list of services in this project
        services = [service for _, service in containers]
        
        try:
            import subprocess
            env = os.environ.copy()
            env["COMPOSE_PROJECT_NAME"] = project
            
            valid_actions = {'start': 'start', 'stop': 'stop', 'restart': 'restart', 'remove': 'rm -sf'}
            if action not in valid_actions:
                results['failed'] += len(services)
                results['errors'].append(f"Invalid action: {action}")
                continue
            
            # Execute the action on all services at once
            cmd = ["docker", "compose", "-f", compose_file]
            if action == 'remove':
                cmd.extend(valid_actions[action].split())
            else:
                cmd.append(valid_actions[action])
            cmd.extend(services)
            
            logger.info(f"Running batch {action} on project {project}, services: {services}, command: {cmd}")
            
            result = subprocess.run(
                cmd,
                check=True,
                cwd=compose_dir,
                env=env,
                text=True,
                capture_output=True
            )
            
            logger.info(f"Batch {action} on project {project} completed: {result.stdout}")
            results['success'] += len(services)
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Batch {action} on project {project} failed: {e.stderr}")
            results['failed'] += len(services)
            results['errors'].append(f"Project {project}: {e.stderr}")
        except Exception as e:
            logger.error(f"Unexpected error in batch {action} on project {project}: {e}")
            results['failed'] += len(services)
            results['errors'].append(f"Project {project}: {str(e)}")
    
    # Process non-compose containers using the Docker API
    for container in non_compose_containers:
        try:
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
                results['failed'] += 1
                results['errors'].append(f"Invalid action: {action}")
                continue
            
            results['success'] += 1
            
        except Exception as e:
            logger.error(f"Failed to {action} container {container.id}: {e}")
            results['failed'] += 1
            results['errors'].append(f"Container {container.name}: {str(e)}")
    
    return results

@app.route('/api/batch/<action>', methods=['POST'])
def batch_action(action):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        data = request.json
        if not data or 'containers' not in data:
            return jsonify({'status': 'error', 'message': 'No containers specified'})
        
        container_ids = data['containers']
        logger.info(f"Received batch {action} request for {len(container_ids)} containers")
        
        results = perform_batch_action(action, container_ids)
        
        if results['failed'] == 0:
            return jsonify({
                'status': 'success',
                'message': f'Successfully performed {action} on {results["success"]} containers'
            })
        else:
            return jsonify({
                'status': 'partial',
                'message': f'Completed with {results["success"]} successful and {results["failed"]} failed operations',
                'errors': results['errors']
            })
            
    except Exception as e:
        logger.error(f"Failed to perform batch {action}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=True)