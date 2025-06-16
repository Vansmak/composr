from flask import Flask, render_template, jsonify, request, send_file
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
import docker  # Make sure this is imported

# Import helper functions
from functions import (
    initialize_docker_client, load_container_metadata, save_container_metadata, 
    get_compose_files, scan_all_compose_files, resolve_compose_file_path,
    extract_env_from_compose, calculate_uptime, find_caddy_container, get_compose_files_cached
)

# Import your existing host manager
from remote_hosts import host_manager

# Add after imports
__version__ = "1.7.0"

# Initialize Flask app
app = Flask(__name__)

# Configuration - MOVED BEFORE LOGGING
COMPOSE_DIR = os.getenv('COMPOSE_DIR', '/app/projects')
EXTRA_COMPOSE_DIRS = os.getenv('EXTRA_COMPOSE_DIRS', '').split(':')
METADATA_DIR = os.environ.get('METADATA_DIR', '/app')
CONTAINER_METADATA_FILE = os.path.join(METADATA_DIR, 'container_metadata.json')
CADDY_CONFIG_DIR = os.getenv('CADDY_CONFIG_DIR', '')
CADDY_CONFIG_FILE = os.getenv('CADDY_CONFIG_FILE', 'Caddyfile')

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

# Your host_manager is already initialized in remote_hosts.py, just wait for it to be ready
start_time = time.time()
while host_manager.get_client('local') is None and time.time() - start_time < 5:
    time.sleep(0.1)

# Caching variables
_system_stats_cache = {}
_system_stats_timestamp = 0
_container_cache = {}
_cache_timestamp = 0
_cache_lock = threading.Lock()
CACHE_TTL = 10  # seconds

# Initialize Docker client (this gets the current/local client)
client = host_manager.get_client()

