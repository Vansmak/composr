from flask import Flask, render_template, jsonify, request, send_file  # Add send_file here
import json
import logging
import os
import threading
import time
import re
from datetime import datetime
from logging.handlers import RotatingFileHandler

# Add these new imports for backup functionality
import zipfile
import tempfile
import shutil
import yaml
# Import helper functions
from functions import (
    initialize_docker_client, load_container_metadata, save_container_metadata, 
    get_compose_files, scan_all_compose_files, resolve_compose_file_path,
    extract_env_from_compose, calculate_uptime, find_caddy_container, get_compose_files_cached
)
from remote_hosts import host_manager

# Wait for local client to be ready
start_time = time.time()
while host_manager.get_client('local') is None and time.time() - start_time < 5:
    time.sleep(0.1)

# Add after imports
__version__ = "1.6.0"

# Initialize Flask app
app = Flask(__name__)

# Configuration - MOVED BEFORE LOGGING
COMPOSE_DIR = os.getenv('COMPOSE_DIR', '/app/projects')
EXTRA_COMPOSE_DIRS = os.getenv('EXTRA_COMPOSE_DIRS', '').split(':')
METADATA_DIR = os.environ.get('METADATA_DIR', '/app')
CONTAINER_METADATA_FILE = os.path.join(METADATA_DIR, 'container_metadata.json')
CADDY_CONFIG_DIR = os.getenv('CADDY_CONFIG_DIR', '')
CADDY_CONFIG_FILE = os.getenv('CADDY_CONFIG_FILE', 'Caddyfile')

# Add hosts file path AFTER METADATA_DIR is defined
HOSTS_FILE = os.path.join(METADATA_DIR, 'host_bookmarks.json')

# Simple functions to load/save hosts
def load_hosts():
    try:
        if os.path.exists(HOSTS_FILE):
            with open(HOSTS_FILE, 'r') as f:
                return json.load(f)
        return {"local": {"url": "", "connected": True}}
    except Exception as e:
        logger.error(f"Failed to load hosts: {e}")
        return {"local": {"url": "", "connected": True}}

def save_hosts(hosts):
    try:
        with open(HOSTS_FILE, 'w') as f:
            json.dump(hosts, f)
        return True
    except Exception as e:
        logger.error(f"Failed to save hosts: {e}")
        return False

# Ensure metadata directory exists
os.makedirs(os.path.dirname(CONTAINER_METADATA_FILE), exist_ok=True)

# Setup logging with rotation - NOW USES METADATA_DIR
log_file = os.path.join(METADATA_DIR, 'composr.log')
log_handler = RotatingFileHandler(log_file, maxBytes=1024*1024, backupCount=5)

# Set log level based on environment variable
log_level = logging.DEBUG if os.getenv('DEBUG', 'false').lower() == 'true' else logging.INFO
log_handler.setLevel(log_level)
logger = logging.getLogger(__name__)
logger.addHandler(log_handler)
logger.setLevel(log_level)

# Log the startup
logger.info(f"Composr starting up - Log file: {log_file}, Debug mode: {log_level == logging.DEBUG}")

# Caching variables
_system_stats_cache = {}
_system_stats_timestamp = 0
_container_cache = {}
_cache_timestamp = 0
_cache_lock = threading.Lock()
CACHE_TTL = 10  # seconds

# Initialize Docker client
client = host_manager.get_client()

