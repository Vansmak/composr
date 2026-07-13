import json
import os
import re
import tempfile
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
        
        # Only allow these specific filenames
        valid_filenames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
        
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
                    # Only include files that match exactly our valid filenames
                    if file in valid_filenames:
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
        raise

# Apply same fix to scan_all_compose_files function
def scan_all_compose_files(compose_dir, extra_dirs, logger):
    """Scan for all compose files, returning relative paths"""
    try:
        compose_files = []
        search_dirs = [compose_dir] + [d for d in extra_dirs if d]
        
        # Only allow these specific filenames
        valid_filenames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
        
        for search_dir in search_dirs:
            if not os.path.exists(search_dir):
                logger.warning(f"Scan directory doesn't exist: {search_dir}")
                continue
                
            for root, dirs, files in os.walk(search_dir, topdown=True):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for file in files:
                    # Only include files that match exactly our valid filenames
                    if file in valid_filenames:
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

def is_path_within_allowed_dirs(full_path, compose_dir, extra_dirs):
    """Check that full_path resolves inside compose_dir or one of extra_dirs.

    Guards the compose/env file read+write endpoints against an absolute path or a
    '../' relative path escaping the intended directory tree. Uses realpath so
    symlinks and unnormalized '..' segments can't slip through, and so a sibling
    directory that merely shares a prefix (e.g. compose vs compose-evil) isn't
    mistaken for a subdirectory.
    """
    allowed_roots = [os.path.realpath(compose_dir)]
    for d in (extra_dirs or []):
        if d:
            allowed_roots.append(os.path.realpath(d))

    real_path = os.path.realpath(full_path)
    return any(
        real_path == root or real_path.startswith(root + os.sep)
        for root in allowed_roots
    )

def resolve_compose_file_path(file_path, compose_dir, extra_dirs, logger):
    """Resolve the full path of a compose file by checking configured directories.

    Only returns a path that is actually contained within compose_dir or one of
    extra_dirs (see is_path_within_allowed_dirs) - an absolute or '../' path that
    escapes those roots is rejected even if it happens to exist on disk.
    """
    logger.debug(f"Resolving compose file path: {file_path}")
    file_path = file_path.replace('\\', '/')

    def _contained(path):
        return is_path_within_allowed_dirs(path, compose_dir, extra_dirs)

    if os.path.isabs(file_path):
        if os.path.exists(file_path) and _contained(file_path):
            logger.debug(f"Found absolute path: {file_path}")
            return file_path
        try:
            relative_path = os.path.relpath(file_path, compose_dir)
            full_path = os.path.join(compose_dir, relative_path)
            if os.path.exists(full_path) and _contained(full_path):
                logger.debug(f"Found file after converting absolute to relative: {full_path}")
                return full_path
        except ValueError:
            pass
        logger.debug(f"Absolute path does not exist or is outside allowed directories: {file_path}")
    search_dirs = [compose_dir] + [d for d in extra_dirs if d]
    for search_dir in search_dirs:
        full_path = os.path.join(search_dir, file_path)
        if os.path.exists(full_path) and _contained(full_path):
            logger.debug(f"Found file at: {full_path}")
            return full_path
        logger.debug(f"File not found at: {full_path}")
    logger.warning(f"Could not resolve compose file: {file_path}")
    return None


# --- Service-centric compose editing: profiles, service blocks, atomic writes ---
#
# These NEVER use yaml.safe_load + yaml.dump to rewrite a file - that destroys
# comments and formatting. yaml.safe_load is only used for READING (get_stack_profiles,
# and validating a write's result). All modifications are line-based text operations.

_SERVICES_KEY_RE = re.compile(r'^services:\s*(#.*)?$')


def _detect_compose_indent(lines):
    """Find the services: section and its indentation. Returns
    (services_idx, service_indent, property_indent) or None if services: isn't found.
    property_indent is the indentation of a service's own keys (e.g. `image:`) - may
    be None if no service has any properties (unlikely, but degrade gracefully).
    Detected from the file itself rather than assumed, since indent width varies.
    """
    services_idx = None
    for i, line in enumerate(lines):
        if _SERVICES_KEY_RE.match(line.rstrip('\n')):
            services_idx = i
            break
    if services_idx is None:
        return None

    service_indent = None
    for i in range(services_idx + 1, len(lines)):
        stripped = lines[i].strip()
        if not stripped or stripped.startswith('#'):
            continue
        service_indent = len(lines[i]) - len(lines[i].lstrip(' '))
        break
    if not service_indent:
        return None

    property_indent = None
    at_service_level = False
    for i in range(services_idx + 1, len(lines)):
        raw = lines[i].rstrip('\n')
        stripped = raw.strip()
        if not stripped:
            continue
        indent = len(raw) - len(raw.lstrip(' '))
        if indent == service_indent and re.match(r'^\s*[\w.-]+:\s*(#.*)?$', raw):
            at_service_level = True
            continue
        if at_service_level and indent > service_indent:
            property_indent = indent
            break
        if indent <= service_indent:
            at_service_level = False

    return services_idx, service_indent, property_indent