logger.info(f"Composr initialized with client: {'available' if client else 'unavailable'}")
logger.info(f"Connected hosts: {list(host_manager.get_connected_hosts())}")

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
##new
@app.route('/api/hosts')
def get_hosts():
    """Get all configured hosts with their status"""
    try:
        hosts_status = host_manager.get_hosts_status()
        current_host = host_manager.current_host
        
        return jsonify({
            'status': 'success',
            'hosts': hosts_status,
            'current_host': current_host
        })
    except Exception as e:
        logger.error(f"Failed to get hosts: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/hosts/add', methods=['POST'])
def add_docker_host():
    """Add a new Docker host"""
    try:
        data = request.json
        name = data.get('name')
        url = data.get('url')
        description = data.get('description', '')
        
        if not name or not url:
            return jsonify({'status': 'error', 'message': 'Name and URL are required'})
        
        # Validate URL format for Docker
        if not url.startswith('tcp://'):
            return jsonify({'status': 'error', 'message': 'URL must start with tcp:// (e.g., tcp://192.168.1.100:2375)'})
        
        # Add host using your HostManager
        success, message = host_manager.add_host(name, url, description)
        
        if success:
            return jsonify({
                'status': 'success', 
                'message': message
            })
        else:
            return jsonify({
                'status': 'error', 
                'message': message
            })
            
    except Exception as e:
        logger.error(f"Failed to add Docker host: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/hosts/remove', methods=['POST'])
def remove_docker_host():
    """Remove a Docker host"""
    try:
        data = request.json
        name = data.get('name')
        
        if not name:
            return jsonify({'status': 'error', 'message': 'Host name is required'})
        
        # Remove host using your HostManager
        success, message = host_manager.remove_host(name)
        
        if success:
            return jsonify({
                'status': 'success', 
                'message': message
            })
        else:
            return jsonify({
                'status': 'error', 
                'message': message
            })
            
    except Exception as e:
        logger.error(f"Failed to remove Docker host: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/hosts/test', methods=['POST'])
def test_docker_host():
    """Test connection to a Docker host"""
    try:
        data = request.json
        url = data.get('url')
        
        if not url:
            return jsonify({'status': 'error', 'message': 'URL is required'})
        
        # Test connection using your HostManager
        success = host_manager.test_host_connection(url)
        
        if success:
            return jsonify({
                'status': 'success',
                'message': 'Connection successful'
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Connection failed'
            })
            
    except Exception as e:
        logger.error(f"Failed to test Docker host: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/hosts/switch', methods=['POST'])
def switch_docker_host():
    """Switch to a different Docker host"""
    try:
        data = request.json
        host = data.get('host')
        
        if not host:
            return jsonify({'status': 'error', 'message': 'Host name is required'})
        
        # Switch to the specified host using your HostManager
        global client
        client = host_manager.switch_host(host)
        
        return jsonify({
            'status': 'success',
            'message': f'Successfully switched to {host}'
        })
            
    except Exception as e:
        logger.error(f"Failed to switch Docker host: {e}")
        return jsonify({'status': 'error', 'message': str(e)})
##end new


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
# 1. Update the main containers endpoint to always show all hosts
@app.route('/api/containers')
def get_containers():
    """Get containers from all connected hosts - unified view"""
    try:
        search = request.args.get('search', '').lower()
        status = request.args.get('status', '')
        sort_by = request.args.get('sort', 'name')
        tag_filter = request.args.get('tag', '')
        stack_filter = request.args.get('stack', '')
        host_filter = request.args.get('host', '')  # Add host filter

        all_containers = []
        hosts_status = host_manager.get_hosts_status()
        container_metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)

        # Iterate through ALL connected hosts
        for host_name, status_info in hosts_status.items():
            if status_info['connected']:
                client = host_manager.get_client(host_name)
                if client:
                    try:
                        host_containers = client.containers.list(all=True)
                        logger.debug(f"Processing {len(host_containers)} containers from host {host_name}")
                        
                        for container in host_containers:
                            labels = container.labels or {}
                            compose_project = labels.get('com.docker.compose.project', None)
                            compose_file = None
                            config_files = labels.get('com.docker.compose.project.config_files', None)
                            
                            if config_files:
                                file_path = config_files.split(',')[0]
                                compose_file = os.path.basename(file_path)
                            
                            container_name = container.name
                            # Use host-prefixed key for metadata lookup
                            metadata_key = f"{host_name}:{container_name}" if host_name != 'local' else container_name
                            container_meta = container_metadata.get(metadata_key, {})
                            
                            # Extract ports properly
                            ports = {}
                            try:
                                port_bindings = container.attrs.get('HostConfig', {}).get('PortBindings')
                                if port_bindings:
                                    for container_port, host_config in port_bindings.items():
                                        if host_config and len(host_config) > 0:
                                            host_port = host_config[0].get('HostPort')
                                            if host_port:
                                                ports[host_port] = container_port
                            except Exception as e:
                                logger.warning(f"Failed to extract ports for {host_name}:{container_name}: {e}")
                            
                            container_data = {
                                'id': container.short_id,
                                'name': container_name,
                                'status': container.status,
                                'image': container.image.tags[0] if container.image.tags else 'unknown',
                                'compose_project': compose_project,
                                'compose_file': compose_file,
                                'uptime': calculate_uptime(container.attrs['State'].get('StartedAt', ''), logger),
                                'cpu_percent': 0,
                                'memory_usage': 0,
                                'tags': container_meta.get('tags', []),
                                'custom_url': container_meta.get('custom_url', ''),
                                'host': host_name,
                                'host_display': status_info.get('name', host_name),
                                'ports': ports
                            }
                            all_containers.append(container_data)
                            
                    except Exception as e:
                        logger.error(f"Failed to get containers from host {host_name}: {e}")

        # Apply filters
        filtered_containers = []
        for container in all_containers:
            # Search filter
            if search and not (
                search in container['name'].lower() or
                search in (container['image'] or '').lower() or
                search in (container['compose_file'] or '').lower() or
                any(search in tag.lower() for tag in container.get('tags', []))
            ):
                continue
            
            # Status filter
            if status and container['status'] != status:
                continue
            
            # Tag filter
            if tag_filter and tag_filter not in container.get('tags', []):
                continue
                
            # Stack filter
            if stack_filter:
                stack_name = extract_stack_name(container)
                if stack_name != stack_filter:
                    continue
            
            # Host filter
            if host_filter and container['host'] != host_filter:
                continue
                
            filtered_containers.append(container)

        # Sort containers
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
        elif sort_by == 'host':
            filtered_containers.sort(key=lambda x: (x.get('host', 'local'), x['name'].lower()))

        return jsonify(filtered_containers)

    except Exception as e:
        logger.error(f"Failed to list containers from all hosts: {e}")
        return jsonify([])

# Helper function to extract stack name (add to your functions.py)
def extract_stack_name(container):
    """Extract stack name from container metadata"""
    try:
        # Use compose_project if available
        if container.get('compose_project') and container['compose_project'].strip():
            return container['compose_project']

        # Use compose_file directory as the stack name
        if container.get('compose_file'):
            path_parts = container['compose_file'].split('/').filter(lambda p: len(p) > 0)
            system_dirs = ['home', 'var', 'opt', 'usr', 'etc', 'mnt', 'srv', 'data', 'app', 'docker']
            
            for part in path_parts:
                if part.lower() not in system_dirs:
                    return part
            
            if path_parts:
                return path_parts[-2] if len(path_parts) > 1 else path_parts[0]

        # Fallback to container name
        return container.get('name', 'Unknown')
    except Exception:
        return 'Unknown'

# Fix the container exec endpoint
@app.route('/api/container/<id>/exec', methods=['POST'])
def exec_in_container(id):
    try:
        data = request.json
        if not data or 'command' not in data:
            return jsonify({'status': 'error', 'message': 'No command provided'})
        
        # Get host from request data
        host = data.get('host', 'local')
        
        # Get the appropriate client for this host
        client = host_manager.get_client(host)
        if not client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        command = data['command']
        container = client.containers.get(id)
        
        logger.info(f"Executing command in container {id} on host {host}: {command}")
        
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


# Fix the container settings endpoints
@app.route('/api/container/<id>/get_tags')
def get_container_tags(id):
    """Get tags for a specific container"""
    try:
        # Get host from query parameter
        host = request.args.get('host', 'local')
        
        # Get the appropriate client for this host
        client = host_manager.get_client(host)
        if not client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = client.containers.get(id)
        container_name = container.name
        
        # Use host-prefixed key for metadata lookup
        metadata_key = f"{host}:{container_name}" if host != 'local' else container_name
        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        container_data = metadata.get(metadata_key, {})
        
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
        # Get host from query parameter
        host = request.args.get('host', 'local')
        
        # Get the appropriate client for this host
        client = host_manager.get_client(host)
        if not client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = client.containers.get(id)
        container_name = container.name
        
        # Use host-prefixed key for metadata lookup
        metadata_key = f"{host}:{container_name}" if host != 'local' else container_name
        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        container_data = metadata.get(metadata_key, {})
        
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
        
        # Get host from request data
        host = data.get('host', 'local')
        
        # Get the appropriate client for this host
        client = host_manager.get_client(host)
        if not client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = client.containers.get(id)
        container_name = container.name
        
        # Use host-prefixed key for metadata storage
        metadata_key = f"{host}:{container_name}" if host != 'local' else container_name
        metadata = load_container_metadata(CONTAINER_METADATA_FILE, logger)
        
        # Initialize container metadata if not exists
        if metadata_key not in metadata:
            metadata[metadata_key] = {}
        
        # Update tags
        if 'tags' in data:
            metadata[metadata_key]['tags'] = data['tags']
        
        # Update custom URL
        if 'custom_url' in data:
            metadata[metadata_key]['custom_url'] = data['custom_url']
        
        # Save metadata
        if save_container_metadata(metadata, CONTAINER_METADATA_FILE, logger):
            return jsonify({'status': 'success', 'message': 'Settings saved successfully'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save settings'})
    except Exception as e:
        logger.error(f"Failed to save container settings: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Fix the container logs endpoint
@app.route('/api/container/<id>/logs')
def get_container_logs(id):
    try:
        # Get host from query parameter
        host = request.args.get('host', 'local')
        
        # Get the appropriate client for this host
        client = host_manager.get_client(host)
        if not client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = client.containers.get(id)
        logs = container.logs(tail=100).decode('utf-8')
        return jsonify({'status': 'success', 'logs': logs})
    except Exception as e:
        logger.error(f"Failed to get logs for container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})


# Fix the container inspect endpoint
@app.route('/api/container/<id>/inspect')
def inspect_container(id):
    try:
        # Get host from query parameter
        host = request.args.get('host', 'local')
        
        # Get the appropriate client for this host
        client = host_manager.get_client(host)
        if not client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = client.containers.get(id)
        inspect_data = container.attrs
        return jsonify({'status': 'success', 'data': inspect_data})
    except Exception as e:
        logger.error(f"Failed to inspect container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})


# Fix the container action endpoint in app.py
@app.route('/api/container/<id>/<action>', methods=['POST'])
def container_action_multihost(id, action):
    """Container actions with automatic host detection"""
    try:
        data = request.json or {}
        host = data.get('host', 'local')
        
        # Get the appropriate client for this host - USE DIFFERENT VARIABLE NAME
        host_client = host_manager.get_client(host)
        if not host_client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = host_client.containers.get(id) 
        
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
                
                # CRITICAL FIX: Set DOCKER_HOST for the subprocess
                if host != 'local':
                    host_config = host_manager.get_hosts_status().get(host, {})
                    docker_url = host_config.get('url', '')
                    if docker_url:
                        env['DOCKER_HOST'] = docker_url
                        logger.info(f"Setting DOCKER_HOST={docker_url} for compose action on {host}")
                
                valid_actions = {'start': 'start', 'stop': 'stop', 'restart': 'restart'}
                if action not in valid_actions:
                    return jsonify({'status': 'error', 'message': 'Invalid action'})
                
                try:
                    logger.info(f"Using docker-compose to {action} container {container.name} on host {host}")
                    result = subprocess.run(
                        ["docker-compose", "-f", compose_file, valid_actions[action], service],
                        check=True,
                        cwd=compose_dir,
                        env=env,
                        text=True,
                        capture_output=True
                    )
                    return jsonify({'status': 'success', 'message': f'Container {action}ed via docker-compose on {host}'})
                except subprocess.CalledProcessError as e:
                    return jsonify({'status': 'error', 'message': f'Failed to {action} container: {e.stderr}'})
        
        if action == 'start':
            container.start()  # This works because container came from host_client
        elif action == 'stop':
            container.stop()
        elif action == 'restart':
            container.restart()
        else:
            return jsonify({'status': 'error', 'message': 'Invalid action'})
        
        return jsonify({'status': 'success', 'message': f'Container {action}ed on {host}'})
        
    except Exception as e:
        logger.error(f"Failed to perform action {action} on container {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})



@app.route('/api/container/<id>/remove', methods=['POST'])
def remove_container(id):
    try:
        data = request.json or {}
        host = data.get('host', 'local')
        
        # Get the appropriate client for this host
        host_client = host_manager.get_client(host)
        if not host_client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = host_client.containers.get(id)
        
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
                
                # CRITICAL: Set DOCKER_HOST for the subprocess
                if host != 'local':
                    host_config = host_manager.get_hosts_status().get(host, {})
                    docker_url = host_config.get('url', '')
                    if docker_url:
                        env['DOCKER_HOST'] = docker_url
                        logger.info(f"Setting DOCKER_HOST={docker_url} for compose remove on {host}")
                
                try:
                    logger.info(f"Using docker-compose to remove container {container.name} (service: {service}) on {host}")
                    result = subprocess.run(
                        ["docker-compose", "-f", compose_file, "rm", "-sf", service],
                        check=True,
                        cwd=compose_dir,
                        env=env,
                        text=True,
                        capture_output=True
                    )
                    logger.info(f"Docker Compose remove completed: {result.stdout}")
                    return jsonify({'status': 'success', 'message': f'Container removed via docker-compose on {host}'})
                except subprocess.CalledProcessError as e:
                    logger.error(f"Docker Compose remove failed: {e.stderr}")
                    return jsonify({'status': 'error', 'message': f'Failed to remove container: {e.stderr}'})
        
        # Fall back to direct Docker API for non-compose containers
        logger.info(f"Using Docker API to remove container {container.name} on {host}")
        if container.status == 'running':
            container.stop()
        container.remove()
        return jsonify({'status': 'success', 'message': f'Container removed successfully on {host}'})
    except Exception as e:
        logger.error(f"Failed to remove container {id} on {host}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})


@app.route('/api/container/<id>/repull', methods=['POST'])
def repull_container(id):
    try:
        data = request.json or {}
        host = data.get('host', 'local')
        
        # Get the appropriate client for this host
        host_client = host_manager.get_client(host)
        if not host_client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        container = host_client.containers.get(id)
        
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
                
                # CRITICAL: Set DOCKER_HOST for the subprocess
                if host != 'local':
                    host_config = host_manager.get_hosts_status().get(host, {})
                    docker_url = host_config.get('url', '')
                    if docker_url:
                        env['DOCKER_HOST'] = docker_url
                        logger.info(f"Setting DOCKER_HOST={docker_url} for compose repull on {host}")
                
                try:
                    # Pull the latest image
                    logger.info(f"Using docker-compose to pull image for {container.name} (service: {service}) on {host}")
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
                    logger.info(f"Using docker-compose to recreate {container.name} (service: {service}) on {host}")
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
                        'message': f'Container {container.name} repulled and restarted via docker-compose on {host}'
                    })
                except subprocess.CalledProcessError as e:
                    logger.error(f"Docker Compose repull failed: {e.stderr}")
                    return jsonify({'status': 'error', 'message': f'Failed to repull container: {e.stderr}'})
        
        # Fall back to direct Docker API for non-compose containers
        logger.info(f"Using Docker API to repull container {container.name} on {host}")
        image_tag = None
        if container.image.tags:
            image_tag = container.image.tags[0]
        else:
            return jsonify({'status': 'error', 'message': 'Container has no image tag'})
        
        try:
            host_client.images.pull(image_tag)
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'Failed to pull image: {str(e)}'})
        
        was_running = container.status == 'running'
        if was_running:
            container.stop()
        container.remove()
        
        new_container = host_client.containers.run(
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
            'message': f'Container {container.name} repulled and restarted on {host}'
        })
    except Exception as e:
        logger.error(f"Failed to repull container {id} on {host}: {e}")
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

@app.route('/api/compose/scan')
def scan_compose_files_multihost():
    """Enhanced compose file scanning with host context awareness"""
    try:
        # Get standard local files
        files = scan_all_compose_files(COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        
        # Add metadata about which hosts can use each file
        enhanced_files = []
        hosts_status = host_manager.get_hosts_status()
        
        for file_path in files:
            full_path = resolve_compose_file_path(file_path, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
            if full_path and os.path.exists(full_path):
                
                # Try to determine which hosts this compose file targets
                target_hosts = analyze_compose_file_hosts(full_path)
                
                enhanced_files.append({
                    'path': file_path,
                    'target_hosts': target_hosts,
                    'available_on': 'local',  # Files are always read from local
                    'can_deploy_to': [h for h in hosts_status.keys() if hosts_status[h].get('connected', False)]
                })
        
        return jsonify({
            'status': 'success', 
            'files': [f['path'] for f in enhanced_files],  # Keep compatible with existing frontend
            'file_info': enhanced_files  # Additional metadata for future use
        })
        
    except Exception as e:
        logger.error(f"Failed to scan compose files: {e}")
        return jsonify({'status': 'error', 'message': str(e), 'files': []})

def analyze_compose_file_hosts(compose_file_path):
    """Analyze a compose file to guess which hosts it might target"""
    try:
        with open(compose_file_path, 'r') as f:
            content = f.read()
        
        # Look for clues in the compose file
        target_hosts = ['local']  # Default to local
        
        # Check for environment variables that might indicate remote hosts
        if 'DOCKER_HOST=' in content:
            target_hosts.append('remote')
        
        # Check for host-specific volume paths
        if '/mnt/' in content or '/media/' in content:
            # Might be targeting a specific host with mounted storage
            pass
        
        # Could add more sophisticated analysis here
        return target_hosts
        
    except Exception as e:
        logger.debug(f"Could not analyze compose file {compose_file_path}: {e}")
        return ['local']

@app.route('/api/compose/deploy', methods=['POST'])
def deploy_compose_to_host():
    """Deploy a compose file to a specific host with enhanced error handling"""
    try:
        data = request.json
        compose_file = data.get('file')
        target_host = data.get('host', 'local')
        action = data.get('action', 'up')  # up, down, restart
        pull_images = data.get('pull', False)
        
        if not compose_file:
            return jsonify({'status': 'error', 'message': 'No compose file specified'})
        
        logger.info(f"Deploying {compose_file} to host {target_host} with action {action}")
        
        # Get the compose file content (always from local filesystem)
        full_path = resolve_compose_file_path(compose_file, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
        if not full_path or not os.path.exists(full_path):
            return jsonify({'status': 'error', 'message': f'Compose file {compose_file} not found'})
        
        # Validate the compose file
        validation_result = validate_compose_file(full_path)
        if not validation_result['valid']:
            return jsonify({
                'status': 'error', 
                'message': f'Invalid compose file: {validation_result["error"]}'
            })
        
        # Analyze the compose file for potential issues
        analysis = analyze_compose_for_deployment(full_path, target_host)
        if analysis['warnings']:
            logger.warning(f"Deployment warnings for {compose_file}: {analysis['warnings']}")
        
        # Execute compose command targeting specific host
        result = execute_compose_on_host_enhanced(full_path, target_host, action, pull_images)
        
        if result['success']:
            return jsonify({
                'status': 'success',
                'message': f'Successfully {action}ed compose on {target_host}',
                'output': result.get('output', ''),
                'warnings': analysis.get('warnings', []),
                'deployment_info': {
                    'host': target_host,
                    'action': action,
                    'file': compose_file,
                    'timestamp': datetime.now().isoformat()
                }
            })
        else:
            return jsonify({
                'status': 'error',
                'message': result['message'],
                'output': result.get('output', ''),
                'error_details': result.get('error_details', {})
            })
            
    except Exception as e:
        logger.error(f"Failed to deploy compose: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose/validate', methods=['POST'])
def validate_compose_content():
    """Validate compose file content without saving"""
    try:
        data = request.json
        content = data.get('content', '')
        
        if not content.strip():
            return jsonify({'status': 'error', 'message': 'Empty compose content'})
        
        # Write to temporary file for validation
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yml', delete=False) as tmp:
            tmp.write(content)
            temp_file = tmp.name
        
        try:
            validation_result = validate_compose_file(temp_file)
            
            if validation_result['valid']:
                # Also analyze for deployment warnings
                analysis = analyze_compose_content_for_issues(content)
                
                return jsonify({
                    'status': 'success',
                    'message': 'Valid compose file',
                    'services_count': validation_result.get('services_count', 0),
                    'analysis': analysis
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': validation_result['error']
                })
                
        finally:
            # Clean up temp file
            try:
                os.unlink(temp_file)
            except:
                pass
                
    except Exception as e:
        logger.error(f"Failed to validate compose content: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/compose/analyze', methods=['POST'])
def analyze_compose_file_endpoint():
    """Analyze compose file for deployment warnings and requirements"""
    try:
        data = request.json
        compose_file = data.get('file')
        content = data.get('content')
        target_host = data.get('host', 'local')
        
        if compose_file:
            # Analyze existing file
            full_path = resolve_compose_file_path(compose_file, COMPOSE_DIR, EXTRA_COMPOSE_DIRS, logger)
            if not full_path or not os.path.exists(full_path):
                return jsonify({'status': 'error', 'message': 'Compose file not found'})
            
            analysis = analyze_compose_for_deployment(full_path, target_host)
            
        elif content:
            # Analyze provided content
            analysis = analyze_compose_content_for_issues(content)
            
        else:
            return jsonify({'status': 'error', 'message': 'No compose file or content provided'})
        
        return jsonify({
            'status': 'success',
            'analysis': analysis
        })
        
    except Exception as e:
        logger.error(f"Failed to analyze compose file: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/deployment/status/<deployment_id>')
def get_deployment_status(deployment_id):
    """Get status of a deployment operation"""
    try:
        # In a real implementation, you'd track deployment status
        # For now, return a simple status
        return jsonify({
            'status': 'success',
            'deployment_status': 'completed',
            'message': 'Deployment completed successfully'
        })
    except Exception as e:
        logger.error(f"Failed to get deployment status: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Enhanced helper functions

def validate_compose_file(file_path):
    """Validate a docker-compose file"""
    try:
        import yaml
        
        with open(file_path, 'r') as f:
            compose_data = yaml.safe_load(f)
        
        if not compose_data:
            return {'valid': False, 'error': 'Empty YAML document'}
        
        if not isinstance(compose_data, dict):
            return {'valid': False, 'error': 'Compose file must be a YAML object'}
        
        if 'services' not in compose_data:
            return {'valid': False, 'error': 'No services defined in compose file'}
        
        if not compose_data['services']:
            return {'valid': False, 'error': 'Services section is empty'}
        
        services_count = len(compose_data['services'])
        
        # Validate each service has required fields
        for service_name, service_config in compose_data['services'].items():
            if not isinstance(service_config, dict):
                return {'valid': False, 'error': f'Service {service_name} must be an object'}
            
            # Check for image or build
            if 'image' not in service_config and 'build' not in service_config:
                return {'valid': False, 'error': f'Service {service_name} must have either image or build specified'}
        
        return {
            'valid': True,
            'services_count': services_count,
            'services': list(compose_data['services'].keys())
        }
        
    except yaml.YAMLError as e:
        return {'valid': False, 'error': f'Invalid YAML: {str(e)}'}
    except Exception as e:
        return {'valid': False, 'error': f'Validation error: {str(e)}'}

def analyze_compose_for_deployment(file_path, target_host):
    """Analyze compose file for deployment warnings and requirements"""
    try:
        import yaml
        
        with open(file_path, 'r') as f:
            compose_data = yaml.safe_load(f)
        
        return analyze_compose_data(compose_data, target_host)
        
    except Exception as e:
        logger.error(f"Error analyzing compose file: {e}")
        return {
            'warnings': [f'Could not analyze compose file: {str(e)}'],
            'volume_paths': [],
            'external_networks': [],
            'port_conflicts': [],
            'resource_requirements': {}
        }

def analyze_compose_content_for_issues(content):
    """Analyze compose content string for issues"""
    try:
        import yaml
        
        compose_data = yaml.safe_load(content)
        return analyze_compose_data(compose_data, 'unknown')
        
    except yaml.YAMLError as e:
        return {
            'warnings': [f'Invalid YAML syntax: {str(e)}'],
            'volume_paths': [],
            'external_networks': [],
            'port_conflicts': [],
            'resource_requirements': {}
        }
    except Exception as e:
        return {
            'warnings': [f'Analysis error: {str(e)}'],
            'volume_paths': [],
            'external_networks': [],
            'port_conflicts': [],
            'resource_requirements': {}
        }

def analyze_compose_data(compose_data, target_host):
    """Analyze parsed compose data for deployment issues"""
    warnings = []
    volume_paths = []
    external_networks = []
    port_conflicts = []
    resource_requirements = {}
    
    if not compose_data or 'services' not in compose_data:
        return {
            'warnings': ['No services found in compose file'],
            'volume_paths': [],
            'external_networks': [],
            'port_conflicts': [],
            'resource_requirements': {}
        }
    
    # Analyze services
    for service_name, service_config in compose_data['services'].items():
        if not isinstance(service_config, dict):
            continue
        
        # Check volume mappings
        if 'volumes' in service_config and isinstance(service_config['volumes'], list):
            for volume in service_config['volumes']:
                if isinstance(volume, str) and ':' in volume:
                    host_path = volume.split(':')[0]
                    
                    # Check for absolute host paths
                    if host_path.startswith('/') or (len(host_path) > 1 and host_path[1] == ':'):
                        volume_paths.append({
                            'service': service_name,
                            'path': host_path,
                            'mapping': volume
                        })
                        
                        if target_host != 'local':
                            warnings.append(f'Service {service_name}: Volume path {host_path} must exist on target host {target_host}')
        
        # Check port mappings for conflicts
        if 'ports' in service_config and isinstance(service_config['ports'], list):
            for port in service_config['ports']:
                if isinstance(port, str) and ':' in port:
                    host_port = port.split(':')[0]
                    try:
                        port_num = int(host_port)
                        if port_num < 1024 and target_host != 'local':
                            warnings.append(f'Service {service_name}: Port {port_num} requires root privileges on target host')
                        
                        # Check for common port conflicts
                        common_ports = {22: 'SSH', 80: 'HTTP', 443: 'HTTPS', 3306: 'MySQL', 5432: 'PostgreSQL'}
                        if port_num in common_ports:
                            warnings.append(f'Service {service_name}: Port {port_num} ({common_ports[port_num]}) may conflict with system services')
                            
                    except ValueError:
                        pass
        
        # Check resource requirements
        if 'deploy' in service_config and 'resources' in service_config['deploy']:
            resources = service_config['deploy']['resources']
            if 'limits' in resources:
                resource_requirements[service_name] = resources['limits']
        
        # Check for environment file dependencies
        if 'env_file' in service_config:
            env_files = service_config['env_file']
            if isinstance(env_files, str):
                env_files = [env_files]
            elif isinstance(env_files, list):
                for env_file in env_files:
                    if target_host != 'local':
                        warnings.append(f'Service {service_name}: Environment file {env_file} must exist on target host')
    
    # Check external networks
    if 'networks' in compose_data and isinstance(compose_data['networks'], dict):
        for network_name, network_config in compose_data['networks'].items():
            if isinstance(network_config, dict) and network_config.get('external'):
                external_networks.append(network_name)
                if target_host != 'local':
                    warnings.append(f'External network {network_name} must exist on target host {target_host}')
    
    # Check for secrets and configs
    if 'secrets' in compose_data and target_host != 'local':
        warnings.append('Compose file uses secrets - ensure they are available on target host')
    
    if 'configs' in compose_data and target_host != 'local':
        warnings.append('Compose file uses configs - ensure they are available on target host')
    
    return {
        'warnings': warnings,
        'volume_paths': volume_paths,
        'external_networks': external_networks,
        'port_conflicts': port_conflicts,
        'resource_requirements': resource_requirements
    }

def execute_compose_on_host_enhanced(compose_file_path, target_host, action, pull_images=False):
    """Enhanced version of execute_compose_on_host with better error handling"""
    try:
        import subprocess
        
        compose_dir = os.path.dirname(compose_file_path)
        compose_filename = os.path.basename(compose_file_path)
        
        # Setup environment
        env = os.environ.copy()
        
        # Set DOCKER_HOST for remote execution
        if target_host != 'local':
            host_config = host_manager.get_hosts_status().get(target_host, {})
            docker_url = host_config.get('url', '')
            if docker_url:
                env['DOCKER_HOST'] = docker_url
                logger.info(f"Setting DOCKER_HOST={docker_url} for {target_host}")
            else:
                return {'success': False, 'message': f'No URL configured for host {target_host}'}
        
        # Determine project name
        project_name = os.path.basename(compose_dir)
        env['COMPOSE_PROJECT_NAME'] = project_name
        
        # Execute deployment steps
        steps_output = []
        
        try:
            # Step 1: Pull images if requested
            if pull_images and action in ['up', 'restart']:
                logger.info(f"Pulling images for {project_name} on {target_host}")
                pull_cmd = ['docker-compose', '-f', compose_filename, 'pull']
                
                pull_result = subprocess.run(
                    pull_cmd,
                    cwd=compose_dir,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                
                steps_output.append(f"PULL OUTPUT:\n{pull_result.stdout}")
                if pull_result.stderr:
                    steps_output.append(f"PULL WARNINGS:\n{pull_result.stderr}")
                
                if pull_result.returncode != 0:
                    logger.warning(f"Pull command had issues but continuing: {pull_result.stderr}")
            
            # Step 2: Execute main action
            if action == 'up':
                cmd = ['docker-compose', '-f', compose_filename, 'up', '-d']
            elif action == 'down':
                cmd = ['docker-compose', '-f', compose_filename, 'down']
            elif action == 'restart':
                # First down, then up
                down_cmd = ['docker-compose', '-f', compose_filename, 'down']
                down_result = subprocess.run(
                    down_cmd,
                    cwd=compose_dir,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                
                steps_output.append(f"DOWN OUTPUT:\n{down_result.stdout}")
                if down_result.stderr:
                    steps_output.append(f"DOWN WARNINGS:\n{down_result.stderr}")
                
                cmd = ['docker-compose', '-f', compose_filename, 'up', '-d']
            else:
                return {'success': False, 'message': f'Unknown action: {action}'}
            
            logger.info(f"Executing: {' '.join(cmd)} in {compose_dir} for host {target_host}")
            
            # Execute main command
            result = subprocess.run(
                cmd,
                cwd=compose_dir,
                env=env,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            steps_output.append(f"{action.upper()} OUTPUT:\n{result.stdout}")
            if result.stderr:
                steps_output.append(f"{action.upper()} WARNINGS:\n{result.stderr}")
            
            if result.returncode == 0:
                return {
                    'success': True,
                    'output': '\n\n'.join(steps_output),
                    'message': f'Command completed successfully on {target_host}'
                }
            else:
                return {
                    'success': False,
                    'message': f'Command failed with exit code {result.returncode}',
                    'output': '\n\n'.join(steps_output),
                    'error_details': {
                        'exit_code': result.returncode,
                        'stderr': result.stderr
                    }
                }
                
        except subprocess.TimeoutExpired:
            return {
                'success': False, 
                'message': 'Command timed out after 5 minutes',
                'output': '\n\n'.join(steps_output)
            }
            
    except Exception as e:
        logger.error(f"Error executing compose command: {e}")
        return {'success': False, 'message': str(e)}

# Additional utility function for project creation with deployment
@app.route('/api/project/create-and-deploy', methods=['POST'])
def create_project_and_deploy():
    """Create a new project and optionally deploy it to a host"""
    try:
        data = request.json
        
        # First create the project using existing logic
        create_result = create_project_locally(data)
        
        if not create_result['success']:
            return jsonify(create_result)
        
        # If deployment is requested
        deploy_host = data.get('deploy_host')
        auto_start = data.get('auto_start', True)
        
        if deploy_host and deploy_host != '':
            project_name = data['project_name']
            location_type = data.get('location_type', 'default')
            
            # Construct compose file path
            if location_type == 'default':
                compose_path = f"{project_name}/docker-compose.yml"
            else:
                compose_path = f"{project_name}/docker-compose.yml"
            
            # Deploy the project
            deploy_action = 'up' if auto_start else 'down'
            deploy_result = execute_compose_on_host_enhanced(
                os.path.join(COMPOSE_DIR, compose_path), 
                deploy_host, 
                deploy_action
            )
            
            if deploy_result['success']:
                create_result['message'] += f' and deployed to {deploy_host}'
                create_result['deployment'] = {
                    'host': deploy_host,
                    'action': deploy_action,
                    'output': deploy_result.get('output', '')
                }
            else:
                create_result['message'] += f' but deployment to {deploy_host} failed'
                create_result['deployment_error'] = deploy_result['message']
                # Don't fail the entire operation if deployment fails
        
        return jsonify(create_result)
        
    except Exception as e:
        logger.error(f"Failed to create and deploy project: {e}")
        return jsonify({'status': 'error', 'success': False, 'message': str(e)})

# Function to check host connectivity before deployment
@app.route('/api/hosts/check-deployment-ready/<host_name>')
def check_host_deployment_ready(host_name):
    """Check if a host is ready for deployment"""
    try:
        if host_name == 'local':
            return jsonify({
                'status': 'success',
                'ready': True,
                'message': 'Local host is always ready'
            })
        
        # Check host connectivity
        hosts_status = host_manager.get_hosts_status()
        host_info = hosts_status.get(host_name)
        
        if not host_info:
            return jsonify({
                'status': 'error',
                'ready': False,
                'message': f'Host {host_name} not found'
            })
        
        if not host_info.get('connected'):
            return jsonify({
                'status': 'error',
                'ready': False,
                'message': f'Host {host_name} is not connected'
            })
        
        # Additional checks could go here
        # - Disk space
        # - Docker version compatibility
        # - Network connectivity
        
        return jsonify({
            'status': 'success',
            'ready': True,
            'message': f'Host {host_name} is ready for deployment',
            'host_info': {
                'name': host_info.get('name', host_name),
                'url': host_info.get('url', ''),
                'last_check': host_info.get('last_check', 0)
            }
        })
        
    except Exception as e:
        logger.error(f"Failed to check host deployment readiness: {e}")
        return jsonify({
            'status': 'error',
            'ready': False,
            'message': f'Error checking host: {str(e)}'
        })


def execute_compose_on_host(compose_file_path, target_host, action):
    """Execute docker-compose command on a specific host"""
    try:
        import subprocess
        
        compose_dir = os.path.dirname(compose_file_path)
        compose_filename = os.path.basename(compose_file_path)
        
        # Setup environment
        env = os.environ.copy()
        
        # Set DOCKER_HOST for remote execution
        if target_host != 'local':
            host_config = host_manager.get_hosts_status().get(target_host, {})
            docker_url = host_config.get('url', '')
            if docker_url:
                env['DOCKER_HOST'] = docker_url
                logger.info(f"Setting DOCKER_HOST={docker_url} for {target_host}")
        
        # Determine project name
        project_name = os.path.basename(compose_dir)
        env['COMPOSE_PROJECT_NAME'] = project_name
        
        # Build command
        cmd = ['docker-compose', '-f', compose_filename]
        
        if action == 'up':
            cmd.extend(['up', '-d'])
        elif action == 'down':
            cmd.append('down')
        elif action == 'restart':
            cmd.extend(['down'])  # First down
        else:
            return {'success': False, 'message': f'Unknown action: {action}'}
        
        logger.info(f"Executing: {' '.join(cmd)} in {compose_dir} for host {target_host}")
        
        # Execute command
        result = subprocess.run(
            cmd,
            cwd=compose_dir,
            env=env,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode == 0:
            # If restart, now do the up
            if action == 'restart':
                up_cmd = ['docker-compose', '-f', compose_filename, 'up', '-d']
                up_result = subprocess.run(
                    up_cmd,
                    cwd=compose_dir,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                if up_result.returncode != 0:
                    return {
                        'success': False,
                        'message': f'Restart failed on up phase: {up_result.stderr}'
                    }
            
            return {
                'success': True,
                'output': result.stdout,
                'message': f'Command completed successfully on {target_host}'
            }
        else:
            return {
                'success': False,
                'message': f'Command failed: {result.stderr}'
            }
            
    except subprocess.TimeoutExpired:
        return {'success': False, 'message': 'Command timed out after 5 minutes'}
    except Exception as e:
        return {'success': False, 'message': str(e)}
    
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
# 3. Update images endpoint for multi-host
@app.route('/api/images')
def get_images_multihost():
    """Get images from all connected hosts"""
    try:
        all_images = []
        hosts_status = host_manager.get_hosts_status()
        
        for host_name, status_info in hosts_status.items():
            if status_info['connected']:
                client = host_manager.get_client(host_name)
                if client:
                    try:
                        host_images = client.images.list()
                        
                        for image in host_images:
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
                                except (ValueError, TypeError):
                                    created = 'Unknown'
                            
                            # Find containers using this image on this host
                            used_by = []
                            try:
                                for container in client.containers.list(all=True):
                                    if container.image.id == image.id:
                                        used_by.append(f"{container.name} ({host_name})")
                            except Exception as e:
                                logger.warning(f"Failed to get container usage for image on {host_name}: {e}")
                            
                            all_images.append({
                                'id': image.short_id,
                                'name': name,
                                'tags': tags,
                                'size': size_mb,
                                'created': created,
                                'used_by': used_by,
                                'host': host_name,
                                'host_display': status_info.get('name', host_name)
                            })
                            
                    except Exception as e:
                        logger.error(f"Failed to get images from host {host_name}: {e}")
        
        return jsonify(all_images)
        
    except Exception as e:
        logger.error(f"Failed to get images from all hosts: {e}")
        return jsonify([])
@app.route('/api/system/<host>')
def get_host_system_info(host):
    """Get system information for a specific host"""
    try:
        client = host_manager.get_client(host)
        if not client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        info = client.info()
        containers = client.containers.list(all=True)
        
        return jsonify({
            'status': 'success',
            'total_containers': len(containers),
            'running_containers': len([c for c in containers if c.status == 'running']),
            'cpu_count': info.get('NCPU', 0),
            'memory_total': round(info.get('MemTotal', 0) / (1024 * 1024), 2),
            'docker_version': info.get('ServerVersion', 'unknown')
        })
        
    except Exception as e:
        logger.error(f"Failed to get system info for host {host}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

# Update your existing multi-host system overview to work with your HostManager
@app.route('/api/system/overview')
def get_multihost_system_overview():
    """Get system overview for all connected hosts"""
    try:
        overview = {}
        totals = {
            'total_containers': 0,
            'total_running': 0,
            'total_images': 0,
            'connected_hosts': 0,
            'total_cpu_cores': 0,
            'total_memory_gb': 0
        }
        
        hosts_status = host_manager.get_hosts_status()
        
        for host_name, status in hosts_status.items():
            if status['connected']:
                client = host_manager.get_client(host_name)
                if client:
                    try:
                        info = client.info()
                        containers = len(client.containers.list(all=True))
                        running = len(client.containers.list())
                        images = len(client.images.list())
                        
                        host_stats = {
                            'name': status.get('name', host_name),
                            'connected': True,
                            'containers': containers,
                            'running': running,
                            'images': images,
                            'cpu_count': info.get('NCPU', 0),
                            'memory_total': round(info.get('MemTotal', 0) / (1024 * 1024 * 1024), 2),
                            'docker_version': info.get('ServerVersion', 'unknown')
                        }
                        
                        # Add to totals
                        totals['total_containers'] += containers
                        totals['total_running'] += running
                        totals['total_images'] += images
                        totals['total_cpu_cores'] += host_stats['cpu_count']
                        totals['total_memory_gb'] += host_stats['memory_total']
                        totals['connected_hosts'] += 1
                        
                    except Exception as e:
                        logger.error(f"Failed to get stats for host {host_name}: {e}")
                        host_stats = {
                            'name': status.get('name', host_name),
                            'connected': False,
                            'error': str(e)
                        }
                else:
                    host_stats = {
                        'name': status.get('name', host_name),
                        'connected': False,
                        'error': 'Client not available'
                    }
            else:
                host_stats = {
                    'name': status.get('name', host_name),
                    'connected': False,
                    'error': 'Not connected'
                }
            
            overview[host_name] = host_stats
        
        return jsonify({
            'status': 'success',
            'hosts': overview,
            'totals': totals
        })
        
    except Exception as e:
        logger.error(f"Failed to get multi-host overview: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

@app.route('/api/images/<id>/remove', methods=['POST'])
def remove_image(id):
    try:
        data = request.json or {}
        host = data.get('host', 'local')
        force = request.args.get('force', 'false').lower() == 'true'
        
        # Get the appropriate client for this host
        host_client = host_manager.get_client(host)
        if not host_client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        host_client.images.remove(id, force=force)
        return jsonify({'status': 'success', 'message': f'Image removed successfully from {host}'})
    except Exception as e:
        logger.error(f"Failed to remove image {id} from {host}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})


@app.route('/api/images/prune', methods=['POST'])
def prune_images():
    try:
        data = request.json or {}
        host = data.get('host', 'local')
        
        # Get the appropriate client for this host
        host_client = host_manager.get_client(host)
        if not host_client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        result = host_client.images.prune()
        space_reclaimed = round(result['SpaceReclaimed'] / (1024 * 1024), 2)
        return jsonify({
            'status': 'success',
            'message': f'Pruned {len(result["ImagesDeleted"] or [])} images on {host}, reclaimed {space_reclaimed} MB'
        })
    except Exception as e:
        logger.error(f"Failed to prune images on {host}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})


@app.route('/api/images/remove_unused', methods=['POST'])
def remove_unused_images():
    try:
        data = request.json or {}
        host = data.get('host', 'local')
        force = request.args.get('force', 'false').lower() == 'true'
        
        # Get the appropriate client for this host
        host_client = host_manager.get_client(host)
        if not host_client:
            return jsonify({'status': 'error', 'message': f'Host {host} not available'})
        
        logger.info(f"Removing unused images on {host} with force={force}")
        
        # Get all images
        images = host_client.images.list()
        
        # Get all running containers
        containers = host_client.containers.list(all=True)
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
                logger.info(f"Attempting to remove image {image.id} on {host} with force={force}")
                host_client.images.remove(image.id, force=force)
                removed += 1
            except Exception as e:
                logger.error(f"Failed to remove image {image.id} on {host}: {e}")
                failed += 1
                failure_reasons.append(f"{image.id}: {str(e)}")
        
        message = f'Removed {removed} unused images on {host}, {failed} failed'
        if failure_reasons and len(failure_reasons) <= 3:
            message += f". Failures: {'; '.join(failure_reasons)}"
            
        return jsonify({
            'status': 'success',
            'message': message
        })
    except Exception as e:
        logger.error(f"Failed to remove unused images on {host}: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

    

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

# Enhanced project creation with host awareness
@app.route('/api/compose/create', methods=['POST'])
def create_compose_project_multihost():
    """Create compose project with multi-host awareness"""
    try:
        data = request.json
        project_name = data.get('project_name')
        target_host = data.get('target_host', 'local')
        
        if not project_name:
            return jsonify({'status': 'error', 'message': 'Project name is required'})
        
        # Always create project locally (files are managed locally)
        result = create_project_locally(data)
        
        if result['success']:
            # Optionally deploy to target host after creation
            if data.get('auto_deploy', False) and target_host != 'local':
                compose_file = result['compose_file']
                deploy_result = execute_compose_on_host(
                    os.path.join(COMPOSE_DIR, compose_file), 
                    target_host, 
                    'up'
                )
                
                if deploy_result['success']:
                    result['message'] += f' and deployed to {target_host}'
                else:
                    result['message'] += f' but deployment to {target_host} failed: {deploy_result["message"]}'
            
            return jsonify(result)
        else:
            return jsonify(result)
            
    except Exception as e:
        logger.error(f"Failed to create project: {e}")
        return jsonify({'status': 'error', 'message': str(e)})

def create_project_locally(data):
    """Create project on local filesystem (existing logic)"""
    # This is your existing create project logic
    # Just extracted into a separate function for clarity
    try:
        project_name = data['project_name']
        location_type = data.get('location_type', 'default')
        
        if not re.match(r'^[a-zA-Z0-9_-]+$', project_name):
            return {
                'status': 'error',
                'success': False,
                'message': 'Project name can only contain letters, numbers, underscores and hyphens'
            }
        
        # Determine project directory
        if location_type == 'default':
            project_dir = os.path.join(COMPOSE_DIR, project_name)
        elif location_type.startswith('extra_'):
            extra_index = int(location_type.split('_')[1])
            extra_dirs = EXTRA_COMPOSE_DIRS
            if isinstance(extra_dirs, str):
                extra_dirs = extra_dirs.split(':') if extra_dirs else []
            
            if 0 <= extra_index < len(extra_dirs) and extra_dirs[extra_index]:
                project_dir = os.path.join(extra_dirs[extra_index], project_name)
            else:
                return {'status': 'error', 'success': False, 'message': 'Invalid location'}
        else:
            return {'status': 'error', 'success': False, 'message': 'Invalid location'}
        
        if os.path.exists(project_dir):
            return {'status': 'error', 'success': False, 'message': f'Project already exists'}
        
        # Create directory and files
        os.makedirs(project_dir, exist_ok=True)
        
        compose_content = data.get('compose_content', '')
        compose_file_path = os.path.join(project_dir, 'docker-compose.yml')
        with open(compose_file_path, 'w') as f:
            f.write(compose_content)
        
        if data.get('create_env_file', False) and data.get('env_content'):
            env_file_path = os.path.join(project_dir, '.env')
            with open(env_file_path, 'w') as f:
                f.write(data['env_content'])
        
        return {
            'status': 'success',
            'success': True,
            'message': f'Project {project_name} created successfully',
            'compose_file': os.path.join(project_name, 'docker-compose.yml'),
            'project_dir': project_dir
        }
        
    except Exception as e:
        return {'status': 'error', 'success': False, 'message': str(e)}

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