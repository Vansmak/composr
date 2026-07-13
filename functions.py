import json
import os
import re
import stat
import tempfile
import datetime
import difflib
import hashlib
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
        # Host/container path mismatch: a compose label reflects wherever
        # docker-compose was actually invoked from. If that was the host
        # directly (e.g. /home/joe/docker/utility/docker-compose.yml) rather
        # than through this app - which sees that same directory tree at
        # compose_dir instead, via a bind mount (e.g. /app/docker) - the
        # exact absolute path won't exist here even though the file does.
        # Fall back to the project subdirectory + filename (the last two path
        # segments) resolved against compose_dir, matching how compose files
        # are actually laid out (one project per subdirectory).
        parts = file_path.rstrip('/').split('/')
        if len(parts) >= 2:
            candidate = os.path.join(compose_dir, parts[-2], parts[-1])
            if os.path.exists(candidate) and _contained(candidate):
                logger.debug(f"Found file via host/container path fallback: {candidate}")
                return candidate
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
    """Determine which services need an explicit stop before 'up', because
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

    file_path (and its parent directory) may not exist yet - a brand-new
    compose file is a valid target for a service move, not an error.

    Returns (success: bool, message: str).
    """
    file_existed = os.path.exists(file_path)
    original_content = None
    original_mode = None
    if file_existed:
        try:
            with open(file_path, 'r') as f:
                original_content = f.read()
            original_mode = os.stat(file_path).st_mode
        except Exception as e:
            return False, f'Could not read original file: {e}'

    parent_dir = os.path.dirname(file_path) or '.'
    try:
        os.makedirs(parent_dir, exist_ok=True)
    except Exception as e:
        return False, f'Could not create directory {parent_dir}: {e}'

    tmp_fd, tmp_path = tempfile.mkstemp(dir=parent_dir)
    try:
        with os.fdopen(tmp_fd, 'w') as f:
            f.writelines(new_lines)

        with open(tmp_path, 'r') as f:
            yaml.safe_load(f)  # validate before committing - never write invalid YAML

        # tempfile.mkstemp() creates files mode 0600 (owner-only) regardless
        # of the original file's permissions - os.replace() keeps that mode
        # rather than inheriting the path it's replacing, so without this the
        # file becomes unreadable by anyone but whoever this process runs as
        # (often root in a container) the moment it's edited even once.
        if original_mode is not None:
            os.chmod(tmp_path, stat.S_IMODE(original_mode))

        if file_existed:
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


# --- Move a service between compose files ---

def _read_lines(path):
    if os.path.exists(path):
        with open(path, 'r') as f:
            return f.readlines()
    return []


def _reindent_block(block_lines, service_delta, property_delta):
    """Re-indent a service block for its new file: the "name:" line shifts by
    service_delta (to match the target's service-level indent), everything
    nested under it shifts by property_delta (to match the target's own
    property indent, which can differ from its service indent - e.g. 4-space
    services with 8-space properties). Deeper nesting keeps its original
    relative offset from the property level, since docker-compose files use a
    single consistent step size within their own services: section."""
    if service_delta == 0 and property_delta == 0:
        return list(block_lines)
    new_lines = []
    for i, line in enumerate(block_lines):
        if not line.strip():
            new_lines.append(line)
            continue
        current_indent = len(line) - len(line.lstrip(' '))
        delta = service_delta if i == 0 else property_delta
        new_indent = max(current_indent + delta, 0)
        new_lines.append(' ' * new_indent + line.lstrip(' '))
    return new_lines


def _extract_host_ports(service_cfg):
    ports = set()
    for p in (service_cfg.get('ports') or []):
        if isinstance(p, str) and ':' in p:
            ports.add(p.split(':')[0].strip('"').strip("'"))
        elif isinstance(p, dict) and 'published' in p:
            ports.add(str(p['published']))
    return ports