def find_service_block(file_path, service_name):
    """Locate a service's block in a compose file by indentation, line-based.

    Returns (start_line, end_line) as 0-indexed, inclusive line numbers spanning
    from the service's "name:" declaration through the last line that belongs to
    it (including trailing blank/whitespace-only lines), or None if services:
    or the named service isn't found. Matches the service name exactly (fully
    anchored regex) - a search for "sonarr" can never match "sonarr-backup".
    """
    with open(file_path, 'r') as f:
        lines = f.readlines()

    indent_info = _detect_compose_indent(lines)
    if not indent_info:
        return None
    services_idx, service_indent, _ = indent_info

    service_key_re = re.compile(r'^' + ' ' * service_indent + re.escape(service_name) + r':\s*(#.*)?$')

    start_line = None
    for i in range(services_idx + 1, len(lines)):
        if service_key_re.match(lines[i].rstrip('\n')):
            start_line = i
            break
    if start_line is None:
        return None

    end_line = len(lines) - 1
    for i in range(start_line + 1, len(lines)):
        raw = lines[i].rstrip('\n')
        stripped = raw.strip()
        if not stripped:
            continue
        indent = len(raw) - len(raw.lstrip(' '))
        if indent <= service_indent:
            end_line = i - 1
            break

    return start_line, end_line


def get_stack_profiles(compose_path):
    """Parse a compose file's services and their `profiles:` declarations.
    Read-only (yaml.safe_load) - this never rewrites the file.

    Returns {'core': [service names with no profiles key],
             'profiles': {profile_name: [service names]}}.
    """
    with open(compose_path, 'r') as f:
        data = yaml.safe_load(f)

    core = []
    profiles = {}
    for name, cfg in ((data or {}).get('services') or {}).items():
        if not isinstance(cfg, dict):
            continue
        service_profiles = cfg.get('profiles')
        if not service_profiles:
            core.append(name)
        else:
            for profile_name in service_profiles:
                profiles.setdefault(profile_name, []).append(name)

    return {'core': core, 'profiles': profiles}


def _services_for_project(host_client, project_name):
    """Set of service names (from com.docker.compose.service labels) that have
    a container - running or not - for the given compose project on this host."""
    present = set()
    for container in host_client.containers.list(all=True):
        labels = container.labels or {}
        if labels.get('com.docker.compose.project') == project_name:
            service = labels.get('com.docker.compose.service')
            if service:
                present.add(service)
    return present


def infer_active_profiles(compose_path, project_name, host_client):
    """Infer which profiles are currently active by checking which profile-gated
    services actually have a container for this project. A profile counts as
    active if any of its services has one. Used so the UI reflects reality even
    if it was deployed from the terminal or metadata is stale."""
    stack = get_stack_profiles(compose_path)
    present = _services_for_project(host_client, project_name)
    return sorted(name for name, services in stack['profiles'].items() if present & set(services))


def compute_profile_deselection_diff(compose_path, project_name, selected_profiles, host_client):
    """Determine which services need an explicit stop+rm before 'up', because
    docker-compose never stops a service whose profile was deselected on its own
    (verified empirically - not even `up --remove-orphans` touches it; it only
    tears down services genuinely removed from the file).

    Raises ValueError if selected_profiles contains a name the file doesn't
    define - docker-compose silently treats an unrecognized --profile as "no
    profile selected" (exit 0, no error), so this must be caught before ever
    building a compose command with it.
    """
    stack = get_stack_profiles(compose_path)
    selected = set(selected_profiles or [])

    unknown = selected - set(stack['profiles'].keys())
    if unknown:
        raise ValueError(f"Unknown profile(s): {', '.join(sorted(unknown))}")

    desired_active = set(stack['core'])
    for name, services in stack['profiles'].items():
        if name in selected:
            desired_active.update(services)

    all_known = set(stack['core'])
    for services in stack['profiles'].values():
        all_known.update(services)

    present = _services_for_project(host_client, project_name)
    return sorted((present & all_known) - desired_active)


