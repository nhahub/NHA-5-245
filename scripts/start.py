"""Start Docker if needed, then start SLA Guard and its existing n8n container."""

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
SLA_GUARD = ('compose', '--project-name', 'sla-guard')
NETWORK = 'sla-guard_default'


def docker(*args, directory=ROOT, capture=False, timeout=None):
    return subprocess.run(
        ['docker', *args], cwd=directory, check=True, capture_output=capture,
        encoding='utf-8', errors='replace', timeout=timeout,
    ).stdout


def docker_ready():
    try:
        docker('info', '--format', '{{.ServerVersion}}', capture=True, timeout=5)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False
    return True


def ensure_docker():
    if docker_ready():
        return

    print('Starting Docker Desktop and waiting for the engine...', flush=True)
    docker('desktop', 'start', '--timeout', '120', timeout=125)
    deadline = time.monotonic() + 30
    while not docker_ready():
        if time.monotonic() >= deadline:
            raise TimeoutError('Docker Engine is still unreachable.')
        time.sleep(1)


def inspect(container, template):
    return json.loads(docker('container', 'inspect', '--format', template, container, capture=True))


def start_n8n(container):
    state = inspect(container, '{{json .State}}')
    health = (state.get('Health') or {}).get('Status')
    if state['Running'] and health in (None, 'healthy'):
        return

    labels = inspect(container, '{{json .Config.Labels}}') or {}
    prefix = 'com.docker.compose.project'
    project = labels.get(prefix)
    directory = labels.get(f'{prefix}.working_dir')
    config_files = labels.get(f'{prefix}.config_files')
    service = labels.get('com.docker.compose.service')

    if project and directory and config_files and service:
        files = [arg for path in config_files.split(',') for arg in ('--file', path)]
        docker('compose', '--project-name', project, *files, 'up', '-d', '--wait', '--no-recreate', service,
               directory=directory)
    else:
        docker('start', container)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--n8n-container', default='n8n', help='name of the existing n8n container')
    parser.add_argument('--build', action='store_true', help='rebuild the SLA Guard dashboard image')
    args = parser.parse_args()

    if not (ROOT / '.env').is_file():
        print('Create the local configuration first with python scripts/init_local_env.py.', file=sys.stderr)
        return 1

    try:
        ensure_docker()
        start_n8n(args.n8n_container)
        options = ('--build',) if args.build else ()
        docker(*SLA_GUARD, 'up', '-d', '--wait', *options)
        networks = inspect(args.n8n_container, '{{json .NetworkSettings.Networks}}') or {}
        if NETWORK not in networks:
            docker('network', 'connect', NETWORK, args.n8n_container)
        address = docker(*SLA_GUARD, 'port', 'dashboard', '8083', capture=True).strip()
    except FileNotFoundError as error:
        print(f'Docker or the n8n Compose directory is unavailable: {error}', file=sys.stderr)
        return 1
    except (subprocess.TimeoutExpired, TimeoutError):
        print('Timed out waiting for Docker. Check Docker Desktop, then run the startup command again.', file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr.strip(), file=sys.stderr)
        return error.returncode

    print(f'SLA Guard dashboard: http://{address}/')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
