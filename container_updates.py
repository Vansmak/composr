# container_updates.py - Update management for containers managed by Composr

import os
import json
import time
import logging
import requests
import subprocess
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
import docker
import yaml
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

class ContainerUpdateManager:
    def __init__(self, compose_dir, extra_compose_dirs, metadata_dir='/app'):
        self.compose_dir = compose_dir
        self.extra_compose_dirs = extra_compose_dirs if extra_compose_dirs else []
        self.metadata_dir = metadata_dir
        self.update_cache_file = os.path.join(metadata_dir, 'container_updates_cache.json')
        self.update_settings_file = os.path.join(metadata_dir, 'container_update_settings.json')
        
        # Default update settings
        self.default_settings = {
            'auto_check_enabled': True,
            'check_interval_hours': 6,
            'notify_on_updates': True,
            'auto_update_enabled': False,  # Safer default
            'auto_update_schedule': 'manual',  # manual, daily, weekly
            'exclude_patterns': ['latest', 'dev', 'test'],  # Skip these tags
            'include_patterns': ['stable', 'main', 'prod'],  # Prioritize these
            'backup_before_update': True,
            'rollback_on_failure': True,
            'max_concurrent_updates': 3
        }
        
        self.settings = self.load_settings()
        
    def load_settings(self) -> Dict:
        """Load container update settings"""
        try:
            if os.path.exists(self.update_settings_file):
                with open(self.update_settings_file, 'r') as f:
                    settings = json.load(f)
                    return {**self.default_settings, **settings}
            return self.default_settings
        except Exception as e:
            logger.error(f"Failed to load container update settings: {e}")
            return self.default_settings
    
    def save_settings(self):
        """Save container update settings"""
        try:
            with open(self.update_settings_file, 'w') as f:
                json.dump(self.settings, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save container update settings: {e}")
    
    def get_all_containers_with_images(self, host_manager) -> List[Dict]:
        """Get all containers with their current image information"""
        all_containers = []
        
        hosts_status = host_manager.get_hosts_status()
        
        for host_name, status_info in hosts_status.items():
            if status_info['connected']:
                client = host_manager.get_client(host_name)
                if client:
                    try:
                        containers = client.containers.list(all=True)
                        
                        for container in containers:
                            labels = container.labels or {}
                            
                            # Get image information
                            image_info = self.parse_image_name(container.image.tags[0] if container.image.tags else container.image.id)
                            
                            container_info = {
                                'id': container.short_id,
                                'name': container.name,
                                'host': host_name,
                                'status': container.status,
                                'image_full': container.image.tags[0] if container.image.tags else container.image.id,
                                'image_name': image_info['name'],
                                'image_tag': image_info['tag'],
                                'image_registry': image_info['registry'],
                                'compose_project': labels.get('com.docker.compose.project'),
                                'compose_service': labels.get('com.docker.compose.service'),
                                'compose_file': labels.get('com.docker.compose.project.config_files'),
                                'created': container.attrs.get('Created', ''),
                                'is_compose_managed': bool(labels.get('com.docker.compose.project')),
                                'update_available': False,
                                'latest_version': None,
                                'last_checked': None
                            }
                            
                            all_containers.append(container_info)
                            
                    except Exception as e:
                        logger.error(f"Failed to get containers from host {host_name}: {e}")
        
        return all_containers
    
    def parse_image_name(self, image_full: str) -> Dict:
        """Parse Docker image name into components"""
        try:
            # Handle different image formats:
            # nginx:latest
            # nginx:1.21
            # docker.io/nginx:latest
            # ghcr.io/user/app:v1.0.0
            # localhost:5000/myapp:latest
            
            if '@sha256:' in image_full:
                # Handle digest format
                image_full = image_full.split('@')[0]
            
            # Split registry/namespace and image:tag
            parts = image_full.split('/')
            
            if '.' in parts[0] or ':' in parts[0] or parts[0] == 'localhost':
                # Has registry
                registry = parts[0]
                if len(parts) == 2:
                    # registry/image:tag
                    image_part = parts[1]
                    namespace = None
                else:
                    # registry/namespace/image:tag
                    namespace = '/'.join(parts[1:-1])
                    image_part = parts[-1]
            else:
                # No explicit registry (Docker Hub)
                registry = 'docker.io'
                if len(parts) == 1:
                    # image:tag (official image)
                    image_part = parts[0]
                    namespace = 'library'
                else:
                    # user/image:tag
                    namespace = '/'.join(parts[:-1])
                    image_part = parts[-1]
            
            # Split image name and tag
            if ':' in image_part:
                image_name, tag = image_part.rsplit(':', 1)
            else:
                image_name = image_part
                tag = 'latest'
            
            return {
                'registry': registry,
                'namespace': namespace,
                'name': image_name,
                'tag': tag,
                'full_name': f"{namespace}/{image_name}" if namespace else image_name
            }
            
        except Exception as e:
            logger.error(f"Failed to parse image name {image_full}: {e}")
            return {
                'registry': 'unknown',
                'namespace': None,
                'name': image_full,
                'tag': 'unknown',
                'full_name': image_full
            }
    
    def check_for_container_updates(self, containers: List[Dict]) -> Dict:
        """Check for available updates for all containers"""
        try:
            logger.info(f"Checking for updates on {len(containers)} containers...")
            
            update_results = {
                'total_checked': len(containers),
                'updates_available': 0,
                'check_errors': 0,
                'containers': {},
                'last_check': time.time()
            }
            
            # Use thread pool for concurrent checks
            max_workers = min(self.settings['max_concurrent_updates'], len(containers))
            
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # Submit all update checks
                future_to_container = {
                    executor.submit(self.check_single_container_update, container): container
                    for container in containers
                }
                
                # Collect results
                for future in as_completed(future_to_container):
                    container = future_to_container[future]
                    container_id = f"{container['host']}:{container['name']}"
                    
                    try:
                        result = future.result()
                        update_results['containers'][container_id] = result
                        
                        if result['update_available']:
                            update_results['updates_available'] += 1
                            
                    except Exception as e:
                        logger.error(f"Update check failed for {container_id}: {e}")
                        update_results['check_errors'] += 1
                        update_results['containers'][container_id] = {
                            'update_available': False,
                            'error': str(e),
                            'last_checked': time.time()
                        }
            
            # Cache results
            self.save_update_cache(update_results)
            
            logger.info(f"Update check complete: {update_results['updates_available']} updates available")
            return update_results
            
        except Exception as e:
            logger.error(f"Failed to check for container updates: {e}")
            return {
                'total_checked': 0,
                'updates_available': 0,
                'check_errors': 1,
                'containers': {},
                'error': str(e),
                'last_check': time.time()
            }
    
    def check_single_container_update(self, container: Dict) -> Dict:
        """Check for updates for a single container"""
        try:
            image_info = {
                'registry': container['image_registry'],
                'name': container['image_name'],
                'tag': container['image_tag']
            }
            
            # Skip certain tags based on settings
            if self.should_skip_image(image_info):
                return {
                    'update_available': False,
                    'reason': 'skipped_by_settings',
                    'current_tag': image_info['tag'],
                    'last_checked': time.time()
                }
            
            # Check different update strategies based on image tag
            if image_info['tag'] in ['latest', 'main', 'master', 'stable']:
                # For latest-style tags, check if image has been updated
                return self.check_latest_tag_update(container, image_info)
            
            elif self.is_version_tag(image_info['tag']):
                # For version tags, check for newer versions
                return self.check_version_tag_update(container, image_info)
            
            else:
                # For other tags, just check if image exists and has updates
                return self.check_generic_tag_update(container, image_info)
                
        except Exception as e:
            logger.error(f"Failed to check updates for {container['name']}: {e}")
            return {
                'update_available': False,
                'error': str(e),
                'last_checked': time.time()
            }
    
    def should_skip_image(self, image_info: Dict) -> bool:
        """Check if image should be skipped based on settings"""
        tag = image_info['tag']
        
        # Check exclude patterns
        for pattern in self.settings['exclude_patterns']:
            if pattern in tag:
                return True
        
        # If include patterns are specified, only include matching ones
        if self.settings['include_patterns']:
            for pattern in self.settings['include_patterns']:
                if pattern in tag:
                    return False
            return True  # Skip if doesn't match any include pattern
        
        return False
    
    def is_version_tag(self, tag: str) -> bool:
        """Check if tag looks like a version number"""
        # Match patterns like: 1.0.0, v1.0.0, 2.1, v2.1, 1.0.0-beta, etc.
        version_patterns = [
            r'^v?\d+\.\d+\.\d+',  # 1.0.0, v1.0.0
            r'^v?\d+\.\d+',       # 1.0, v1.0
            r'^v?\d+',            # 1, v1
            r'^\d+\.\d+\.\d+',    # 1.0.0
        ]
        
        for pattern in version_patterns:
            if re.match(pattern, tag):
                return True
        return False
    
    def check_latest_tag_update(self, container: Dict, image_info: Dict) -> Dict:
        """Check if a 'latest' style tag has been updated"""
        try:
            # For Docker Hub images, check the last_updated field
            if image_info['registry'] == 'docker.io':
                return self.check_dockerhub_update(container, image_info)
            
            # For other registries, try registry API
            return self.check_registry_update(container, image_info)
            
        except Exception as e:
            logger.debug(f"Latest tag check failed for {container['name']}: {e}")
            return {
                'update_available': False,
                'error': str(e),
                'last_checked': time.time()
            }
    
    def check_dockerhub_update(self, container: Dict, image_info: Dict) -> Dict:
        """Check Docker Hub for image updates"""
        try:
            # Docker Hub API v2
            if image_info.get('namespace') == 'library':
                # Official image
                url = f"https://registry.hub.docker.com/v2/repositories/library/{image_info['name']}/tags/{image_info['tag']}"
            else:
                # User/org image
                url = f"https://registry.hub.docker.com/v2/repositories/{image_info['namespace']}/{image_info['name']}/tags/{image_info['tag']}"
            
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            remote_updated = data.get('last_updated', '')
            
            # Compare with container creation time
            if remote_updated:
                remote_time = datetime.fromisoformat(remote_updated.replace('Z', '+00:00'))
                container_time = datetime.fromisoformat(container['created'].replace('Z', '+00:00'))
                
                update_available = remote_time > container_time
                
                return {
                    'update_available': update_available,
                    'current_tag': image_info['tag'],
                    'remote_updated': remote_updated,
                    'container_created': container['created'],
                    'check_method': 'dockerhub_api',
                    'last_checked': time.time()
                }
            
            return {
                'update_available': False,
                'reason': 'no_timestamp_data',
                'last_checked': time.time()
            }
            
        except requests.RequestException as e:
            logger.debug(f"Docker Hub API request failed: {e}")
            return {
                'update_available': False,
                'error': f'Docker Hub API error: {str(e)}',
                'last_checked': time.time()
            }
    
    def check_version_tag_update(self, container: Dict, image_info: Dict) -> Dict:
        """Check for newer version tags"""
        try:
            # Get all tags for the image
            available_tags = self.get_available_tags(image_info)
            
            if not available_tags:
                return {
                    'update_available': False,
                    'reason': 'could_not_fetch_tags',
                    'last_checked': time.time()
                }
            
            current_version = image_info['tag']
            latest_version = self.find_latest_version_tag(available_tags, current_version)
            
            if latest_version and latest_version != current_version:
                return {
                    'update_available': True,
                    'current_tag': current_version,
                    'latest_tag': latest_version,
                    'available_tags': available_tags[:10],  # Limit for response size
                    'check_method': 'version_comparison',
                    'last_checked': time.time()
                }
            
            return {
                'update_available': False,
                'current_tag': current_version,
                'latest_tag': current_version,
                'check_method': 'version_comparison',
                'last_checked': time.time()
            }
            
        except Exception as e:
            logger.debug(f"Version tag check failed: {e}")
            return {
                'update_available': False,
                'error': str(e),
                'last_checked': time.time()
            }
    
    def get_available_tags(self, image_info: Dict) -> List[str]:
        """Get all available tags for an image"""
        try:
            if image_info['registry'] == 'docker.io':
                return self.get_dockerhub_tags(image_info)
            else:
                # For other registries, would need specific implementations
                return []
                
        except Exception as e:
            logger.debug(f"Failed to get tags for {image_info['name']}: {e}")
            return []
    
    def get_dockerhub_tags(self, image_info: Dict) -> List[str]:
        """Get tags from Docker Hub"""
        try:
            if image_info.get('namespace') == 'library':
                url = f"https://registry.hub.docker.com/v2/repositories/library/{image_info['name']}/tags/"
            else:
                url = f"https://registry.hub.docker.com/v2/repositories/{image_info['namespace']}/{image_info['name']}/tags/"
            
            all_tags = []
            
            # Docker Hub paginates results
            while url:
                response = requests.get(url, timeout=10)
                response.raise_for_status()
                
                data = response.json()
                tags = [tag['name'] for tag in data.get('results', [])]
                all_tags.extend(tags)
                
                url = data.get('next')  # Next page
                
                # Limit to avoid excessive API calls
                if len(all_tags) > 100:
                    break
            
            return all_tags
            
        except Exception as e:
            logger.debug(f"Failed to get Docker Hub tags: {e}")
            return []
    
    def find_latest_version_tag(self, tags: List[str], current_tag: str) -> Optional[str]:
        """Find the latest version tag from a list of tags"""
        try:
            # Filter to version-like tags only
            version_tags = [tag for tag in tags if self.is_version_tag(tag)]
            
            if not version_tags:
                return None
            
            # Sort versions (simple string sort works for most cases)
            # For more complex version sorting, could use packaging.version
            version_tags.sort(key=self.version_sort_key, reverse=True)
            
            # Find latest that's newer than current
            current_sort_key = self.version_sort_key(current_tag)
            
            for tag in version_tags:
                if self.version_sort_key(tag) > current_sort_key:
                    return tag
            
            return None
            
        except Exception as e:
            logger.debug(f"Failed to find latest version: {e}")
            return None
    
    def version_sort_key(self, version: str):
        """Create sort key for version string"""
        try:
            # Remove 'v' prefix if present
            clean_version = version.lstrip('v')
            
            # Split into parts and convert to integers where possible
            parts = []
            for part in clean_version.split('.'):
                # Extract numeric part
                numeric_part = re.match(r'(\d+)', part)
                if numeric_part:
                    parts.append(int(numeric_part.group(1)))
                else:
                    parts.append(0)
            
            # Pad to ensure consistent comparison
            while len(parts) < 3:
                parts.append(0)
            
            return tuple(parts)
            
        except Exception:
            # Fallback to string comparison
            return (version,)
    
    def check_generic_tag_update(self, container: Dict, image_info: Dict) -> Dict:
        """Check for updates on non-version, non-latest tags"""
        # For generic tags, we can't easily determine if updates are available
        # unless we check image digests, which requires registry API access
        return {
            'update_available': False,
            'reason': 'generic_tag_no_check',
            'current_tag': image_info['tag'],
            'last_checked': time.time()
        }
    
    def check_registry_update(self, container: Dict, image_info: Dict) -> Dict:
        """Check non-Docker Hub registries for updates"""
        # Implementation would depend on the specific registry API
        # GitHub Container Registry, Azure Container Registry, etc. have different APIs
        return {
            'update_available': False,
            'reason': 'registry_not_supported',
            'last_checked': time.time()
        }
    
    def save_update_cache(self, update_results: Dict):
        """Save update check results to cache"""
        try:
            with open(self.update_cache_file, 'w') as f:
                json.dump(update_results, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save update cache: {e}")
    
    def load_update_cache(self) -> Dict:
        """Load cached update results"""
        try:
            if os.path.exists(self.update_cache_file):
                with open(self.update_cache_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.debug(f"Failed to load update cache: {e}")
        
        return {'containers': {}, 'last_check': 0}
    
    def update_container(self, container_id: str, host: str, target_tag: str, host_manager) -> Dict:
        """Update a specific container to a new tag"""
        try:
            logger.info(f"Updating container {container_id} on {host} to {target_tag}")
            
            client = host_manager.get_client(host)
            if not client:
                return {
                    'success': False,
                    'error': f'Host {host} not available'
                }
            
            container = client.containers.get(container_id)
            
            # Check if it's a compose-managed container
            labels = container.labels or {}
            if labels.get('com.docker.compose.project'):
                return self.update_compose_container(container, target_tag, host_manager)
            else:
                return self.update_standalone_container(container, target_tag, client)
                
        except Exception as e:
            logger.error(f"Failed to update container {container_id}: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def update_compose_container(self, container, target_tag: str, host_manager) -> Dict:
        """Update a compose-managed container"""
        try:
            labels = container.labels
            project = labels.get('com.docker.compose.project')
            service = labels.get('com.docker.compose.service')
            config_file = labels.get('com.docker.compose.project.config_files')
            
            if not all([project, service, config_file]):
                return {
                    'success': False,
                    'error': 'Missing compose metadata'
                }
            
            if not os.path.exists(config_file):
                return {
                    'success': False,
                    'error': f'Compose file not found: {config_file}'
                }
            
            # Update the compose file
            update_result = self.update_compose_file_image(config_file, service, target_tag)
            
            if not update_result['success']:
                return update_result
            
            # Deploy the updated compose
            return self.deploy_updated_compose(config_file, service, container.attrs.get('Config', {}).get('Hostname', 'local'))
            
        except Exception as e:
            logger.error(f"Failed to update compose container: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def update_compose_file_image(self, compose_file: str, service: str, target_tag: str) -> Dict:
        """Update image tag in compose file"""
        try:
            # Backup original file
            backup_file = f"{compose_file}.backup-{int(time.time())}"
            with open(compose_file, 'r') as src, open(backup_file, 'w') as dst:
                dst.write(src.read())
            
            # Load and modify compose file
            with open(compose_file, 'r') as f:
                compose_data = yaml.safe_load(f)
            
            if 'services' not in compose_data or service not in compose_data['services']:
                return {
                    'success': False,
                    'error': f'Service {service} not found in compose file'
                }
            
            service_config = compose_data['services'][service]
            
            if 'image' not in service_config:
                return {
                    'success': False,
                    'error': f'No image specified for service {service}'
                }
            
            # Update the image tag
            current_image = service_config['image']
            image_parts = current_image.split(':')
            
            if len(image_parts) >= 2:
                # Replace the tag
                new_image = ':'.join(image_parts[:-1]) + ':' + target_tag
            else:
                # Add the tag
                new_image = current_image + ':' + target_tag
            
            service_config['image'] = new_image
            
            # Save updated compose file
            with open(compose_file, 'w') as f:
                yaml.dump(compose_data, f, default_flow_style=False, sort_keys=False)
            
            logger.info(f"Updated {service} image: {current_image} -> {new_image}")
            
            return {
                'success': True,
                'backup_file': backup_file,
                'old_image': current_image,
                'new_image': new_image
            }
            
        except Exception as e:
            logger.error(f"Failed to update compose file: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def deploy_updated_compose(self, compose_file: str, service: str, host: str) -> Dict:
        """Deploy updated compose configuration"""
        try:
            compose_dir = os.path.dirname(compose_file)
            compose_filename = os.path.basename(compose_file)
            
            # Setup environment for compose command
            env = os.environ.copy()
            
            # Set DOCKER_HOST for remote hosts
            if host != 'local':
                # This would need integration with your host_manager
                host_config = {}  # Get from host_manager
                docker_url = host_config.get('url', '')
                if docker_url:
                    env['DOCKER_HOST'] = docker_url
            
            # Pull new image
            pull_cmd = ['docker-compose', '-f', compose_filename, 'pull', service]
            pull_result = subprocess.run(
                pull_cmd,
                cwd=compose_dir,
                env=env,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if pull_result.returncode != 0:
                logger.warning(f"Pull warnings: {pull_result.stderr}")
            
            # Recreate the service
            up_cmd = ['docker-compose', '-f', compose_filename, 'up', '-d', '--force-recreate', service]
            up_result = subprocess.run(
                up_cmd,
                cwd=compose_dir,
                env=env,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if up_result.returncode == 0:
                return {
                    'success': True,
                    'message': f'Successfully updated and restarted {service}',
                    'output': up_result.stdout
                }
            else:
                return {
                    'success': False,
                    'error': f'Deploy failed: {up_result.stderr}',
                    'output': up_result.stdout
                }
                
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': 'Update deployment timed out'
            }
        except Exception as e:
            logger.error(f"Failed to deploy updated compose: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def update_standalone_container(self, container, target_tag: str, client) -> Dict:
        """Update a standalone (non-compose) container"""
        try:
            # Get container configuration
            container_config = container.attrs
            
            # Build new image name
            current_image = container_config['Config']['Image']
            image_parts = current_image.split(':')
            
            if len(image_parts) >= 2:
                new_image = ':'.join(image_parts[:-1]) + ':' + target_tag
            else:
                new_image = current_image + ':' + target_tag
            
            # Pull new image
            try:
                client.images.pull(new_image)
            except Exception as e:
                return {
                    'success': False,
                    'error': f'Failed to pull image {new_image}: {str(e)}'
                }
            
            # Stop and remove old container
            was_running = container.status == 'running'
            if was_running:
                container.stop()
            
            old_name = container.name
            container.remove()
            
            # Recreate container with new image
            host_config = container_config.get('HostConfig', {})
            config = container_config.get('Config', {})
            
            new_container = client.containers.run(
                image=new_image,
                name=old_name,
                detach=True,
                ports=host_config.get('PortBindings', {}),
                volumes=host_config.get('Binds', []),
                environment=config.get('Env', []),
                restart_policy=host_config.get('RestartPolicy', {}),
                network_mode=host_config.get('NetworkMode', 'default'),
                command=config.get('Cmd'),
                entrypoint=config.get('Entrypoint'),
                working_dir=config.get('WorkingDir'),
                labels=config.get('Labels', {})
            )
            
            return {
                'success': True,
                'message': f'Successfully updated {old_name} to {new_image}',
                'old_image': current_image,
                'new_image': new_image,
                'new_container_id': new_container.short_id
            }
            
        except Exception as e:
            logger.error(f"Failed to update standalone container: {e}")
            return {
                'success': False,
                'error': str(e)
            }
        
def is_safe_update(self, current_version: str, new_version: str) -> bool:
    """Check if update is safe (patch version only)"""
    try:
        # Remove 'v' prefix if present
        current = current_version.lstrip('v')
        new = new_version.lstrip('v')
        
        # Parse versions (e.g., "1.2.3" -> [1, 2, 3])
        current_parts = [int(x) for x in current.split('.')]
        new_parts = [int(x) for x in new.split('.')]
        
        # Pad to same length
        while len(current_parts) < 3:
            current_parts.append(0)
        while len(new_parts) < 3:
            new_parts.append(0)
        
        # Safe update = same major.minor, higher patch
        # 1.2.3 → 1.2.4 ✅ Safe
        # 1.2.3 → 1.3.0 ❌ Not safe (minor change)
        # 1.2.3 → 2.0.0 ❌ Not safe (major change)
        
        if current_parts[0] == new_parts[0] and current_parts[1] == new_parts[1]:
            # Same major.minor, check if patch is higher
            return new_parts[2] > current_parts[2]
        
        return False
        
    except (ValueError, IndexError):
        # If we can't parse versions, not safe
        return False

def should_auto_update(self, container: Dict, update_info: Dict) -> bool:
    """Check if container should be auto-updated"""
    try:
        # Must be enabled
        if not self.settings.get('auto_update_enabled', False):
            return False
        
        # Skip if explicitly excluded
        image_info = self.parse_image_name(container['image_full'])
        if self.should_skip_image(image_info, container['name']):
            return False
        
        # Only auto-update if it's a safe update
        if update_info.get('current_tag') and update_info.get('latest_tag'):
            if not self.is_safe_update(update_info['current_tag'], update_info['latest_tag']):
                logger.info(f"Skipping auto-update for {container['name']}: not a safe patch update")
                return False
        
        # Check auto-update patterns
        auto_tags = self.settings.get('auto_update_tags', ['stable', 'prod'])
        if auto_tags:
            current_tag = update_info.get('current_tag', '')
            tag_matches = any(pattern.lower() in current_tag.lower() for pattern in auto_tags)
            if not tag_matches:
                logger.info(f"Skipping auto-update for {container['name']}: tag doesn't match auto-update patterns")
                return False
        
        return True
        
    except Exception as e:
        logger.error(f"Error checking auto-update for {container['name']}: {e}")
        return False

def should_scheduled_repull(self, container: Dict) -> bool:
    """Check if container should be repulled on schedule"""
    try:
        # Must be enabled
        if not self.settings.get('scheduled_repull_enabled', False):
            return False
        
        # Skip if explicitly excluded
        image_info = self.parse_image_name(container['image_full'])
        if self.should_skip_image(image_info, container['name']):
            return False
        
        # Check repull patterns
        repull_tags = self.settings.get('repull_tags', ['latest', 'main', 'stable'])
        if repull_tags:
            current_tag = image_info.get('tag', '')
            tag_matches = any(pattern.lower() in current_tag.lower() for pattern in repull_tags)
            if not tag_matches:
                return False
        
        # Check if enough time has passed since last repull
        last_repull = container.get('last_repull', 0)
        repull_interval = self.settings.get('repull_interval_hours', 24) * 3600
        
        return (time.time() - last_repull) >= repull_interval
        
    except Exception as e:
        logger.error(f"Error checking scheduled repull for {container['name']}: {e}")
        return False

def perform_auto_updates(self, host_manager) -> Dict:
    """Perform automatic safe updates and scheduled repulls"""
    try:
        logger.info("Performing automatic updates and scheduled repulls...")
        
        # Get all containers
        containers = self.get_all_containers_with_images(host_manager)
        if not containers:
            return {'auto_updates': 0, 'repulls': 0, 'errors': 0}
        
        # Check for updates first
        update_results = self.check_for_container_updates(containers)
        
        auto_updates = 0
        repulls = 0
        errors = 0
        
        # Process each container
        for container in containers:
            container_key = f"{container['host']}:{container['name']}"
            update_info = update_results['containers'].get(container_key, {})
            
            try:
                # 1. Check for auto-updates (safe version bumps)
                if update_info.get('update_available') and self.should_auto_update(container, update_info):
                    logger.info(f"Auto-updating {container['name']} from {update_info['current_tag']} to {update_info['latest_tag']}")
                    
                    result = self.update_container(
                        container_id=container['id'],
                        host=container['host'],
                        target_tag=update_info['latest_tag'],
                        host_manager=host_manager
                    )
                    
                    if result['success']:
                        auto_updates += 1
                        logger.info(f"Successfully auto-updated {container['name']}")
                    else:
                        errors += 1
                        logger.error(f"Auto-update failed for {container['name']}: {result['error']}")
                
                # 2. Check for scheduled repulls (same version, fresh image)
                elif self.should_scheduled_repull(container):
                    logger.info(f"Scheduled repull for {container['name']}")
                    
                    # Use repull endpoint instead of update
                    # This pulls the same tag but gets the latest image
                    result = self.repull_container(
                        container_id=container['id'],
                        host=container['host'],
                        host_manager=host_manager
                    )
                    
                    if result['success']:
                        repulls += 1
                        # Update last repull time
                        container['last_repull'] = time.time()
                        logger.info(f"Successfully repulled {container['name']}")
                    else:
                        errors += 1
                        logger.error(f"Scheduled repull failed for {container['name']}: {result['error']}")
                        
            except Exception as e:
                errors += 1
                logger.error(f"Error processing {container['name']}: {e}")
        
        result = {
            'auto_updates': auto_updates,
            'repulls': repulls,
            'errors': errors,
            'timestamp': time.time()
        }
        
        if auto_updates > 0 or repulls > 0:
            logger.info(f"Automatic maintenance completed: {auto_updates} updates, {repulls} repulls, {errors} errors")
        
        return result
        
    except Exception as e:
        logger.error(f"Error in perform_auto_updates: {e}")
        return {'auto_updates': 0, 'repulls': 0, 'errors': 1}

def repull_container(self, container_id: str, host: str, host_manager) -> Dict:
    """Repull same version of container (for latest tags, etc.)"""
    try:
        client = host_manager.get_client(host)
        if not client:
            return {'success': False, 'error': f'Host {host} not available'}
        
        container = client.containers.get(container_id)
        current_image = container.image.tags[0] if container.image.tags else container.image.id
        
        logger.info(f"Repulling {current_image} for container {container.name}")
        
        # Check if it's compose-managed
        labels = container.labels or {}
        if labels.get('com.docker.compose.project'):
            # Use compose to repull
            return self.repull_compose_container(container, host_manager)
        else:
            # Repull standalone container
            return self.repull_standalone_container(container, current_image, client)
            
    except Exception as e:
        logger.error(f"Failed to repull container {container_id}: {e}")
        return {'success': False, 'error': str(e)}

def repull_compose_container(self, container, host_manager) -> Dict:
    """Repull compose-managed container"""
    try:
        labels = container.labels
        project = labels.get('com.docker.compose.project')
        service = labels.get('com.docker.compose.service')
        config_file = labels.get('com.docker.compose.project.config_files')
        
        if not all([project, service, config_file]) or not os.path.exists(config_file):
            return {'success': False, 'error': 'Missing compose metadata or file'}
        
        # Use compose to pull and recreate
        compose_dir = os.path.dirname(config_file)
        compose_filename = os.path.basename(config_file)
        
        # Setup environment
        env = os.environ.copy()
        env["COMPOSE_PROJECT_NAME"] = project
        
        # Pull latest image
        pull_cmd = ['docker-compose', '-f', compose_filename, 'pull', service]
        pull_result = subprocess.run(pull_cmd, cwd=compose_dir, env=env, capture_output=True, text=True, timeout=300)
        
        if pull_result.returncode != 0:
            logger.warning(f"Pull warnings for {service}: {pull_result.stderr}")
        
        # Recreate service
        up_cmd = ['docker-compose', '-f', compose_filename, 'up', '-d', '--force-recreate', service]
        up_result = subprocess.run(up_cmd, cwd=compose_dir, env=env, capture_output=True, text=True, timeout=300)
        
        if up_result.returncode == 0:
            return {'success': True, 'message': f'Successfully repulled {service}'}
        else:
            return {'success': False, 'error': f'Recreate failed: {up_result.stderr}'}
            
    except Exception as e:
        logger.error(f"Failed to repull compose container: {e}")
        return {'success': False, 'error': str(e)}

def repull_standalone_container(self, container, current_image: str, client) -> Dict:
    """Repull standalone container with same image tag"""
    try:
        # Pull the same image tag
        client.images.pull(current_image)
        
        # Get container config
        container_config = container.attrs
        host_config = container_config.get('HostConfig', {})
        config = container_config.get('Config', {})
        
        # Stop and remove old container
        was_running = container.status == 'running'
        if was_running:
            container.stop()
        
        old_name = container.name
        container.remove()
        
        # Create new container with same config
        new_container = client.containers.run(
            image=current_image,
            name=old_name,
            detach=True,
            ports=host_config.get('PortBindings', {}),
            volumes=host_config.get('Binds', []),
            environment=config.get('Env', []),
            restart_policy=host_config.get('RestartPolicy', {}),
            network_mode=host_config.get('NetworkMode', 'default'),
            command=config.get('Cmd'),
            entrypoint=config.get('Entrypoint'),
            working_dir=config.get('WorkingDir'),
            labels=config.get('Labels', {})
        )
        
        return {
            'success': True,
            'message': f'Successfully repulled {old_name}',
            'new_container_id': new_container.short_id
        }
        
    except Exception as e:
        logger.error(f"Failed to repull standalone container: {e}")
        return {'success': False, 'error': str(e)}        