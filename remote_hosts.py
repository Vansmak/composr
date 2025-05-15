# remote_hosts.py
import os
import docker
import logging
import threading
import time

logger = logging.getLogger(__name__)

class DockerHostManager:
    def __init__(self):
        # Parse hosts from environment
        self.hosts = self._parse_hosts()
        
        # Load and merge saved hosts
        saved_hosts = self._load_saved_hosts()
        self.hosts.update(saved_hosts)
        
        self.current_host = 'local'
        self.clients = {}
        self._initialized = False
        
        # Start initialization in background
        init_thread = threading.Thread(target=self._initialize_clients)
        init_thread.daemon = True
        init_thread.start()
    
    def _parse_hosts(self):
        """Parse DOCKER_HOSTS environment variable"""
        hosts_config = os.getenv('DOCKER_HOSTS', 'local=unix:///var/run/docker.sock')
        hosts = {}
        
        for entry in hosts_config.split(','):
            if '=' in entry:
                name, url = entry.split('=', 1)
                hosts[name.strip()] = url.strip()
        
        return hosts
    
    def _initialize_clients(self):
        """Initialize clients in background"""
        # Always initialize local first
        try:
            local_url = self.hosts.get('local', 'unix:///var/run/docker.sock')
            client = docker.DockerClient(base_url=local_url, timeout=5)
            self.clients['local'] = client
            logger.info("Connected to local Docker")
        except Exception as e:
            logger.error(f"Failed to connect to local Docker: {e}")
        
        self._initialized = True
    
    def get_client(self, host_name=None):
        """Get Docker client for specified host"""
        if host_name is None:
            host_name = self.current_host
        
        # Wait for initialization if needed
        while not self._initialized and host_name == 'local':
            time.sleep(0.1)
        
        # Return existing client or create on demand
        if host_name in self.clients:
            return self.clients[host_name]
        
        # Try to create client on demand
        if host_name in self.hosts:
            try:
                client = docker.DockerClient(base_url=self.hosts[host_name], timeout=5)
                self.clients[host_name] = client
                return client
            except Exception as e:
                logger.warning(f"Failed to connect to {host_name}: {e}")
                return None
        
        return None
    
    def switch_host(self, host_name):
        """Switch to a different Docker host"""
        if host_name not in self.hosts:
            raise ValueError(f"Unknown host: {host_name}")
        
        client = self.get_client(host_name)
        if client is None:
            raise ConnectionError(f"Cannot connect to {host_name}")
        
        self.current_host = host_name
        return client
    
    def get_hosts_status(self):
        """Get status of all configured hosts"""
        status = {}
        for name, url in self.hosts.items():
            status[name] = {
                'connected': name in self.clients and self.clients[name] is not None,
                'current': name == self.current_host,
                'url': url if isinstance(url, str) else url.get('url', '')
            }
        return status
    
    def add_host(self, name, url, group=None):
        """Add a new Docker host"""
        if name in self.hosts:
            raise ValueError(f"Host '{name}' already exists")
        
        # Add to hosts - just store the URL string
        self.hosts[name] = url
        
        # Save to persistent storage
        self._save_hosts()
        
        logger.info(f"Added new host '{name}' at {url}")
        return True
    
    def remove_host(self, name):
        """Remove a Docker host"""
        if name == 'local':
            raise ValueError("Cannot remove local host")
        
        if name not in self.hosts:
            raise ValueError(f"Host '{name}' not found")
        
        # Remove from hosts and clients
        del self.hosts[name]
        if name in self.clients:
            del self.clients[name]
        
        # If it was the current host, switch to local
        if self.current_host == name:
            self.current_host = 'local'
        
        # Save to persistent storage
        self._save_hosts()
        
        logger.info(f"Removed host '{name}'")
        return True
    
    def _save_hosts(self):
        """Save hosts configuration to file"""
        import json
        metadata_dir = os.environ.get('METADATA_DIR', '/app')
        hosts_file = os.path.join(metadata_dir, 'docker_hosts.json')
        
        try:
            # Only save non-env hosts
            saved_hosts = {}
            env_hosts = self._parse_hosts()
            
            for name, url in self.hosts.items():
                if name not in env_hosts:
                    saved_hosts[name] = url
            
            with open(hosts_file, 'w') as f:
                json.dump(saved_hosts, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save hosts: {e}")
    
    def _load_saved_hosts(self):
        """Load hosts from file"""
        import json
        metadata_dir = os.environ.get('METADATA_DIR', '/app')
        hosts_file = os.path.join(metadata_dir, 'docker_hosts.json')
        
        saved_hosts = {}
        if os.path.exists(hosts_file):
            try:
                with open(hosts_file, 'r') as f:
                    saved_hosts = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load saved hosts: {e}")
        
        return saved_hosts

# Global instance
host_manager = DockerHostManager()