"""Single-container TrueForge lifecycle, private gateway, and durable snapshots."""
import asyncio
from contextlib import asynccontextmanager, suppress
import hmac
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

LIVE_DB = Path('/tmp/trueforge/db.sqlite')
SAVED_DB = Path('/data/trueforge.sqlite')


def restore_database():
    LIVE_DB.parent.mkdir(parents=True, exist_ok=True)
    if SAVED_DB.exists():
        shutil.copyfile(SAVED_DB, LIVE_DB)


def snapshot_database():
    # SQLite's backup API includes committed WAL contents in one consistent file.
    if LIVE_DB.exists():
        temporary = SAVED_DB.with_suffix('.tmp')
        with sqlite3.connect(LIVE_DB) as source, sqlite3.connect(temporary) as dest:
            source.backup(dest)
        temporary.replace(SAVED_DB)


async def configure_harness(client):
    model = os.environ.get('OPENAI_MODEL', 'gpt-6-sol')
    manifests = {
        'model-providers': {
            'type': 'openai', 'auth': {'api_key': os.environ['OPENAI_API_KEY']},
            'models': [{'model_id': model, 'name': model,
                        'properties': {'context_length': 1050000, 'max_output_tokens': 24000,
                                       'reasoning_efforts': ['low', 'medium', 'high']}}],
        },
        'mcp-servers': {
            'type': 'remote', 'name': 'prooflayer',
            'description': 'Paper reproduction and evidence tools',
            'url': 'http://127.0.0.1:8792/mcp',
            'auth': {'type': 'header', 'headers': {
                'Authorization': 'Bearer ' + os.environ['PROOFLAYER_MCP_TOKEN']}},
        },
    }
    for name, manifest in manifests.items():
        response = await client.put('http://127.0.0.1:8790/api/v1/settings/' + name,
                                    headers={'Authorization': 'Bearer ' + os.environ['TRUEFORGE_API_KEY']},
                                    json={'manifest': manifest})
        if response.status_code >= 300:
            # Do not log the manifest or HTTP request, which contain provider credentials.
            raise RuntimeError(f'TrueForge {name} configuration failed: HTTP {response.status_code}')


