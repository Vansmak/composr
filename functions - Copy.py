import json
import os
import datetime
import pytz
import yaml
import docker
from functools import lru_cache

def initialize_docker_client(logger):
    """Initialize Docker client"""
    try:
        client = docker.from_env()
        return client
    except Exception as e:
        logger.error(f"Failed to initialize Docker client: {e}")
        return None

def load_container_metadata(metadata_file, logger):
    """Load container metadata from file"""
    try:
        if os.path.exists(metadata_file):
            with open(metadata_file, 'r') as f:
                return json.load(f)
        return {}
    except Exception as e:
        logger.error(f"Failed to load container metadata: {e}")
        return {}

def save_container_metadata(metadata, metadata_file, logger):
    """Save container metadata to file"""
    try:
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f)
        return True
    except Exception as e:
        logger.error(f"Failed to save container metadata: {e}")
        return False

def calculate_uptime(started_at, logger):
    """Calculate container uptime from start time"""
    if not started_at:
        return {"display": "N/A", "minutes": 0}
    try:
        started = datetime.datetime.strptime(started_at[:19], "%Y-%m-%dT%H:%M:%S")
        started = started.replace(tzinfo=pytz.UTC)
        now = datetime.datetime.now(pytz.UTC)
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
def get_compose_files_cached(compose_dir, extra_dirs):
    """Cached version of get_compose_files"""
    import logging
    logger = logging.getLogger(__name__)
    compose_files = get_compose_files(compose_dir, extra_dirs, logger)
    return compose_files

def get_compose_files(compose_dir, extra_dirs, logger):
    """Get all compose files in the configured directories, returning relative paths"""
    try:
        compose_files = []
        search_dirs = [compose_dir] + [d for d in extra_dirs if d]
        for search_dir in search_dirs:
            if logger:
                logger.debug(f"Searching directory: {search_dir}")
            if not os.path.exists(search_dir):
                if logger:
                    logger.warning(f"Search directory doesn't exist: {search_dir}")
                continue
            for root, dirs, files in os.walk(search_dir, topdown=True):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for file in files:
                    if file in ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'] or file.startswith('docker-compose.'):
                        file_path = os.path.join(root, file)
                        try:
                            relative_path = os.path.relpath(file_path, compose_dir)
                            relative_path = relative_path.replace(os.sep, '/')
                            compose_files.append(relative_path)
                            if logger:
                                logger.debug(f"Found compose file: {relative_path}")
                        except ValueError as e:
                            if logger:
                                logger.warning(f"Failed to compute relative path for {file_path}: {e}")
                            continue
        if logger:
            logger.info(f"Total compose files found: {len(compose_files)}")
        return sorted(compose_files)
    except Exception as e:
        if logger:
            logger.error(f"Failed to find compose files: {e}", exc_info=True)
        raise  # Re-raise to ensure endpoint handles the error

def scan_all_compose_files(compose_dir, extra_dirs, logger):
    """Scan for all compose files, returning relative paths"""
    try:
        compose_files = []
        search_dirs = [compose_dir] + [d for d in extra_dirs if d]
        for search_dir in search_dirs:
            if not os.path.exists(search_dir):
                logger.warning(f"Scan directory doesn't exist: {search_dir}")
                continue
            for root, dirs, files in os.walk(search_dir, topdown=True):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for file in files:
                    if file in ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'] or file.startswith('docker-compose.'):
                        file_path = os.path.join(root, file)
                        try:
                            relative_path = os.path.relpath(file_path, compose_dir)
                            relative_path = relative_path.replace(os.sep, '/')
                            compose_files.append(relative_path)
                            logger.debug(f"Found compose file during scan: {relative_path}")
                        except ValueError as e:
                            logger.warning(f"Failed to compute relative path for {file_path}: {e}")
                            continue
        logger.info(f"Total compose files found during scan: {len(compose_files)}")
        get_compose_files_cached.cache_clear()
        return sorted(compose_files)
    except Exception as e:
        logger.error(f"Failed to scan compose files: {e}", exc_info=True)
        raise

def resolve_compose_file_path(file_path, compose_dir, extra_dirs, logger):
    """Resolve the full path of a compose file by checking configured directories"""
    logger.debug(f"Resolving compose file path: {file_path}")
    file_path = file_path.replace('\\', '/')
    if os.path.isabs(file_path):
        if os.path.exists(file_path):
            logger.debug(f"Found absolute path: {file_path}")
            return file_path
        try:
            relative_path = os.path.relpath(file_path, compose_dir)
            full_path = os.path.join(compose_dir, relative_path)
            if os.path.exists(full_path):
                logger.debug(f"Found file after converting absolute to relative: {full_path}")
                return full_path
        except ValueError:
            pass
        logger.debug(f"Absolute path does not exist: {file_path}")
    search_dirs = [compose_dir] + [d for d in extra_dirs if d]
    for search_dir in search_dirs:
        full_path = os.path.join(search_dir, file_path)
        if os.path.exists(full_path):
            logger.debug(f"Found file at: {full_path}")
            return full_path
        logger.debug(f"File not found at: {full_path}")
    logger.warning(f"Could not resolve compose file: {file_path}")
    return None

def extract_env_from_compose(compose_file_path, modify_compose=False, logger=None):
    """Extract environment variables from a compose file to create a .env file"""
    try:
        with open(compose_file_path, 'r') as f:
            compose_data = yaml.safe_load(f)
        env_vars = {}
        compose_modified = False
        if compose_data and 'services' in compose_data:
            for service_name, service_config in compose_data['services'].items():
                if 'environment' in service_config:
                    env_section = service_config['environment']
                    if isinstance(env_section, list):
                        for item in env_section:
                            if isinstance(item, str) and '=' in item:
                                key, value = item.split('=', 1)
                                env_vars[key.strip()] = value.strip()
                        if modify_compose:
                            new_env = [key for key in env_vars.keys()]
                            service_config['environment'] = new_env
                            compose_modified = True
                    elif isinstance(env_section, dict):
                        for key, value in env_section.items():
                            if value is not None:
                                env_vars[key.strip()] = str(value).strip()
                        if modify_compose:
                            new_env = {key: None for key in env_vars.keys()}
                            service_config['environment'] = new_env
                            compose_modified = True
        env_content = "# Auto-generated .env file from compose\n"
        env_content += "# Created: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "\n\n"
        for key, value in env_vars.items():
            env_content += f"{key}={value}\n"
        if modify_compose and compose_modified:
            with open(compose_file_path, 'w') as f:
                yaml.dump(compose_data, f, sort_keys=False)
        return env_content, compose_modified
    except Exception as e:
        if logger:
            logger.error(f"Failed to extract environment variables from compose file: {e}")
        return None, False

def find_caddy_container(client, logger):
    """Find the Caddy container by looking for containers with caddy in the image name"""
    try:
        for container in client.containers.list():
            if container.image.tags and any('caddy' in tag.lower() for tag in container.image.tags):
                return container
        return None
    except Exception as e:
        logger.error(f"Failed to find Caddy container: {e}")
        return None