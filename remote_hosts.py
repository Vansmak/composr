import docker
import logging
import threading
import time
import json
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class HostManager:
    def __init__(self, metadata_dir=None):  
        if metadata_dir is None:
            metadata_dir = os.environ.get('METADATA_DIR', '/app/data') 
            
        self.clients = {}
        self.host_configs = {}
        self.connection_status = {}
        self.last_health_check = {}
        self.current_host = 'local'
        self.metadata_dir = metadata_dir
        self.hosts_file = os.path.join(metadata_dir, 'docker_hosts.json')
        self._lock = threading.Lock()
        
        # Initialize with local Docker
        self._initialize_local_docker()
        
        # Load saved hosts
        self._load_hosts_from_file()
        
        # Start health check thread
        self._start_health_checker()
    
    def _initialize_local_docker(self):
        """Initialize local Docker connection"""
        try:
            # Try different socket paths
            socket_paths = [
                'unix:///var/run/docker.sock',
                'unix:///run/docker.sock'
            ]
            
            local_client = None
            for socket_path in socket_paths:
                try:
                    local_client = docker.DockerClient(base_url=socket_path, timeout=10)
                    local_client.ping()
                    logger.info(f"Connected to local Docker at {socket_path}")
                    break
                except Exception as e:
                    logger.debug(f"Failed to connect to {socket_path}: {e}")
                    continue
            
            if local_client:
                self.clients['local'] = local_client
                self.host_configs['local'] = {
                    'type': 'local',
                    'url': socket_paths[0],
                    'name': 'Local Docker',
                    'added_at': datetime.now(timezone.utc).isoformat()
                }
                self.connection_status['local'] = True
                self.last_health_check['local'] = time.time()
            else:
                logger.error("Failed to connect to local Docker")
                raise Exception("Could not connect to local Docker daemon")
                
        except Exception as e:
            logger.error(f"Error initializing local Docker: {e}")
            raise
    
    def _load_hosts_from_file(self):
        """Load host configurations from file"""
        try:
            if os.path.exists(self.hosts_file):
                with open(self.hosts_file, 'r') as f:
                    saved_hosts = json.load(f)
                
                for host_name, config in saved_hosts.items():
                    if host_name != 'local':  # Don't override local config
                        self.host_configs[host_name] = config
                        # Try to connect to saved hosts
                        if self._test_connection(config):
                            self._create_client(host_name, config)
                        else:
                            self.connection_status[host_name] = False
                            logger.warning(f"Saved host {host_name} is not reachable")
        except Exception as e:
            logger.error(f"Error loading hosts from file: {e}")
    
    def _save_hosts_to_file(self):
        """Save host configurations to file"""
        try:
            # Only save non-local hosts
            hosts_to_save = {
                name: config for name, config in self.host_configs.items() 
                if name != 'local'
            }
            
            with open(self.hosts_file, 'w') as f:
                json.dump(hosts_to_save, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving hosts to file: {e}")
    
    def add_host(self, name, url, description=None):
        """Add and test new Docker host connection"""
        with self._lock:
            if name in self.host_configs:
                return False, f"Host {name} already exists"
            
            config = {
                'type': 'tcp',
                'url': url,
                'name': description or name,
                'added_at': datetime.now(timezone.utc).isoformat()
            }
            
            if self._test_connection(config):
                if self._create_client(name, config):
                    self.host_configs[name] = config
                    self.connection_status[name] = True
                    self.last_health_check[name] = time.time()
                    self._save_hosts_to_file()
                    logger.info(f"Successfully added host {name}")
                    return True, f"Host {name} added successfully"
                else:
                    return False, f"Failed to create client for {name}"
            else:
                return False, f"Could not connect to {name} at {url}"
    
    def remove_host(self, name):
        """Remove a Docker host"""
        with self._lock:
            if name == 'local':
                return False, "Cannot remove local host"
            
            if name not in self.host_configs:
                return False, f"Host {name} not found"
            
            # Close client connection
            if name in self.clients:
                try:
                    self.clients[name].close()
                except:
                    pass
                del self.clients[name]
            
            # Remove from configs
            del self.host_configs[name]
            if name in self.connection_status:
                del self.connection_status[name]
            if name in self.last_health_check:
                del self.last_health_check[name]
            
            # Switch to local if this was current host
            if self.current_host == name:
                self.current_host = 'local'
            
            self._save_hosts_to_file()
            logger.info(f"Removed host {name}")
            return True, f"Host {name} removed successfully"
    
    def switch_host(self, host_name):
        """Switch current host context"""
        if host_name not in self.clients:
            raise Exception(f"Host {host_name} not available")
        
        if not self.connection_status.get(host_name, False):
            raise Exception(f"Host {host_name} is not connected")
        
        self.current_host = host_name
        logger.info(f"Switched to host {host_name}")
        return self.clients[host_name]
    
    def get_client(self, host_name=None):
        """Get Docker client for specific host or current host"""
        target_host = host_name or self.current_host
        
        if target_host not in self.clients:
            logger.error(f"Host {target_host} not found in clients")
            return None  # Don't fall back, return None
        
        if not self.connection_status.get(target_host, False):
            logger.error(f"Host {target_host} not connected")
            return None  # Don't fall back, return None
        
        return self.clients[target_host]
    
    def get_all_containers(self):
        """Get containers from all connected hosts"""
        all_containers = []
        
        for host_name, client in self.clients.items():
            if self.connection_status.get(host_name, False):
                try:
                    containers = client.containers.list(all=True)
                    for container in containers:
                        # Add host identifier to each container
                        container._host = host_name
                    all_containers.extend(containers)
                except Exception as e:
                    logger.error(f"Failed to get containers from host {host_name}: {e}")
                    self.connection_status[host_name] = False
        
        return all_containers
    
    def get_hosts_status(self):
        """Get status of all hosts"""
        status = {}
        for host_name in self.host_configs:
            config = self.host_configs[host_name]
            status[host_name] = {
                'name': config.get('name', host_name),
                'url': config.get('url', ''),
                'type': config.get('type', 'unknown'),
                'connected': self.connection_status.get(host_name, False),
                'last_check': self.last_health_check.get(host_name, 0),
                'current': host_name == self.current_host
            }
        return status
    
    def get_connected_hosts(self):
        """Get list of currently connected host names"""
        return [
            name for name, status in self.connection_status.items() 
            if status
        ]
    
    def test_host_connection(self, url):
        """Test connection to a Docker host without adding it"""
        config = {'url': url, 'type': 'tcp'}
        return self._test_connection(config)
    
    def _test_connection(self, config):
        """Test Docker host connectivity"""
        try:
            test_client = docker.DockerClient(base_url=config['url'], timeout=5)
            test_client.ping()
            test_client.close()
            return True
        except Exception as e:
            logger.debug(f"Connection test failed for {config['url']}: {e}")
            return False
    
    def _create_client(self, host_name, config):
        """Create and store Docker client"""
        try:
            client = docker.DockerClient(base_url=config['url'], timeout=10)
            client.ping()  # Verify connection
            self.clients[host_name] = client
            return True
        except Exception as e:
            logger.error(f"Failed to create client for {host_name}: {e}")
            return False
    
    def _start_health_checker(self):
        """Start background health check thread"""
        def health_check_worker():
            while True:
                try:
                    self._perform_health_check()
                except Exception as e:
                    logger.error(f"Health check error: {e}")
                time.sleep(30)  # Check every 30 seconds
        
        health_thread = threading.Thread(target=health_check_worker, daemon=True)
        health_thread.start()
        logger.info("Started health check thread")
    
    def _perform_health_check(self):
        """Check health of all host connections"""
        current_time = time.time()
        
        for host_name, config in self.host_configs.items():
            try:
                if host_name in self.clients:
                    # Test existing connection
                    self.clients[host_name].ping()
                    self.connection_status[host_name] = True
                    self.last_health_check[host_name] = current_time
                else:
                    # Try to reconnect
                    if self._test_connection(config):
                        if self._create_client(host_name, config):
                            self.connection_status[host_name] = True
                            self.last_health_check[host_name] = current_time
                            logger.info(f"Reconnected to host {host_name}")
                    else:
                        self.connection_status[host_name] = False
            except Exception as e:
                logger.warning(f"Health check failed for {host_name}: {e}")
                self.connection_status[host_name] = False
                
                # Try to reconnect
                if host_name in self.clients:
                    try:
                        self.clients[host_name].close()
                    except:
                        pass
                    del self.clients[host_name]

# Global instance
host_manager = HostManager()