# Main route
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/backup/create', methods=['POST'])
def create_backup():
    """Create a comprehensive backup of all containers, compose files, and metadata"""
    try:
        if client is None:
            return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
        
        # Get backup options from request
        data = request.json or {}
        include_env_files = data.get('include_env_files', True)
        include_compose_files = data.get('include_compose_files', True)
        backup_name = data.get('backup_name', f"composr-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
        
        logger.info(f"Creating backup: {backup_name}")
        
        # 1. Get all containers with full metadata
        containers = []
        try:
            container_metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
            logger.info(f"Loaded container metadata for {len(container_metadata)} containers")
        except Exception as e:
            logger.warning(f"Failed to load container metadata: {e}")
            container_metadata = {}
        
        try:
            docker_containers = client.containers.list(all=True)
            logger.info(f"Found {len(docker_containers)} Docker containers")
        except Exception as e:
            logger.error(f"Failed to list Docker containers: {e}")
            return jsonify({'status': 'error', 'message': f'Failed to list containers: {str(e)}'})
        
        for container in docker_containers:
            try:
                labels = container.labels or {}
                container_name = container.name
                
                # Get container metadata
                container_meta = container_metadata.get(container_name, {})
                
                # Extract comprehensive container info
                container_info = {
                    'name': container_name,
                    'image': container.image.tags[0] if container.image.tags else container.image.id,
                    'status': container.status,
                    'created': container.attrs.get('Created', ''),
                    'compose_project': labels.get('com.docker.compose.project'),
                    'compose_service': labels.get('com.docker.compose.service'),
                    'compose_file': labels.get('com.docker.compose.project.config_files'),
                    'tags': container_meta.get('tags', []),
                    'custom_url': container_meta.get('custom_url', ''),
                    'ports': {},
                    'volumes': [],
                    'environment': [],
                    'networks': [],
                    'labels': dict(labels),
                    'restart_policy': container.attrs.get('HostConfig', {}).get('RestartPolicy', {}),
                }
                
                # Extract port mappings
                try:
                    port_bindings = container.attrs.get('HostConfig', {}).get('PortBindings')
                    if port_bindings:  # Check if not None
                        for container_port, host_config in port_bindings.items():
                            if host_config and len(host_config) > 0:
                                host_port = host_config[0].get('HostPort')
                                if host_port:
                                    container_info['ports'][host_port] = container_port
                except Exception as e:
                    logger.warning(f"Failed to extract ports for {container_name}: {e}")
                
                # Extract volume mounts
                try:
                    mounts = container.attrs.get('Mounts', [])
                    for mount in mounts:
                        if mount.get('Type') == 'bind':
                            container_info['volumes'].append(f"{mount.get('Source', '')}:{mount.get('Destination', '')}")
                        elif mount.get('Type') == 'volume':
                            container_info['volumes'].append(f"{mount.get('Name', '')}:{mount.get('Destination', '')}")
                except Exception as e:
                    logger.warning(f"Failed to extract volumes for {container_name}: {e}")
                
                # Extract environment variables
                try:
                    env_vars = container.attrs.get('Config', {}).get('Env', [])
                    container_info['environment'] = [env for env in env_vars if not env.startswith('PATH=')]
                except Exception as e:
                    logger.warning(f"Failed to extract environment for {container_name}: {e}")
                
                # Extract networks
                try:
                    networks = container.attrs.get('NetworkSettings', {}).get('Networks', {})
                    container_info['networks'] = list(networks.keys())
                except Exception as e:
                    logger.warning(f"Failed to extract networks for {container_name}: {e}")
                
                containers.append(container_info)
                
            except Exception as e:
                logger.error(f"Failed to process container {container.name}: {e}")
                continue
        
        logger.info(f"Processed {len(containers)} containers for backup")
        
        # 2. Create backup metadata
        backup_metadata = {
            'backup_info': {
                'name': backup_name,
                'created': datetime.now().isoformat(),
                'composr_version': __version__,
                'host': 'composr-host',
                'container_count': len(containers),
                'backup_options': {
                    'include_env_files': include_env_files,
                    'include_compose_files': include_compose_files
                }
            },
            'containers': containers
        }
        
        # 3. Generate unified backup compose file
        try:
            backup_compose = generate_backup_compose(containers, backup_metadata['backup_info'])
            logger.info("Generated backup compose file")
        except Exception as e:
            logger.error(f"Failed to generate backup compose: {e}")
            backup_compose = {'version': '3.8', 'services': {}}
        
        # 4. Create temporary directory for backup files
        with tempfile.TemporaryDirectory() as temp_dir:
            logger.info(f"Using temporary directory: {temp_dir}")
            
            # Save backup compose file
            backup_compose_path = os.path.join(temp_dir, 'backup-compose.yml')
            try:
                with open(backup_compose_path, 'w') as f:
                    yaml.dump(backup_compose, f, default_flow_style=False, sort_keys=False)
                logger.info("Saved backup compose file")
            except Exception as e:
                logger.error(f"Failed to save backup compose: {e}")
                # Create a minimal compose file
                with open(backup_compose_path, 'w') as f:
                    f.write("version: '3.8'\nservices: {}\n")
            
            # Save metadata JSON
            metadata_path = os.path.join(temp_dir, 'backup-metadata.json')
            try:
                with open(metadata_path, 'w') as f:
                    json.dump(backup_metadata, f, indent=2)
                logger.info("Saved backup metadata")
            except Exception as e:
                logger.error(f"Failed to save backup metadata: {e}")
                with open(metadata_path, 'w') as f:
                    json.dump({'error': str(e)}, f)
            
            # 5. Copy original compose files if requested
            compose_files_copied = []
            if include_compose_files:
                compose_files_dir = os.path.join(temp_dir, 'original-compose-files')
                os.makedirs(compose_files_dir, exist_ok=True)
                
                try:
                    compose_files = get_compose_files_cached(COMPOSE_DIR, tuple(EXTRA_COMPOSE_DIRS if EXTRA_COMPOSE_DIRS else []))
                    logger.info(f"Found {len(compose_files)} compose files to backup")
                    
                    for compose_file in compose_files:
                        try:
                            full_path = resolve_compose_file_path(compose_file, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
                            if full_path and os.path.exists(full_path):
                                # Create directory structure in backup
                                rel_path = compose_file
                                backup_file_path = os.path.join(compose_files_dir, rel_path)
                                os.makedirs(os.path.dirname(backup_file_path), exist_ok=True)
                                
                                shutil.copy2(full_path, backup_file_path)
                                compose_files_copied.append(rel_path)
                                logger.debug(f"Copied compose file: {rel_path}")
                        except Exception as e:
                            logger.warning(f"Failed to copy compose file {compose_file}: {e}")
                except Exception as e:
                    logger.warning(f"Failed to copy compose files: {e}")
            
            # 6. Copy env files if requested
            env_files_copied = []
            if include_env_files:
                env_files_dir = os.path.join(temp_dir, 'env-files')
                os.makedirs(env_files_dir, exist_ok=True)
                
                try:
                    # Find all .env files
                    extra_dirs = EXTRA_COMPOSE_DIRS if EXTRA_COMPOSE_DIRS else []
                    if isinstance(extra_dirs, str):
                        extra_dirs = extra_dirs.split(':') if extra_dirs else []
                    
                    search_dirs = [COMPOSE_DIR] + [d for d in extra_dirs if d and os.path.exists(d)]
                    logger.info(f"Searching for .env files in: {search_dirs}")
                    
                    for search_dir in search_dirs:
                        for root, dirs, files in os.walk(search_dir):
                            for file in files:
                                if file == '.env':
                                    try:
                                        env_file_path = os.path.join(root, file)
                                        rel_path = os.path.relpath(env_file_path, search_dir)
                                        backup_env_path = os.path.join(env_files_dir, rel_path)
                                        os.makedirs(os.path.dirname(backup_env_path), exist_ok=True)
                                        
                                        shutil.copy2(env_file_path, backup_env_path)
                                        env_files_copied.append(rel_path)
                                        logger.debug(f"Copied env file: {rel_path}")
                                    except Exception as e:
                                        logger.warning(f"Failed to copy env file {file}: {e}")
                except Exception as e:
                    logger.warning(f"Failed to copy env files: {e}")
            
            # 7. Create simple README
            readme_content = f"""# Composr Backup: {backup_name}

Created: {backup_metadata['backup_info']['created']}
Containers: {len(containers)}
Compose Files: {len(compose_files_copied)}
Env Files: {len(env_files_copied)}

## Quick Deploy
```bash
docker-compose -f backup-compose.yml up -d
```

## Files
- backup-compose.yml - Unified compose file
- backup-metadata.json - Container metadata
- original-compose-files/ - Original compose files
- env-files/ - Environment files
"""
            readme_path = os.path.join(temp_dir, 'README.md')
            with open(readme_path, 'w') as f:
                f.write(readme_content)
            logger.info("Created README file")
            
            # 8. Create ZIP archive
            zip_filename = f"{backup_name}.zip"
            zip_path = os.path.join(tempfile.gettempdir(), zip_filename)
            
            logger.info(f"Creating ZIP file: {zip_path}")
            
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, temp_dir)
                        zipf.write(file_path, arcname)
                        logger.debug(f"Added to ZIP: {arcname}")
            
            # Check if ZIP file was created and has content
            if os.path.exists(zip_path):
                zip_size = os.path.getsize(zip_path)
                logger.info(f"ZIP file created successfully, size: {zip_size} bytes")
                
                if zip_size == 0:
                    logger.error("ZIP file is empty!")
                    return jsonify({'status': 'error', 'message': 'Created backup file is empty'})
            else:
                logger.error("ZIP file was not created!")
                return jsonify({'status': 'error', 'message': 'Failed to create backup file'})
            
            # 9. Send file as download
            try:
                response = send_file(
                    zip_path,
                    as_attachment=True,
                    download_name=zip_filename,
                    mimetype='application/zip'
                )
                
                # Clean up the temp file after sending
                @response.call_on_close
                def remove_file():
                    try:
                        if os.path.exists(zip_path):
                            os.remove(zip_path)
                    except:
                        pass
                
                return response
                
            except Exception as e:
                logger.error(f"Failed to send backup file: {e}")
                return jsonify({'status': 'error', 'message': f'Failed to send backup file: {str(e)}'})
    
    except Exception as e:
        logger.error(f"Failed to create backup: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)})

# Simplified backup compose generation
def generate_backup_compose(containers, backup_info):
    """Generate a unified docker-compose.yml file from container data"""
    compose_data = {
        'version': '3.8',
        'x-backup-info': backup_info,
        'services': {}
    }
    
    if not containers:
        logger.warning("No containers to backup")
        return compose_data
    
    for container in containers:
        try:
            service_name = container['name'].replace('/', '').replace('_', '-')
            if not service_name:
                continue
            
            service_config = {
                'image': container.get('image', 'unknown'),
                'container_name': container.get('name', service_name),
                'labels': [
                    f"composr.backup.original-name={container.get('name', service_name)}",
                    f"composr.backup.status={container.get('status', 'unknown')}",
                    f"composr.backup.created={backup_info.get('created', '')}",
                ]
            }
            
            # Add container metadata as labels
            if container.get('tags'):
                service_config['labels'].append(f"composr.backup.tags={','.join(container['tags'])}")
            if container.get('custom_url'):
                service_config['labels'].append(f"composr.backup.custom-url={container['custom_url']}")
            if container.get('compose_project'):
                service_config['labels'].append(f"composr.backup.original-stack={container['compose_project']}")
            
            # Add ports
            if container.get('ports'):
                service_config['ports'] = [f"{host}:{container_port}" for host, container_port in container['ports'].items()]
            
            # Add volumes (filter out empty ones)
            if container.get('volumes'):
                service_config['volumes'] = [v for v in container['volumes'] if v and ':' in v]
            
            # Add environment
            if container.get('environment'):
                service_config['environment'] = [e for e in container['environment'] if e]
            
            # Add networks (filter out default ones)
            if container.get('networks'):
                networks = [n for n in container['networks'] if n not in ['bridge', 'host', 'none']]
                if networks:
                    service_config['networks'] = networks
            
            # Add restart policy
            restart_policy = container.get('restart_policy', {})
            if restart_policy.get('Name') and restart_policy['Name'] != 'no':
                service_config['restart'] = restart_policy['Name']
            
            compose_data['services'][service_name] = service_config
            
        except Exception as e:
            logger.error(f"Failed to process container {container.get('name', 'unknown')} for compose: {e}")
            continue
    
    logger.info(f"Generated backup compose with {len(compose_data['services'])} services")
    return compose_data

def generate_restore_script(backup_metadata, compose_files, env_files):
    """Generate a bash script to restore the backup"""
    script = f"""#!/bin/bash
# Composr Backup Restore Script
# Generated: {backup_metadata['backup_info']['created']}
# Backup: {backup_metadata['backup_info']['name']}

set -e

echo "🔄 Restoring Composr Backup: {backup_metadata['backup_info']['name']}"
echo "📅 Created: {backup_metadata['backup_info']['created']}"
echo "🐳 Containers: {backup_metadata['backup_info']['container_count']}"
echo ""

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed or not in PATH"
    exit 1
fi

echo "✅ Docker and Docker Compose are available"
echo ""

# Restore compose files
if [ -d "original-compose-files" ]; then
    echo "📁 Restoring original compose files..."
    cp -r original-compose-files/* ./
    echo "✅ Compose files restored"
fi

# Restore env files
if [ -d "env-files" ]; then
    echo "📁 Restoring environment files..."
    cp -r env-files/* ./
    echo "✅ Environment files restored"
fi

echo ""
echo "🚀 To deploy the backup compose:"
echo "   docker-compose -f backup-compose.yml up -d"
echo ""
echo "⚠️  Note: This will create containers with backup labels."
echo "   You may want to edit backup-compose.yml first."
echo ""
echo "✅ Restore completed!"
"""
    return script

def generate_backup_readme(backup_metadata, compose_files, env_files):
    """Generate README for the backup"""
    readme = f"""# Composr Backup: {backup_metadata['backup_info']['name']}

## Backup Information
- **Created**: {backup_metadata['backup_info']['created']}
- **Composr Version**: {backup_metadata['backup_info'].get('composr_version', 'unknown')}
- **Host**: {backup_metadata['backup_info'].get('host', 'unknown')}
- **Containers**: {backup_metadata['backup_info']['container_count']}

## Files Included

### Core Backup Files
- `backup-compose.yml` - Unified compose file with all containers
- `backup-metadata.json` - Complete container metadata and settings
- `restore.sh` - Automated restore script
- `README.md` - This file

### Original Files
"""
    
    if compose_files:
        readme += f"- `original-compose-files/` - {len(compose_files)} original compose files\n"
    if env_files:
        readme += f"- `env-files/` - {len(env_files)} environment files\n"
    
    readme += """
## Quick Restore

1. Extract this archive to your desired location
2. Run the restore script: `./restore.sh`
3. Deploy containers: `docker-compose -f backup-compose.yml up -d`

## Manual Restore

1. Copy original compose and env files to your compose directory
2. Import container metadata into Composr
3. Deploy individual compose files as needed

## Container Metadata

Each container in `backup-compose.yml` includes labels with:
- Original container name and status
- Custom tags and URLs from Composr
- Original Docker labels and compose project info
- Backup timestamp and version info

## Notes

- Volume data is NOT included - backup volumes separately
- Network configurations assume external networks exist
- Container settings may need adjustment for different environments
- Review `backup-metadata.json` for complete container details
"""
    
    return readme

@app.route('/api/backup/restore', methods=['POST'])
def restore_backup():
    """Restore containers and metadata from backup file"""
    try:
        if 'backup_file' not in request.files:
            return jsonify({'status': 'error', 'message': 'No backup file provided'})
        
        backup_file = request.files['backup_file']
        if backup_file.filename == '':
            return jsonify({'status': 'error', 'message': 'No file selected'})
        
        # Create temporary directory for extraction
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save uploaded file
            zip_path = os.path.join(temp_dir, 'backup.zip')
            backup_file.save(zip_path)
            
            # Extract backup
            extract_dir = os.path.join(temp_dir, 'extracted')
            with zipfile.ZipFile(zip_path, 'r') as zipf:
                zipf.extractall(extract_dir)
            
            # Read backup metadata
            metadata_path = os.path.join(extract_dir, 'backup-metadata.json')
            if not os.path.exists(metadata_path):
                return jsonify({'status': 'error', 'message': 'Invalid backup file - missing metadata'})
            
            with open(metadata_path, 'r') as f:
                backup_metadata = json.load(f)
            
            # Restore compose files
            compose_files_restored = []
            compose_files_dir = os.path.join(extract_dir, 'original-compose-files')
            if os.path.exists(compose_files_dir):
                for root, dirs, files in os.walk(compose_files_dir):
                    for file in files:
                        src_path = os.path.join(root, file)
                        rel_path = os.path.relpath(src_path, compose_files_dir)
                        dst_path = os.path.join(COMPOSE_DIR, rel_path)
                        
                        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
                        shutil.copy2(src_path, dst_path)
                        compose_files_restored.append(rel_path)
            
            # Restore env files
            env_files_restored = []
            env_files_dir = os.path.join(extract_dir, 'env-files')
            if os.path.exists(env_files_dir):
                for root, dirs, files in os.walk(env_files_dir):
                    for file in files:
                        src_path = os.path.join(root, file)
                        rel_path = os.path.relpath(src_path, env_files_dir)
                        dst_path = os.path.join(COMPOSE_DIR, rel_path)
                        
                        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
                        shutil.copy2(src_path, dst_path)
                        env_files_restored.append(rel_path)
            
            # Restore container metadata (tags, custom URLs)
            container_metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
            for container_info in backup_metadata['containers']:
                container_name = container_info['name']
                if container_info.get('tags') or container_info.get('custom_url'):
                    if container_name not in container_metadata:
                        container_metadata[container_name] = {}
                    
                    if container_info.get('tags'):
                        container_metadata[container_name]['tags'] = container_info['tags']
                    
                    if container_info.get('custom_url'):
                        container_metadata[container_name]['custom_url'] = container_info['custom_url']
            
            # Save updated metadata
            save_container_metadata(container_metadata, CONTAINER_METADATA_FILE, logger)
            
            # Copy backup compose file to compose directory for reference
            backup_compose_src = os.path.join(extract_dir, 'backup-compose.yml')
            if os.path.exists(backup_compose_src):
                backup_compose_dst = os.path.join(COMPOSE_DIR, f"backup-{backup_metadata['backup_info']['name']}.yml")
                shutil.copy2(backup_compose_src, backup_compose_dst)
            
            return jsonify({
                'status': 'success',
                'message': f"Backup restored successfully",
                'backup_info': backup_metadata['backup_info'],
                'restored': {
                    'compose_files': len(compose_files_restored),
                    'env_files': len(env_files_restored),
                    'container_metadata': len([c for c in backup_metadata['containers'] if c.get('tags') or c.get('custom_url')])
                }
            })
    
    except Exception as e:
        logger.error(f"Failed to restore backup: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/backup/preview', methods=['POST'])
def preview_backup():
    """Preview what would be included in a backup without creating it"""
    try:
        if client is None:
            return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
        
        # Count containers
        containers = client.containers.list(all=True)
        container_count = len(containers)
        
        # Count compose files
        compose_files = get_compose_files_cached(COMPOSE_DIR, tuple(EXTRA_COMPOSE_DIRS))
        compose_count = len(compose_files)
        
        # Count env files
        env_count = 0
        search_dirs = [COMPOSE_DIR] + [d for d in EXTRA_COMPOSE_DIRS if d and isinstance(d, str)]
        for search_dir in search_dirs:
            if os.path.exists(search_dir):
                for root, dirs, files in os.walk(search_dir):
                    env_count += files.count('.env')
        
        # Get container metadata count
        container_metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        metadata_count = len([name for name, meta in container_metadata.items() 
                            if meta.get('tags') or meta.get('custom_url')])
        
        return jsonify({
            'status': 'success',
            'preview': {
                'containers': container_count,
                'compose_files': compose_count,
                'env_files': env_count,
                'container_metadata': metadata_count,
                'estimated_size': 'Small (< 1MB)'  # These are just config files
            }
        })
    
    except Exception as e:
        logger.error(f"Failed to preview backup: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Basic API endpoints for host bookmarks
@app.route('/api/docker/hosts')
def get_docker_hosts():
    hosts = load_hosts()
    return jsonify({'hosts': hosts, 'current': 'local'})

@app.route('/api/docker/hosts/add', methods=['POST'])
def add_docker_host():
    try:
        data = request.json
        name = data.get('name')
        url = data.get('url')
        
        if not name or not url:
            return jsonify({'status': 'error', 'message': 'Name and URL are required'})
        
        hosts = load_hosts()
        hosts[name] = {'url': url, 'connected': False}
        save_hosts(hosts)
        
        return jsonify({'status': 'success', 'message': f'Added host {name}'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/docker/hosts/remove', methods=['POST'])
def remove_docker_host():
    try:
        data = request.json
        name = data.get('name')
        
        if name == 'local':
            return jsonify({'status': 'error', 'message': 'Cannot remove local host'})
        
        hosts = load_hosts()
        if name in hosts:
            del hosts[name]
            save_hosts(hosts)
        
        return jsonify({'status': 'success', 'message': f'Removed host {name}'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/docker/switch-host', methods=['POST'])
def switch_docker_host():
    data = request.json
    new_host = data.get('host')
    
    try:
        global client
        client = host_manager.switch_host(new_host)
        return jsonify({
            'status': 'success',
            'message': f'Switched to {new_host}'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        })


# ADD THIS ENTIRE NEW ENDPOINT
@app.route('/api/containers/all')
def get_all_containers():
    """Get containers from all connected hosts"""
    all_containers = []
    
    try:
        # Get hosts status
        hosts_status = host_manager.get_hosts_status()
        
        # Iterate through each connected host
        for host_name, status in hosts_status.items():
            if status['connected']:
                # Get containers from this host
                client = host_manager.get_client(host_name)
                if client:
                    try:
                        containers = []
                        for container in client.containers.list(all=True):
                            # Build container data similar to regular endpoint
                            labels = container.labels
                            compose_project = labels.get('com.docker.compose.project', None)
                            compose_file = None
                            config_files = labels.get('com.docker.compose.project.config_files', None)
                            if config_files:
                                file_path = config_files.split(',')[0]
                                compose_file = os.path.basename(file_path)
                            
                            container_data = {
                                'id': container.short_id,
                                'name': container.name,
                                'status': container.status,
                                'image': container.image.tags[0] if container.image.tags else 'unknown',
                                'compose_project': compose_project,
                                'compose_file': compose_file,
                                'uptime': calculate_uptime(container.attrs['State'].get('StartedAt', ''), logger),
                                'cpu_percent': 0,
                                'memory_usage': 0,
                                'tags': [],
                                'host': host_name
                            }
                            all_containers.append(container_data)
                    except Exception as e:
                        logger.error(f"Failed to get containers from host {host_name}: {e}")
                        
        return jsonify(all_containers)
        
    except Exception as e:
        logger.error(f"Failed to get containers from all hosts: {e}")
        return jsonify({'error': str(e)}), 500
    
# Container routes
@app.route('/api/containers')
def get_containers():
    """Get containers with host information"""
    # ADD THIS: Check for specific host parameter
    host_param = request.args.get('host')
    
    # MODIFY: Get client for specified host or current host
    if host_param:
        client = host_manager.get_client(host_param)
        current_host = host_param
    else:
        client = host_manager.get_client()
        current_host = host_manager.current_host
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
                    'tags': container_tags,
                    'host': current_host  # Add host information
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
    
@app.route('/api/container/<id>/exec', methods=['POST'])
def exec_in_container(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    try:
        data = request.json
        if not data or 'command' not in data:
            return jsonify({'status': 'error', 'message': 'No command provided'})
        
        command = data['command']
        container = client.containers.get(id)
        
        logger.info(f"Executing command in container {id}: {command}")
        
        # Execute the command
        exec_result = container.exec_run(
            cmd=["sh", "-c", command],
            stdout=True,
            stderr=True,
            demux=False  # Combine stdout and stderr
        )
        
        exit_code = exec_result.exit_code
        output = exec_result.output.decode('utf-8', errors='replace')
        
        if exit_code != 0:
            logger.warning(f"Command exited with code {exit_code}: {output}")
            return jsonify({
                'status': 'error',
                'message': f'Command exited with code {exit_code}',
                'output': output
            })
        
        return jsonify({
            'status': 'success',
            'output': output
        })
    except Exception as e:
        logger.error(f"Failed to execute command in container {id}: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)})
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
                        ["docker-compose", "-f", compose_file, valid_actions[action], service],
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
                        ["docker-compose", "-f", compose_file, "rm", "-sf", service],
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
                        ["docker-compose", "-f", compose_file, "pull", service],
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
                        ["docker-compose", "-f", compose_file, "up", "-d", "--force-recreate", service],
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
            environment=container.attrs.get('Config', {}).get('Env', []),
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
        
        # Extract project name and service name from labels
        labels = container.labels
        project = labels.get('com.docker.compose.project', '')
        service = labels.get('com.docker.compose.service', '')
        
        logger.debug(f"Looking for compose file for project: {project}, service: {service}")
        
        # Check if project exists as a directory in COMPOSE_DIR
        project_dir = os.path.join(COMPOSE_DIR, project)
        
        # List of common compose filenames
        compose_filenames = ['docker-compose.yaml', 'docker-compose.yml', 'compose.yaml', 'compose.yml']
        
        # Try to find compose file in project directory
        if os.path.isdir(project_dir):
            logger.debug(f"Found project directory: {project_dir}")
            
            for filename in compose_filenames:
                file_path = os.path.join(project_dir, filename)
                if os.path.exists(file_path):
                    logger.debug(f"Found compose file: {file_path}")
                    
                    with open(file_path, 'r') as f:
                        content = f.read()
                    
                    relative_path = os.path.join(project, filename)
                    return jsonify({
                        'status': 'success',
                        'content': content,
                        'file': relative_path
                    })
        
        # If that doesn't work, try all directories
        for dir_name in os.listdir(COMPOSE_DIR):
            dir_path = os.path.join(COMPOSE_DIR, dir_name)
            if not os.path.isdir(dir_path):
                continue
                
            for filename in compose_filenames:
                file_path = os.path.join(dir_path, filename)
                if os.path.exists(file_path):
                    logger.debug(f"Checking compose file: {file_path}")
                    
                    # Check if this compose file contains the service
                    try:
                        with open(file_path, 'r') as f:
                            import yaml
                            try:
                                compose_data = yaml.safe_load(f)
                                if (compose_data and 'services' in compose_data and
                                    service in compose_data['services']):
                                    logger.debug(f"Found matching service in: {file_path}")
                                    
                                    with open(file_path, 'r') as f2:
                                        content = f2.read()
                                    
                                    relative_path = os.path.join(dir_name, filename)
                                    return jsonify({
                                        'status': 'success',
                                        'content': content,
                                        'file': relative_path
                                    })
                            except yaml.YAMLError:
                                pass
                    except Exception as e:
                        logger.debug(f"Error checking compose file: {e}")
        
        # If still not found, return error
        logger.error(f"No matching compose file found for container {id}, project {project}, service {service}")
        return jsonify({
            'status': 'error',
            'message': f'Compose file for {project}/{service} not found.'
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

# In app.py, update the scan_compose_files_endpoint
@app.route('/api/compose/scan')
def scan_compose_files_endpoint():
    try:
        # Original code for scanning
        files = scan_all_compose_files(COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        
        # Add this new section to also scan for relative paths with ../
        # This will find compose files in sibling directories of your COMPOSE_DIR
        parent_dir = os.path.dirname(COMPOSE_DIR)
        if os.path.exists(parent_dir):
            logger.info(f"Scanning parent directory: {parent_dir}")
            for item in os.listdir(parent_dir):
                item_path = os.path.join(parent_dir, item)
                if os.path.isdir(item_path) and item_path != COMPOSE_DIR:  # Skip the compose dir itself
                    # This is a sibling directory to compose_dir (like immich, media-server, etc.)
                    sibling_dir = item
                    sibling_path = os.path.join(parent_dir, sibling_dir)
                    logger.debug(f"Checking sibling directory: {sibling_dir}")
                    
                    # Look for compose files in this sibling directory
                    for root, dirs, file_list in os.walk(sibling_path):
                        for file in file_list:
                            if file.lower() in ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']:
                                # Create a relative path with ../
                                rel_from_root = os.path.relpath(os.path.join(root, file), parent_dir)
                                rel_path = f"../{rel_from_root}"
                                if rel_path not in files:
                                    files.append(rel_path)
                                    logger.info(f"Found relative compose file: {rel_path}")
        
        # Return the files as before
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
                    ["docker-compose", "-f", compose_filename, "pull"],
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
                ["docker-compose", "-f", compose_filename, "down"],
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
                ["docker-compose", "-f", compose_filename, "up", "-d"],
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
    




@app.route('/api/docker/hosts/test', methods=['POST'])
def test_docker_host():
    """Test connection to a Docker host"""
    try:
        data = request.json
        url = data.get('url')
        
        if not url:
            return jsonify({'status': 'error', 'message': 'URL is required'})
        
        # Try to connect
        test_client = docker.DockerClient(base_url=url, timeout=5)
        test_client.ping()
        
        return jsonify({
            'status': 'success',
            'message': 'Connection successful'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Connection failed: {str(e)}'
        })
    
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
# Volume management routes
@app.route('/api/volumes')
def get_volumes():
    if client is None:
        logger.error("Docker client not initialized")
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        volumes = []
        for volume in client.volumes.list():
            volume_data = volume.attrs
            
            # Check which containers are using this volume
            containers_using = []
            for container in client.containers.list(all=True):
                mounts = container.attrs.get('Mounts', [])
                for mount in mounts:
                    if mount.get('Name') == volume.name:
                        containers_using.append(container.name)
                        break
            
            volumes.append({
                'name': volume.name,
                'driver': volume_data.get('Driver', 'unknown'),
                'created': volume_data.get('CreatedAt', 'unknown'),
                'mountpoint': volume_data.get('Mountpoint', ''),
                'scope': volume_data.get('Scope', 'local'),
                'labels': volume_data.get('Labels', {}),
                'in_use': len(containers_using) > 0,
                'containers': containers_using
            })
        
        logger.debug(f"Returning {len(volumes)} volumes")
        return jsonify(volumes)
    
    except Exception as e:
        logger.error(f"Failed to list volumes: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to list volumes: {str(e)}'})

@app.route('/api/volumes/<name>/inspect')
def inspect_volume(name):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        volume = client.volumes.get(name)
        return jsonify({
            'status': 'success',
            'data': volume.attrs
        })
    except Exception as e:
        logger.error(f"Failed to inspect volume {name}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/volumes/<name>/remove', methods=['POST'])
def remove_volume(name):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        volume = client.volumes.get(name)
        volume.remove()
        return jsonify({
            'status': 'success',
            'message': f'Volume {name} removed successfully'
        })
    except Exception as e:
        logger.error(f"Failed to remove volume {name}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/volumes/create', methods=['POST'])
def create_volume():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        data = request.json
        if not data or 'name' not in data:
            return jsonify({'status': 'error', 'message': 'Volume name required'})
        
        volume = client.volumes.create(
            name=data['name'],
            driver=data.get('driver', 'local'),
            labels=data.get('labels', {})
        )
        
        return jsonify({
            'status': 'success',
            'message': f'Volume {data["name"]} created successfully',
            'volume': volume.attrs
        })
    except Exception as e:
        logger.error(f"Failed to create volume: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/volumes/prune', methods=['POST'])
def prune_volumes():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        result = client.volumes.prune()
        return jsonify({
            'status': 'success',
            'message': f'Pruned {len(result.get("VolumesDeleted", []))} volumes, reclaimed {result.get("SpaceReclaimed", 0)} bytes'
        })
    except Exception as e:
        logger.error(f"Failed to prune volumes: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Network management routes
@app.route('/api/networks')
def get_networks():
    if client is None:
        logger.error("Docker client not initialized")
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        networks = []
        for network in client.networks.list():
            network_data = network.attrs
            
            # Get containers in this network
            containers_in_network = []
            for container_id, container_info in network_data.get('Containers', {}).items():
                containers_in_network.append(container_info.get('Name', 'unknown'))
            
            # Get subnet if available
            ipam_config = network_data.get('IPAM', {}).get('Config', [])
            subnet = ipam_config[0].get('Subnet', 'N/A') if ipam_config else 'N/A'
            
            networks.append({
                'id': network.short_id,
                'name': network.name,
                'driver': network_data.get('Driver', 'unknown'),
                'scope': network_data.get('Scope', 'local'),
                'internal': network_data.get('Internal', False),
                'external': network_data.get('External', False),
                'attachable': network_data.get('Attachable', False),
                'created': network_data.get('Created', 'unknown'),
                'subnet': subnet,
                'containers': containers_in_network,
                'labels': network_data.get('Labels', {})
            })
        
        logger.debug(f"Returning {len(networks)} networks")
        return jsonify(networks)
    
    except Exception as e:
        logger.error(f"Failed to list networks: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to list networks: {str(e)}'})
    
@app.route('/api/networks/<id>/inspect')
def inspect_network(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        network = client.networks.get(id)
        return jsonify({
            'status': 'success',
            'data': network.attrs
        })
    except Exception as e:
        logger.error(f"Failed to inspect network {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/networks/<id>/remove', methods=['POST'])
def remove_network(id):
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        network = client.networks.get(id)
        network.remove()
        return jsonify({
            'status': 'success',
            'message': f'Network {network.name} removed successfully'
        })
    except Exception as e:
        logger.error(f"Failed to remove network {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/networks/create', methods=['POST'])
def create_network():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        data = request.json
        if not data or 'name' not in data:
            return jsonify({'status': 'error', 'message': 'Network name required'})
        
        network = client.networks.create(
            name=data['name'],
            driver=data.get('driver', 'bridge'),
            attachable=data.get('attachable', False),
            internal=data.get('internal', False),
            labels=data.get('labels', {})
        )
        
        return jsonify({
            'status': 'success',
            'message': f'Network {data["name"]} created successfully',
            'network': network.attrs
        })
    except Exception as e:
        logger.error(f"Failed to create network: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/networks/prune', methods=['POST'])
def prune_networks():
    if client is None:
        return jsonify({'status': 'error', 'message': 'Docker service unavailable'})
    
    try:
        result = client.networks.prune()
        return jsonify({
            'status': 'success',
            'message': f'Pruned {len(result.get("NetworksDeleted", []))} networks'
        })
    except Exception as e:
        logger.error(f"Failed to prune networks: {e}")
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
            cmd = ["docker-compose", "-f", compose_file]
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
# Add near your other API endpoints in app.py

@app.route('/api/compose/templates')
def get_compose_templates():
    """Get available templates for new projects"""
    # For now, we'll return a simple generic template
    generic_template = {
        "name": "Generic",
        "description": "A basic template with one service",
        "compose": """version: '3.8'

services:
  app:
    image: ${IMAGE}  # Example: nginx:latest
    container_name: ${PROJECT_NAME}_app
    ports:
      - "${PORT}:80"  # Example: 8080:80
    volumes:
      - ./data:/app/data
    env_file:
      - .env  # Will use the .env file in the same directory
    environment:
      # Additional environment variables can be defined here
      - ADDITIONAL_VAR=value
    restart: unless-stopped

volumes:
  data:
    # Optional volume configuration

networks:
  default:
    # Optional network configuration
"""
    }
    
    # Environment variables template
    env_template = """# Docker image to use
IMAGE=nginx:latest

# External port to expose
PORT=8080

# Other environment variables
ADDITIONAL_VAR=value
"""
    
    templates = [
        {
            "id": "generic",
            "name": "Generic Service",
            "description": "A basic template with one service",
            "compose_content": generic_template["compose"],
            "env_content": env_template
        }
    ]
    
    return jsonify({'status': 'success', 'templates': templates})
@app.route('/api/compose/extract-env-from-content', methods=['POST'])
def extract_env_from_content():
    """Extract environment variables from compose file content"""
    try:
        data = request.json
        if not data or 'content' not in data:
            return jsonify({'status': 'error', 'message': 'No compose content provided'})
       
        compose_content = data['content']
       
        # Write to a temporary file
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yml', delete=False) as tmp:
            tmp.write(compose_content)
            temp_file = tmp.name
       
        try:
            # Use the existing extract function - FIXED LINE
            env_content, _ = extract_env_from_compose(temp_file, False, logger)
           
            # Clean up temp file
            os.unlink(temp_file)
           
            if not env_content:
                return jsonify({'status': 'error', 'message': 'Failed to extract environment variables'})
           
            return jsonify({
                'status': 'success',
                'content': env_content
            })
        except Exception as e:
            # Make sure to clean up the temp file even if there's an error
            try:
                os.unlink(temp_file)
            except:
                pass
            raise e
    except Exception as e:
        logger.error(f"Failed to extract environment variables: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
def extract_env_from_compose(compose_file_path, modify_compose=False, logger=None):
    """Extract environment variables from a docker-compose file"""
    try:
        import yaml
        
        with open(compose_file_path, 'r') as f:
            compose_data = yaml.safe_load(f)
        
        if not compose_data or 'services' not in compose_data:
            return None, False
        
        env_vars = []
        compose_modified = False
        
        # Add header
        from datetime import datetime
        env_vars.append("# Auto-generated .env file from compose")
        env_vars.append(f"# Created: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        env_vars.append("")
        
        # Process each service
        for service_name, service_config in compose_data['services'].items():
            if not isinstance(service_config, dict):
                continue
                
            env_vars.append(f"# Variables for {service_name} service")
            
            # Extract image
            if 'image' in service_config:
                image = service_config['image']
                var_name = f"{service_name.upper()}_IMAGE"
                env_vars.append(f"{var_name}={image}")
                
                if modify_compose:
                    service_config['image'] = f"${{{var_name}}}"
                    compose_modified = True
            
            # Extract ports
            if 'ports' in service_config:
                ports = service_config['ports']
                if isinstance(ports, list) and ports:
                    for i, port in enumerate(ports):
                        if ':' in str(port):
                            external_port = str(port).split(':')[0].strip('"\'')
                            var_name = f"{service_name.upper()}_PORT"
                            if i > 0:
                                var_name += f"_{i+1}"
                            env_vars.append(f"{var_name}={external_port}")
                            
                            if modify_compose:
                                internal_port = str(port).split(':')[1].strip('"\'')
                                ports[i] = f"${{{var_name}}}:{internal_port}"
                                compose_modified = True
            
            # Extract existing environment variables
            if 'environment' in service_config:
                env_list = service_config['environment']
                if isinstance(env_list, list):
                    for env_item in env_list:
                        if '=' in str(env_item):
                            env_vars.append(str(env_item))
                elif isinstance(env_list, dict):
                    for key, value in env_list.items():
                        env_vars.append(f"{key}={value}")
            
            env_vars.append("")  # Empty line between services
        
        # Save modified compose file if requested
        if modify_compose and compose_modified:
            with open(compose_file_path, 'w') as f:
                yaml.dump(compose_data, f, default_flow_style=False)
        
        return '\n'.join(env_vars), compose_modified
        
    except Exception as e:
        if logger:
            logger.error(f"Error extracting env vars: {e}")
        return None, False
    

    
@app.route('/api/compose/available-locations')
def get_available_locations():
    """Get available locations for new projects"""
    try:
        locations = []
        
        # Add COMPOSE_DIR
        compose_dir_name = os.path.basename(COMPOSE_DIR)
        locations.append({
            'path': 'default',
            'container_path': COMPOSE_DIR,
            'display_name': f'Main directory ({compose_dir_name})'
        })
        
        # FIX: Handle EXTRA_COMPOSE_DIRS properly
        extra_dirs = EXTRA_COMPOSE_DIRS
        if isinstance(extra_dirs, str):
            extra_dirs = extra_dirs.split(':') if extra_dirs else []
        
        for i, dir_path in enumerate(extra_dirs):
            if dir_path and os.path.exists(dir_path):
                dir_name = os.path.basename(dir_path)
                locations.append({
                    'path': f'extra_{i}',
                    'container_path': dir_path,
                    'display_name': f'Projects directory ({dir_name})'
                })
        
        return jsonify({
            'status': 'success',
            'locations': locations
        })
    except Exception as e:
        logger.error(f"Failed to get available locations: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
       
@app.route('/api/compose/create', methods=['POST'])
def create_compose_project():
    print("DEBUG: /api/compose/create endpoint hit!")
    print(f"DEBUG: Request method: {request.method}")
    print(f"DEBUG: Request data: {request.json}")
    
    try:
        data = request.json
        if not data or 'project_name' not in data:
            return jsonify({'status': 'error', 'message': 'Project name is required'})
            
        project_name = data['project_name']
        location_type = data.get('location_type', 'default')
        
        # Validate project name (no special characters except underscore and hyphen)
        if not re.match(r'^[a-zA-Z0-9_-]+$', project_name):
            return jsonify({
                'status': 'error',
                'message': 'Project name can only contain letters, numbers, underscores and hyphens'
            })
        
        # FIX: Determine project directory based on location_type
        if location_type == 'default':
            project_dir = os.path.join(COMPOSE_DIR, project_name)
        elif location_type.startswith('extra_'):
            # Extract index from extra_N
            try:
                extra_index = int(location_type.split('_')[1])
                # FIX: Convert EXTRA_COMPOSE_DIRS to list if it's a string
                extra_dirs = EXTRA_COMPOSE_DIRS
                if isinstance(extra_dirs, str):
                    extra_dirs = extra_dirs.split(':') if extra_dirs else []
                
                if 0 <= extra_index < len(extra_dirs) and extra_dirs[extra_index]:
                    extra_dir = extra_dirs[extra_index]
                    project_dir = os.path.join(extra_dir, project_name)
                    print(f"DEBUG: Using extra directory: {extra_dir}")
                    print(f"DEBUG: Project directory will be: {project_dir}")
                else:
                    return jsonify({
                        'status': 'error',
                        'message': f'Invalid project location index: {extra_index}'
                    })
            except (ValueError, IndexError) as e:
                print(f"DEBUG: Error parsing location_type: {e}")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid location format'
                })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Invalid project location'
            })
        
        print(f"DEBUG: Final project directory: {project_dir}")
        
        # Check if directory already exists
        if os.path.exists(project_dir):
            return jsonify({
                'status': 'error',
                'message': f'Project directory {project_dir} already exists'
            })
            
        # Create project directory
        os.makedirs(project_dir, exist_ok=True)
        print(f"DEBUG: Created directory: {project_dir}")
        
        # Create docker-compose.yml file
        compose_content = data.get('compose_content', '')
        compose_file_path = os.path.join(project_dir, 'docker-compose.yml')
        with open(compose_file_path, 'w') as f:
            f.write(compose_content)
        print(f"DEBUG: Created compose file: {compose_file_path}")
            
        # FIX: Create .env file if requested - check the correct fields
        create_env_file = data.get('create_env_file', False)
        env_content = data.get('env_content', '')
        
        print(f"DEBUG: create_env_file = {create_env_file}")
        print(f"DEBUG: env_content length = {len(env_content) if env_content else 0}")
        
        if create_env_file and env_content:
            env_file_path = os.path.join(project_dir, '.env')
            with open(env_file_path, 'w') as f:
                f.write(env_content)
            print(f"DEBUG: Created .env file: {env_file_path}")
        elif create_env_file:
            print("DEBUG: create_env_file is True but no env_content provided")
                
        logger.info(f"Created new project: {project_name} in {project_dir}")
        
        return jsonify({
            'status': 'success',
            'message': f'Project {project_name} created successfully in {project_dir}',
            'project': {
                'name': project_name,
                'path': project_dir,
                'compose_file': os.path.join(project_name, 'docker-compose.yml') 
            }
        })
    except Exception as e:
        logger.error(f"Failed to create project: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Failed to create project: {str(e)}'})
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=False)