def _scan_move_warnings(source_path, target_path, service_name, block_lines, target_lines):
    """Report (never auto-fix) the ways a moved service could break: depends_on
    crossing files, top-level volumes/networks the target doesn't declare,
    ${VAR} refs missing from the target dir's .env, name/container_name/port
    collisions with the target's existing services. The dynamic "is this port
    already bound by a running container on the target host" check needs a
    docker client and is layered on by the caller (app.py), which has one.
    """
    warnings = []
    block_text = ''.join(block_lines)

    try:
        with open(source_path, 'r') as f:
            source_data = yaml.safe_load(f) or {}
    except Exception:
        source_data = {}
    source_services = source_data.get('services') or {}
    moving_cfg = source_services.get(service_name) or {}
    remaining_services = {k: v for k, v in source_services.items() if k != service_name}

    try:
        target_data = (yaml.safe_load(''.join(target_lines)) or {}) if target_lines else {}
    except Exception:
        target_data = {}
    target_services = target_data.get('services') or {}

    source_base = os.path.basename(source_path)
    target_base = os.path.basename(target_path)

    # a) depends_on crossing the file boundary, both directions
    depends_on = moving_cfg.get('depends_on')
    if depends_on:
        dep_names = list(depends_on.keys()) if isinstance(depends_on, dict) else list(depends_on)
        staying = [d for d in dep_names if d in remaining_services]
        if staying:
            warnings.append(
                f"{service_name} depends_on {', '.join(staying)}, which would stay in {source_base} - cross-file depends_on doesn't work."
            )
    for other_name, other_cfg in remaining_services.items():
        if not isinstance(other_cfg, dict):
            continue
        other_deps = other_cfg.get('depends_on')
        if not other_deps:
            continue
        dep_names = list(other_deps.keys()) if isinstance(other_deps, dict) else list(other_deps)
        if service_name in dep_names:
            warnings.append(
                f"{other_name} (staying in {source_base}) depends_on {service_name}, which is moving."
            )

    # b) top-level volumes/networks the service uses that source declares but target doesn't
    for key in ('volumes', 'networks'):
        used = set()
        cfg_val = moving_cfg.get(key)
        source_top = source_data.get(key) or {}
        if isinstance(cfg_val, list):
            for v in cfg_val:
                if isinstance(v, str) and ':' in v and v.split(':')[0] in source_top:
                    used.add(v.split(':')[0])
        elif isinstance(cfg_val, dict):
            used.update(name for name in cfg_val if name in source_top)
        missing = used - set((target_data.get(key) or {}).keys())
        if missing:
            warnings.append(
                f"{service_name} uses top-level {key} ({', '.join(sorted(missing))}) declared in {source_base} but not in {target_base} - add them there too."
            )

    # c) ${VAR} references vs the target directory's .env
    var_refs = set(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)', block_text))
    if var_refs:
        env_path = os.path.join(os.path.dirname(target_path), '.env')
        env_keys = set()
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        env_keys.add(line.split('=', 1)[0].strip())
        missing_vars = var_refs - env_keys
        if missing_vars:
            warnings.append(
                f"{service_name} references {', '.join('${' + v + '}' for v in sorted(missing_vars))} not found in "
                f"{os.path.dirname(target_path)}/.env - may be undefined after the move unless set elsewhere."
            )

    # d) service-name / container_name collision in target
    if service_name in target_services:
        warnings.append(f"A service named {service_name} already exists in {target_base}.")
    moving_container_name = moving_cfg.get('container_name')
    if moving_container_name:
        for other_name, other_cfg in target_services.items():
            if isinstance(other_cfg, dict) and other_cfg.get('container_name') == moving_container_name:
                warnings.append(f"container_name '{moving_container_name}' is already used by {other_name} in {target_base}.")

    # e) host-port collision with the target file's other services (static check;
    # the running-container check against the target host is added by the caller)
    moving_ports = _extract_host_ports(moving_cfg)
    for other_name, other_cfg in target_services.items():
        if not isinstance(other_cfg, dict):
            continue
        collision = moving_ports & _extract_host_ports(other_cfg)
        if collision:
            warnings.append(f"Port(s) {', '.join(sorted(collision))} used by {service_name} are also used by {other_name} in {target_base}.")

    return warnings


