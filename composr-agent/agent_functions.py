import json
import os
import logging
from datetime import datetime
import functools

# Caching for compose files
_compose_files_cache = None
_compose_files_cache_time = 0
COMPOSE_CACHE_TTL = 300  # 5 minutes

def load_container_metadata(file_path, logger):
    """Load container metadata from JSON file"""
    try:
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load metadata: {e}")
    return {}

def save_container_metadata(metadata, file_path, logger):
    """Save container metadata to JSON file"""
    try:
        with open(file_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save metadata: {e}")
        return False

def calculate_uptime(started_at, logger):
    """Calculate container uptime"""
    try:
        if not started_at:
            return {'minutes': 0, 'display': 'N/A'}
        
        # Parse the started_at timestamp
        if 'T' in started_at:
            start_time = datetime.strptime(started_at.split('.')[0], '%Y-%m-%dT%H:%M:%S')
        else:
            start_time = datetime.strptime(started_at, '%Y-%m-%d %H:%M:%S')
        
        uptime_delta = datetime.now() - start_time
        total_minutes = int(uptime_delta.total_seconds() / 60)
        
        # Format the display string
        if total_minutes < 60:
            display = f"{total_minutes}m"
        elif total_minutes < 1440:  # Less than a day
            hours = total_minutes // 60
            minutes = total_minutes % 60
            display = f"{hours}h {minutes}m"
        else:
            days = total_minutes // 1440
            hours = (total_minutes % 1440) // 60
            display = f"{days}d {hours}h"
        
        return {'minutes': total_minutes, 'display': display}
    except Exception as e:
        logger.debug(f"Failed to calculate uptime for {started_at}: {e}")
        return {'minutes': 0, 'display': 'N/A'}

def scan_all_compose_files(compose_dir, extra_dirs, logger):
    """Scan for all compose files in specified directories"""
    compose_files = []
    compose_filenames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
    
    search_dirs = [compose_dir] + [d for d in extra_dirs if d and os.path.exists(d)]
    
    for search_dir in search_dirs:
        logger.debug(f"Scanning directory: {search_dir}")
        for root, dirs, files in os.walk(search_dir):
            for file in files:
                if file.lower() in compose_filenames:
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, compose_dir)
                    compose_files.append(relative_path)
                    logger.debug(f"Found compose file: {relative_path}")
    
    return compose_files

def get_compose_files_cached(compose_dir, extra_dirs):
    """Get compose files with caching"""
    import time
    global _compose_files_cache, _compose_files_cache_time
    
    current_time = time.time()
    if _compose_files_cache is not None and (current_time - _compose_files_cache_time) < COMPOSE_CACHE_TTL:
        return _compose_files_cache
    
    # Create a logger here if needed
    logger = logging.getLogger(__name__)
    _compose_files_cache = scan_all_compose_files(compose_dir, extra_dirs, logger)
    _compose_files_cache_time = current_time
    
    return _compose_files_cache

def resolve_compose_file_path(file_path, compose_dir, extra_dirs, logger):
    """Resolve compose file path to absolute path"""
    # Try as absolute path first
    if os.path.isabs(file_path) and os.path.exists(file_path):
        return file_path
    
    # Try relative to compose_dir
    full_path = os.path.join(compose_dir, file_path)
    if os.path.exists(full_path):
        return full_path
    
    # Try in extra directories
    for extra_dir in extra_dirs:
        if extra_dir:
            full_path = os.path.join(extra_dir, file_path)
            if os.path.exists(full_path):
                return full_path
    
    # Try with ../ prefix
    if file_path.startswith('../'):
        parent_path = os.path.join(os.path.dirname(compose_dir), file_path[3:])
        if os.path.exists(parent_path):
            return parent_path
    
    logger.warning(f"Could not resolve compose file path: {file_path}")
    return None