def _atomic_write_validated(file_path, new_lines, logger):
    """Write new_lines to file_path atomically (temp file + os.replace), keeping
    a one-deep .bak of the previous content. Validates the result with
    yaml.safe_load before ever touching the real file - a bad edit never
    reaches file_path in the first place, so .bak is for manual recovery of an
    unwanted-but-valid edit, not automatic rollback of a failed one.

    Returns (success: bool, message: str).
    """
    try:
        with open(file_path, 'r') as f:
            original_content = f.read()
    except Exception as e:
        return False, f'Could not read original file: {e}'

    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(file_path) or '.')
    try:
        with os.fdopen(tmp_fd, 'w') as f:
            f.writelines(new_lines)

        with open(tmp_path, 'r') as f:
            yaml.safe_load(f)  # validate before committing - never write invalid YAML

        with open(file_path + '.bak', 'w') as f:
            f.write(original_content)

        os.replace(tmp_path, file_path)
        return True, 'Saved successfully'
    except yaml.YAMLError as e:
        os.unlink(tmp_path)
        return False, f'Resulting file would be invalid YAML, not saved: {e}'
    except Exception as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        logger.error(f'Atomic write failed for {file_path}: {e}')
        return False, f'Failed to save: {e}'


def set_service_inactive(file_path, service_name, inactive, logger):
    """Insert or remove the exact line `profiles: ["inactive"]` under a service.

    inactive=True only applies to a service with no existing profiles: key (a
    service already gated by a real profile shouldn't be silently overwritten -
    the caller should edit that directly). inactive=False removes only a
    byte-for-byte match of the line this function would have inserted, so it
    never touches a profiles: line a person hand-edited afterward.

    Returns (success: bool, message: str).
    """
    with open(file_path, 'r') as f:
        lines = f.readlines()

    indent_info = _detect_compose_indent(lines)
    if not indent_info:
        return False, 'Could not detect services: section'
    _, _, property_indent = indent_info
    if not property_indent:
        return False, 'Could not detect property indentation for this service'

    block = find_service_block(file_path, service_name)
    if not block:
        return False, f'Service {service_name} not found'
    start_line, end_line = block

    inactive_line = ' ' * property_indent + 'profiles: ["inactive"]\n'

    if inactive:
        for i in range(start_line + 1, end_line + 1):
            if re.match(r'^\s*profiles:', lines[i]):
                return False, f'Service {service_name} already has a profiles: key - edit it directly'
        new_lines = lines[:start_line + 1] + [inactive_line] + lines[start_line + 1:]
    else:
        target_idx = None
        for i in range(start_line + 1, end_line + 1):
            if lines[i] == inactive_line:
                target_idx = i
                break
        if target_idx is None:
            return False, f'Service {service_name} does not have the inactive profile line'
        new_lines = lines[:target_idx] + lines[target_idx + 1:]

    return _atomic_write_validated(file_path, new_lines, logger)


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

_NAME_CONFLICT_RE = re.compile(r'container name "/?([^"]+)" is already in use by container "([0-9a-f]+)"')
_PORT_CONFLICT_RE = re.compile(r'Bind for (?:[\d.]+|::):(\d+) failed: port is already allocated')
_NETWORK_MISSING_RE = re.compile(r'network ([^\s]+) declared as external, but could not be found')
_IMAGE_NOT_FOUND_RE = re.compile(r'pull access denied for ([^\s,]+)|manifest .* not found|repository does not exist')
_YAML_PYYAML_RE = re.compile(r'line (\d+), column (\d+)')
_YAML_COMPOSEGO_RE = re.compile(r'yaml: line (\d+):\s*(.*)')


def _find_container_holding_port(host_client, port):
    """Scan a host's containers for one publishing the given host port. Returns the
    container or None - never raises, since this is a best-effort diagnostic lookup
    that must not break the error response it's attached to."""
    try:
        for container in host_client.containers.list(all=True):
            ports = (container.attrs.get('NetworkSettings', {}) or {}).get('Ports', {}) or {}
            for bindings in ports.values():
                for binding in (bindings or []):
                    if binding.get('HostPort') == port:
                        return container
    except Exception:
        pass
    return None