def compute_service_move(source_path, target_path, service_name, logger):
    """Compute (without writing) moving a service block from source_path to
    target_path. Raises ValueError if the service can't be found. Returns a
    dict with before/after content for both files, unified diffs, and
    warnings - the internal _new_source_lines/_new_target_lines keys are what
    commit_service_move actually writes.
    """
    source_lines = _read_lines(source_path)
    if not source_lines:
        raise ValueError(f'Source file {source_path} not found or empty')

    block = find_service_block(source_path, service_name)
    if not block:
        raise ValueError(f'Service {service_name} not found in {source_path}')
    start, end = block
    block_lines = source_lines[start:end + 1]

    source_indent_info = _detect_compose_indent(source_lines)
    if not source_indent_info:
        raise ValueError(f'Could not detect services: section in {source_path}')
    _, source_service_indent, source_property_indent = source_indent_info
    source_property_indent = source_property_indent or source_service_indent

    target_lines = _read_lines(target_path)
    target_indent_info = _detect_compose_indent(target_lines) if target_lines else None
    if target_indent_info:
        _, target_service_indent, target_property_indent = target_indent_info
        target_property_indent = target_property_indent or target_service_indent
    else:
        target_service_indent = source_service_indent
        target_property_indent = source_property_indent

    moved_block = _reindent_block(
        block_lines,
        target_service_indent - source_service_indent,
        target_property_indent - source_property_indent
    )

    # new source content: block removed
    new_source_lines = source_lines[:start] + source_lines[end + 1:]

    # new target content: appended under services: (created if it doesn't exist yet)
    if not target_lines:
        new_target_lines = ['services:\n'] + moved_block
    elif target_indent_info:
        services_idx = target_indent_info[0]
        insert_at = len(target_lines)
        for i in range(services_idx + 1, len(target_lines)):
            raw = target_lines[i].rstrip('\n')
            stripped = raw.strip()
            if not stripped:
                continue
            if len(raw) - len(raw.lstrip(' ')) == 0:
                insert_at = i
                break
        prefix = target_lines[:insert_at]
        if prefix and not prefix[-1].endswith('\n'):
            prefix[-1] = prefix[-1] + '\n'
        new_target_lines = prefix + moved_block + target_lines[insert_at:]
    else:
        trailing_gap = ['\n'] if target_lines and target_lines[-1].strip() else []
        new_target_lines = target_lines + trailing_gap + ['services:\n'] + moved_block

    source_diff = ''.join(difflib.unified_diff(
        source_lines, new_source_lines,
        fromfile=os.path.basename(source_path), tofile=os.path.basename(source_path)
    ))
    target_diff = ''.join(difflib.unified_diff(
        target_lines, new_target_lines,
        fromfile=os.path.basename(target_path) if target_lines else '(new file)',
        tofile=os.path.basename(target_path)
    ))

    warnings = _scan_move_warnings(source_path, target_path, service_name, block_lines, target_lines)

    return {
        'source_before': ''.join(source_lines),
        'source_after': ''.join(new_source_lines),
        'target_before': ''.join(target_lines),
        'target_after': ''.join(new_target_lines),
        'source_diff': source_diff,
        'target_diff': target_diff,
        'warnings': warnings,
        '_new_source_lines': new_source_lines,
        '_new_target_lines': new_target_lines,
    }