def create_gateway(execute, volume):
    children = []
    checkpoint_lock = asyncio.Lock()

    async def checkpoint():
        async with checkpoint_lock:
            await asyncio.to_thread(snapshot_database)
            await volume.commit.aio()

    async def periodic_checkpoint():
        while True:
            await asyncio.sleep(5)
            try:
                await checkpoint()
            except Exception:
                print('Persistence checkpoint failed; retrying', flush=True)

    @asynccontextmanager
    async def lifespan(api):
        for key in ('OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'PROOFLAYER_ACCESS_TOKEN', 'PROOFLAYER_MCP_TOKEN'):
            if not os.environ.get(key):
                raise RuntimeError(f'Missing {key}')
        os.environ['TRUEFORGE_API_KEY'] = secrets.token_urlsafe(32)
        os.environ['PROOFLAYER_RUNTIME_URL'] = 'http://127.0.0.1:8793'
        await asyncio.to_thread(restore_database)
        harness_env = {**os.environ, 'STANDALONE': 'true', 'HOST': '127.0.0.1', 'PORT': '8790',
                       'SQLITE_PATH': str(LIVE_DB), 'TRUEFOUNDRY_SANDBOX_ENABLED': 'false',
                       'OUTBOUND_URL_ALLOWED_HOSTS': '["127.0.0.1"]'}
        service_env = {**os.environ, 'PROOFLAYER_HOSTED': 'true', 'SERVICE_PORT': '8792',
                       'PROOFLAYER_DATA_DIR': '/data/prooflayer'}
        children.extend([
            subprocess.Popen(['node', '/opt/trueforge/node_modules/@truefoundry/trueforge/dist/main.js'], env=harness_env),
            subprocess.Popen(['/app/node_modules/.bin/tsx', '/app/server/index.ts'], cwd='/app', env=service_env),
        ])
        checkpoint_task = None
        internal_task = None
        internal_server = None
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                for _ in range(120):
                    if any(c.poll() is not None for c in children):
                        raise RuntimeError('Runtime child exited during startup')
                    try:
                        control = await client.get('http://127.0.0.1:8792/health')
                        harness = await client.get('http://127.0.0.1:8790/api/v1/settings/model-providers',
                                                  headers={'Authorization': 'Bearer ' + os.environ['TRUEFORGE_API_KEY']})
                        if control.status_code == 200 and harness.status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(1)
                else:
                    raise RuntimeError('Runtime startup timed out')
                await configure_harness(client)
            # The MCP tools call the same authenticated gateway over loopback, without
            # a public-URL bootstrap cycle. Disable lifespan on this internal listener.
            import uvicorn
            internal_server = uvicorn.Server(uvicorn.Config(api, host='127.0.0.1', port=8793,
                                                           lifespan='off', log_level='warning'))
            internal_task = asyncio.create_task(internal_server.serve())
            for _ in range(100):
                if internal_server.started:
                    break
                await asyncio.sleep(.05)
            if not internal_server.started:
                raise RuntimeError('Private gateway did not start')
            await checkpoint()
            checkpoint_task = asyncio.create_task(periodic_checkpoint())
            yield
        finally:
            if checkpoint_task:
                checkpoint_task.cancel()
                with suppress(asyncio.CancelledError):
                    await checkpoint_task
            if internal_server:
                internal_server.should_exit = True
            if internal_task:
                with suppress(Exception, asyncio.CancelledError):
                    await asyncio.wait_for(internal_task, timeout=10)
            for child in children:
                child.terminate()
            for child in children:
                with suppress(subprocess.TimeoutExpired):
                    await asyncio.to_thread(child.wait, timeout=10)
                if child.poll() is None:
                    child.kill()
            await checkpoint()

    api = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def authorize(request, key):
        token = os.environ.get(key, '')
        if not token or not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + token):
            raise HTTPException(401, 'Unauthorized')

    @api.get('/health')
    async def health():
        healthy = len(children) == 2 and all(c.poll() is None for c in children)
        return Response(json.dumps({'ok': healthy, 'runtime': 'TrueForge standalone on Modal'}),
                        status_code=200 if healthy else 503, media_type='application/json')

    @api.post('/judge')
    async def review_claims(request: Request):
        authorize(request, 'PROOFLAYER_MCP_TOKEN')
        body = await request.body()
        if len(body) > 190000:
            raise HTTPException(413)
        from runtime.jev import judge
        try:
            return await judge(json.loads(body))
        except ValueError:
            raise HTTPException(422, 'Invalid Jev request or response')
        except Exception as error:
            print('Jev review failed: ' + type(error).__name__, flush=True)
            raise HTTPException(502, 'Jev review unavailable')

    @api.post('/executor')
    async def executor(request: Request):
        authorize(request, 'PROOFLAYER_MCP_TOKEN')
        body = await request.body()
        if len(body) > 100000:
            raise HTTPException(413)
        try:
            payload = json.loads(body)
            return await execute(payload['code'], payload['language'])
        except (KeyError, ValueError):
            raise HTTPException(422, 'Invalid sandbox request')

    @api.api_route('/control/{path:path}', methods=['GET', 'POST'])
    async def proxy(path: str, request: Request):
        authorize(request, 'PROOFLAYER_ACCESS_TOKEN')
        body = await request.body()
        if len(body) > 200000:
            raise HTTPException(413)
        async with httpx.AsyncClient(timeout=240) as client:
            result = await client.request(request.method, 'http://127.0.0.1:8792/control/' + path,
                                          headers={'authorization': request.headers['authorization'],
                                                   'content-type': 'application/json'},
                                          content=body, params=request.query_params)
        if request.method == 'POST' or path.endswith('/export'):
            await checkpoint()
        return Response(result.content, status_code=result.status_code,
                        media_type='application/json')

    return api