def diagnose_docker_failure(raw_text, logger, host_client=None, host_name='local'):
    """Classify a raw docker-py/docker-compose error string into a structured diagnosis.

    Both docker-py's APIError string and docker-compose's stderr ultimately wrap the
    same Docker Engine daemon error message, so one set of substring patterns covers
    both call paths. Returns None for empty input, otherwise a dict:
    {'pattern': str, 'summary': str, 'fix': {'action', 'label', 'params'} | None}.
    Never raises - a pattern miss degrades to the 'unknown' fallback rather than
    breaking the error response it's attached to.
    """
    if not raw_text:
        return None

    match = _NAME_CONFLICT_RE.search(raw_text)
    if match:
        wanted_name, existing_id = match.group(1), match.group(2)
        display_name = existing_id[:12]
        if host_client:
            try:
                display_name = host_client.containers.get(existing_id).name
            except Exception:
                pass
        return {
            'pattern': 'name_conflict',
            'summary': f'A container named "{wanted_name}" already exists ({display_name}) and is blocking this one from being created.',
            'fix': {
                'action': 'remove_container',
                'label': f'Remove conflicting container "{display_name}"',
                'params': {'id': existing_id, 'host': host_name}
            }
        }

    match = _PORT_CONFLICT_RE.search(raw_text)
    if match:
        port = match.group(1)
        holder = _find_container_holding_port(host_client, port) if host_client else None
        if holder:
            return {
                'pattern': 'port_conflict',
                'summary': f'Port {port} is already in use by container "{holder.name}".',
                'fix': {
                    'action': 'stop_container',
                    'label': f'Stop "{holder.name}" (using port {port})',
                    'params': {'id': holder.id, 'host': host_name}
                }
            }
        return {
            'pattern': 'port_conflict',
            'summary': f'Port {port} is already in use (not by a Docker container Composr can identify on {host_name} - check for a host process).',
            'fix': None
        }

    match = _NETWORK_MISSING_RE.search(raw_text)
    if match:
        network_name = match.group(1)
        return {
            'pattern': 'network_missing',
            'summary': f'External network "{network_name}" is referenced but does not exist.',
            'fix': {
                'action': 'create_network',
                'label': f'Create network "{network_name}"',
                'params': {'name': network_name, 'host': host_name}
            }
        }

    if _IMAGE_NOT_FOUND_RE.search(raw_text):
        return {
            'pattern': 'image_not_found',
            'summary': 'The image could not be pulled - it may not exist, be misspelled, or require registry login.',
            'fix': None
        }

    match = _YAML_PYYAML_RE.search(raw_text)
    if match:
        return {
            'pattern': 'yaml_syntax',
            'summary': f'YAML syntax error at line {match.group(1)}, column {match.group(2)}.',
            'fix': None
        }

    match = _YAML_COMPOSEGO_RE.search(raw_text)
    if match:
        return {
            'pattern': 'yaml_syntax',
            'summary': f'YAML syntax error at line {match.group(1)}: {match.group(2).strip()}',
            'fix': None
        }

    first_line = next((line.strip() for line in raw_text.splitlines() if line.strip()), 'Unknown error')
    return {
        'pattern': 'unknown',
        'summary': first_line[:200],
        'fix': None
    }


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

if __name__ == '__main__':
    # Sanity check for is_path_within_allowed_dirs / resolve_compose_file_path
    # containment (REVIEW.md B3/S3). Run directly: python3 functions.py
    import tempfile
    import logging

    with tempfile.TemporaryDirectory() as tmp:
        compose_dir = os.path.join(tmp, 'compose')
        extra_dir = os.path.join(tmp, 'extra')
        outside_dir = os.path.join(tmp, 'outside')
        os.makedirs(os.path.join(compose_dir, 'proj'))
        os.makedirs(os.path.join(extra_dir, 'proj2'))
        os.makedirs(outside_dir)

        legit_file = os.path.join(compose_dir, 'proj', 'docker-compose.yml')
        extra_file = os.path.join(extra_dir, 'proj2', 'docker-compose.yml')
        outside_file = os.path.join(outside_dir, 'docker-compose.yml')
        for f in (legit_file, extra_file, outside_file):
            open(f, 'w').close()

        symlink_path = os.path.join(compose_dir, 'sneaky-link.yml')
        os.symlink(outside_file, symlink_path)

        test_logger = logging.getLogger('functions_selftest')
        test_logger.addHandler(logging.NullHandler())

        checks = [
            ('relative traversal escape', '../../outside/docker-compose.yml', False),
            ('absolute path outside roots', outside_file, False),
            ('symlink pointing outside roots', 'sneaky-link.yml', False),
            ('legitimate path in compose_dir', 'proj/docker-compose.yml', True),
            ('legitimate path in an extra dir', extra_file, True),
        ]

        failures = 0
        for name, path, expected_allowed in checks:
            resolved = resolve_compose_file_path(path, compose_dir, [extra_dir], test_logger)
            allowed = resolved is not None
            status = 'PASS' if allowed == expected_allowed else 'FAIL'
            if status == 'FAIL':
                failures += 1
            print(f"[{status}] {name}: resolved={resolved!r} (expected allowed={expected_allowed})")

        if failures:
            raise SystemExit(f"{failures} containment check(s) failed")
        print("All containment checks passed.")