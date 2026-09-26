"""Hosted TrueForge control plane and isolated CPU execution on Modal."""
from pathlib import Path
import time
import asyncio

import modal

app = modal.App("prooflayer-forge")
state_volume = modal.Volume.from_name("prooflayer-forge-state", create_if_missing=True)
ROOT = Path(__file__).resolve().parents[1]
science_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install(
    "numpy==2.2.6", "scipy==1.15.3", "scikit-learn==1.6.1"
)
lean_image = modal.Image.debian_slim(python_version="3.12").apt_install("curl", "zstd").run_commands(
    "curl -fsSL https://github.com/leanprover/lean4/releases/download/v4.19.0/lean-4.19.0-linux.tar.zst -o /tmp/lean.tar.zst",
    "tar --zstd -xf /tmp/lean.tar.zst -C /opt && rm /tmp/lean.tar.zst",
).env({"PATH": "/opt/lean-4.19.0-linux/bin:/usr/local/bin:/usr/bin:/bin"})
runtime_image = (
    modal.Image.from_registry("node:22.16.0-bookworm-slim", add_python="3.12")
    .apt_install("ca-certificates")
    .uv_pip_install("fastapi==0.115.12", "httpx==0.28.1", "typesafe-sdk==0.7.1", "uvicorn==0.34.3")
    .run_commands("npm install -g pnpm@11.19.0", "mkdir -p /opt/trueforge && cd /opt/trueforge && npm init -y && npm install @truefoundry/trueforge@0.2.1")
    .add_local_file(ROOT / "package.json", "/app/package.json", copy=True)
    .add_local_file(ROOT / "pnpm-lock.yaml", "/app/pnpm-lock.yaml", copy=True)
    .add_local_file(ROOT / "pnpm-workspace.yaml", "/app/pnpm-workspace.yaml", copy=True)
    .run_commands("cd /app && pnpm install --frozen-lockfile")
    .add_local_dir(ROOT / "runtime", "/app/runtime", copy=True, ignore=["**/__pycache__/**", "**/*.pyc"])
    .env({"PYTHONPATH": "/app"})
    .add_local_dir(ROOT / "server", "/app/server", copy=True)
    .add_local_dir(ROOT / "src/lib", "/app/src/lib", copy=True)
)


async def execute(code: str, language: str):
    if language not in {"python", "lean"} or not code or len(code) > 60000:
        raise ValueError("Invalid sandbox request")
    started = time.monotonic()
    print(f"Creating {language} sandbox", flush=True)
    sb = await asyncio.wait_for(modal.Sandbox.create.aio(
        app=app, image=lean_image if language == "lean" else science_image,
        timeout=200, cpu=(2, 2), memory=(2048, 2048), block_network=True,
    ), timeout=120)
    try:
        print(f"Sandbox ready: {sb.object_id}", flush=True)
        filename = "/tmp/Main.lean" if language == "lean" else "/tmp/main.py"
        await asyncio.wait_for(sb.filesystem.write_text.aio(code, filename), timeout=30)
        command = ["lean", filename] if language == "lean" else ["python", "-I", filename]
        # Shell and output paths are trusted constants, never interpolated user input.
        process = await sb.exec.aio(
            "bash", "-c", 'ulimit -f 256; timeout 180 "$@" > /tmp/stdout 2> /tmp/stderr', "--", *command,
            timeout=190,
        )
        await process.wait.aio()
        print(f"Sandbox exited: {process.returncode}", flush=True)
        stdout = await sb.filesystem.read_text.aio("/tmp/stdout")
        stderr = await sb.filesystem.read_text.aio("/tmp/stderr")
        return {"stdout": stdout[:100000], "stderr": stderr[:30000], "exitCode": process.returncode,
                "sandboxId": sb.object_id, "durationMs": int((time.monotonic() - started) * 1000)}
    finally:
        await sb.terminate.aio()


@app.function(image=runtime_image, secrets=[modal.Secret.from_name("prooflayer-runtime")],
              volumes={"/data": state_volume},
              min_containers=1, max_containers=1, cpu=2, memory=4096, timeout=3600)
@modal.concurrent(max_inputs=30)
@modal.asgi_app()
def web():
    from runtime.hosting import create_gateway
    return create_gateway(execute, state_volume)