def compute_move_confirm_token(source_path, target_path, service_name):
    """Content hash of both files at preview time. commit_service_move's caller
    must recompute this against the CURRENT file contents and reject a
    mismatch - guards against committing a stale preview after either file
    changed underneath it (another tab, a manual edit, a concurrent request)."""
    source_content = ''.join(_read_lines(source_path))
    target_content = ''.join(_read_lines(target_path))
    payload = f"{source_path}|{target_path}|{service_name}|{source_content}|{target_content}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def commit_service_move(source_path, target_path, service_name, logger):
    """Write the move computed by compute_service_move. Caller must verify the
    confirm token first. Target is written before source is trimmed - if the
    source-removal step fails, the service exists in both files (a duplicate,
    safe and recoverable) rather than nowhere (lost entirely)."""
    result = compute_service_move(source_path, target_path, service_name, logger)

    ok, msg = _atomic_write_validated(target_path, result['_new_target_lines'], logger)
    if not ok:
        return False, f'Failed to write target file: {msg}', result

    ok, msg = _atomic_write_validated(source_path, result['_new_source_lines'], logger)
    if not ok:
        logger.error(f'Move partially failed: target written but source removal failed: {msg}')
        return False, (
            f'{target_path} was updated but removing the service from {source_path} failed: {msg}. '
            f'The service now exists in both files - please check {source_path} manually.'
        ), result

    return True, 'Service moved successfully', result


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
# Two distinct daemon message formats for "this port is taken", verified live:
# one when another Docker container already holds it, a different one when a
# non-Docker process does (the exact "address already in use" case the
# port-conflict pre-check's advisory framing calls out as invisible to it).
_PORT_CONFLICT_RE = re.compile(r'Bind for (?:[\d.]+|::):(\d+) failed: port is already allocated')
_PORT_CONFLICT_HOST_PROCESS_RE = re.compile(r'failed to bind host port for [\d.]+:(\d+):.+?/tcp: address already in use')
_NETWORK_MISSING_RE = re.compile(r'network ([^\s]+) declared as external, but could not be found')
_IMAGE_NOT_FOUND_RE = re.compile(r'pull access denied for ([^\s,]+)|manifest .* not found|repository does not exist')
_YAML_PYYAML_RE = re.compile(r'line (\d+), column (\d+)')
_YAML_COMPOSEGO_RE = re.compile(r'yaml: line (\d+):\s*(.*)')


def find_container_holding_port(host_client, port):
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


# --- Pre-deploy port-conflict check and resolution (Commit 4) ---

def get_host_port_map(host_client):
    """Map of host_port (str) -> container, for every currently published
    port on this host. Used both to detect conflicts and to know which ports
    are free when suggesting an alternative."""
    port_map = {}
    try:
        for container in host_client.containers.list(all=True):
            ports = (container.attrs.get('NetworkSettings', {}) or {}).get('Ports', {}) or {}
            for bindings in ports.values():
                for binding in (bindings or []):
                    host_port = binding.get('HostPort')
                    if host_port:
                        port_map[host_port] = container
    except Exception:
        pass
    return port_map


def suggest_free_port(desired_port, used_ports, max_tries=20):
    """Nearest available port at or after desired_port, skipping anything in
    used_ports. Returns None if nothing found within max_tries (in practice
    always finds one long before that)."""
    try:
        base = int(desired_port)
    except (TypeError, ValueError):
        return None
    for offset in range(max_tries):
        candidate = base + offset
        if candidate > 65535:
            break
        if str(candidate) not in used_ports:
            return str(candidate)
    return None


def compute_desired_active_services(compose_path, selected_profiles):
    """Which services will actually run: core + any service in a selected
    profile. selected_profiles=None means every service (the legacy
    full-file deploy, which has no profile concept to filter by)."""
    stack = get_stack_profiles(compose_path)
    if selected_profiles is None:
        return set(stack['core']) | {s for services in stack['profiles'].values() for s in services}
    desired = set(stack['core'])
    for name, services in stack['profiles'].items():
        if name in selected_profiles:
            desired.update(services)
    return desired


def check_deploy_port_conflicts(compose_path, project_name, services_to_deploy, target_host_client):
    """Before deploying, check whether any host port a service-about-to-start
    uses is already published by ANOTHER container on the target host.
    Excludes the deploying service's own current container - redeploying a
    service onto the port it's already using isn't a real conflict, same
    false-positive fix as the Commit 2 move-preview port check. Returns a
    list of {service, port, container_name, container_id, suggested_port}
    dicts (empty if none)."""
    try:
        with open(compose_path, 'r') as f:
            compose_data = yaml.safe_load(f) or {}
    except Exception:
        return []
    all_services = compose_data.get('services') or {}

    port_map = get_host_port_map(target_host_client)

    conflicts = []
    for service_name in services_to_deploy:
        cfg = all_services.get(service_name) or {}
        for p in (cfg.get('ports') or []):
            if not (isinstance(p, str) and ':' in p):
                continue
            host_port = p.split(':')[0].strip('"').strip("'")
            holder = port_map.get(host_port)
            if not holder:
                continue
            holder_labels = holder.labels or {}
            is_self = (holder_labels.get('com.docker.compose.project') == project_name
                       and holder_labels.get('com.docker.compose.service') == service_name)
            if is_self:
                continue
            conflicts.append({
                'service': service_name,
                'port': host_port,
                'container_name': holder.name,
                'container_id': holder.id,
                'suggested_port': suggest_free_port(host_port, set(port_map.keys())),
            })
    return conflicts


def find_port_mapping_line(file_path, service_name, host_port):
    """Find the exact line index of a service's ports: list entry whose host
    port matches host_port. Returns the line index or None."""
    block = find_service_block(file_path, service_name)
    if not block:
        return None
    start, end = block
    with open(file_path, 'r') as f:
        lines = f.readlines()
    port_line_re = re.compile(r'^\s*-\s*(["\']?)(\d+)(["\']?):')
    for i in range(start, end + 1):
        m = port_line_re.match(lines[i])
        if m and m.group(2) == str(host_port):
            return i
    return None


def change_service_port(file_path, service_name, old_port, new_port, logger):
    """Change exactly one host-port in a service's ports: mapping - a
    single-line text edit, preserving quoting style and the container-port
    side untouched. Atomic write, validated. Returns (success, message,
    unified single-line diff string or None)."""
    with open(file_path, 'r') as f:
        lines = f.readlines()

    line_idx = find_port_mapping_line(file_path, service_name, old_port)
    if line_idx is None:
        return False, f'Could not find port mapping {old_port} for service {service_name}', None

    old_line = lines[line_idx]
    line_re = re.compile(r'^(\s*-\s*)(["\']?)(\d+)(["\']?)(:.*)$')
    m = line_re.match(old_line.rstrip('\n'))
    if not m:
        return False, f'Could not parse port mapping line for {service_name}', None
    prefix, quote_open, _, quote_close, rest = m.groups()
    trailing_newline = '\n' if old_line.endswith('\n') else ''
    new_line = f"{prefix}{quote_open}{new_port}{quote_close}{rest}{trailing_newline}"

    new_lines = list(lines)
    new_lines[line_idx] = new_line

    ok, msg = _atomic_write_validated(file_path, new_lines, logger)
    diff_text = f"- {old_line.rstrip(chr(10))}\n+ {new_line.rstrip(chr(10))}"
    return ok, msg, diff_text


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

    match = _PORT_CONFLICT_RE.search(raw_text) or _PORT_CONFLICT_HOST_PROCESS_RE.search(raw_text)
    if match:
        port = match.group(1)
        holder = find_container_holding_port(host_client, port) if host_client else None
        if holder:
            return {
                'pattern': 'port_conflict',
                'summary': f'Port {port} is already in use by container "{holder.name}".',
                'port': port,
                'container_name': holder.name,
                'fix': {
                    'action': 'stop_container',
                    'label': f'Stop "{holder.name}" (using port {port})',
                    'params': {'id': holder.id, 'host': host_name}
                }
            }
        return {
            'pattern': 'port_conflict',
            'summary': f'Port {port} is already in use (not by a Docker container Composr can identify on {host_name} - check for a host process).',
            'port': port,
            'container_name': None,
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