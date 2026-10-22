from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MACHINE_CONFIG = ROOT / ".machine.env"
DEV_COMPOSE = ["-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"]
REQUIRED_LOCAL_ENV = (
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_API_BASE_URL",
    "DATABASE_URL",
    "SUPABASE_JWKS_URL",
    "SUPABASE_JWT_ISSUER",
    "GEMINI_API_KEY",
)
SMOKE_TEST = """\
import asyncio
import time
from app.core.config import settings
from app.services import gemini

async def main():
    if settings.gemini_chat_model != "gemini-3.6-flash":
        raise RuntimeError("The configured Gemini model is not gemini-3.6-flash.")
    started = time.perf_counter()
    usage = {}
    chunks = []
    async for chunk in gemini.stream_chat(
        [{"role": "user", "content": "Reply with the word OK."}],
        0.2,
        1024,
        usage,
    ):
        chunks.append(chunk)
    if not "".join(chunks).strip():
        raise RuntimeError("Gemini chat streaming returned no text.")
    vectors = await gemini.embed_texts(["Workflow embedding check."], is_query=True)
    if len(vectors) != 1 or len(vectors[0]) != settings.embedding_dimensions:
        raise RuntimeError("Gemini embedding returned an unexpected vector shape.")
    print(
        f"Gemini smoke test passed: {settings.gemini_chat_model}, "
        f"stream {time.perf_counter() - started:.2f}s, "
        f"embedding {len(vectors[0])} dimensions."
    )

asyncio.run(main())
"""


class WorkflowError(RuntimeError):
    pass


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[name.strip()] = value
    return values


def find_supabase() -> str | None:
    executable = shutil.which("supabase")
    if executable:
        return executable
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidate = (
                Path(local_app_data)
                / "supabase-cli"
                / "node_modules"
                / "@supabase"
                / "cli-windows-x64"
                / "bin"
                / "supabase.exe"
            )
            if candidate.is_file():
                return str(candidate)
    return None


def require_command(name: str) -> str:
    executable = shutil.which(name)
    if not executable:
        raise WorkflowError(f"找不到 {name}。請先安裝並確認它已加入 PATH。")
    return executable


def run(command: list[str], *, cwd: Path = ROOT, input_text: str | None = None) -> None:
    print(f"\n> {' '.join(command)}")
    result = subprocess.run(command, cwd=cwd, input=input_text, text=True, check=False)
    if result.returncode:
        raise WorkflowError(f"指令失敗（退出碼 {result.returncode}）：{command[0]}")


def run_quiet(command: list[str], *, cwd: Path = ROOT) -> None:
    result = subprocess.run(
        command,
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode:
        raise WorkflowError(f"指令失敗（退出碼 {result.returncode}）：{command[0]}")


def supabase_status(supabase: str) -> dict[str, str]:
    import json

    result = subprocess.run(
        [supabase, "status", "-o", "json"], cwd=ROOT, capture_output=True, text=True, check=False
    )
    text = result.stdout
    if result.returncode or "{" not in text:
        raise WorkflowError("無法讀取本機 Supabase 狀態。")
    return json.loads(text[text.index("{") :])


def write_env_values(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    pending = dict(updates)
    for index, line in enumerate(lines):
        name = line.split("=", 1)[0].strip()
        if "=" in line and not line.lstrip().startswith("#") and name in pending:
            lines[index] = f"{name}={pending.pop(name)}"
    lines.extend(f"{name}={value}" for name, value in pending.items())
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def bootstrap_env(supabase: str) -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        print("\n第一次執行：自動建立 .env ...")
        shutil.copyfile(ROOT / ".env.example", env_path)
    current = read_env_file(env_path)
    if current.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "replace-with-").startswith("replace-with-"):
        run_quiet([supabase, "start"])
        status = supabase_status(supabase)
        api_url = status["API_URL"].rstrip("/")
        port = api_url.rsplit(":", 1)[-1]
        write_env_values(
            env_path,
            {
                "NEXT_PUBLIC_SUPABASE_URL": api_url,
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": status.get("PUBLISHABLE_KEY") or status["ANON_KEY"],
                "SUPABASE_JWKS_URL": f"http://host.docker.internal:{port}/auth/v1/.well-known/jwks.json",
                "SUPABASE_JWT_ISSUER": f"{api_url}/auth/v1",
            },
        )
        print("已自動填入本機 Supabase 設定。")
    if current.get("GEMINI_API_KEY", "replace-with-").startswith("replace-with-"):
        import getpass

        key = getpass.getpass("請貼上 Gemini API 金鑰（輸入時不會顯示，只需這一次）：")
        key = key.strip().replace("\n", "").replace("\r", "")
        if not key:
            raise WorkflowError("需要 Gemini API 金鑰才能繼續。")
        write_env_values(env_path, {"GEMINI_API_KEY": key})


def check_local_setup() -> str:
    require_command("docker")
    if not shutil.which("npm") and not shutil.which("npm.cmd"):
        raise WorkflowError("找不到 npm。請先安裝 Node.js 22 或更新版本。")
    supabase = find_supabase()
    if not supabase:
        print("\n第一次執行：自動安裝 Supabase CLI（npm install -g supabase）...")
        install = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", "npm.cmd install -g supabase"] if os.name == "nt" else ["npm", "install", "-g", "supabase"]
        run(install)
        supabase = find_supabase()
    if not supabase:
        raise WorkflowError("Supabase CLI 已安裝但仍找不到。請關閉終端機重開後再執行一次。")
    bootstrap_env(supabase)
    local_env = read_env_file(ROOT / ".env")
    missing = [
        name
        for name in REQUIRED_LOCAL_ENV
        if not local_env.get(name) or local_env[name].startswith("replace-with-")
    ]
    if missing:
        raise WorkflowError("本機 .env 尚未填好必要設定：" + ", ".join(missing))
    if not (ROOT / "frontend" / "node_modules").is_dir():
        print("\n第一次執行：安裝前端依賴 ...")
        run(npm_command("ci", subcommand=None), cwd=ROOT / "frontend")
    return supabase


def npm_command(script: str, subcommand: str | None = "run") -> list[str]:
    npm = shutil.which("npm.cmd") if os.name == "nt" else shutil.which("npm")
    if not npm:
        npm = shutil.which("npm")
    if not npm:
        raise WorkflowError("找不到 npm。")
    if os.name == "nt" and npm.lower().endswith((".cmd", ".bat")):
        words = f"{subcommand} {script}" if subcommand else script
        return [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", f"npm.cmd {words}"]
    return [npm, subcommand, script] if subcommand else [npm, script]


def start_development(supabase: str) -> None:
    print("\n啟動本機 Supabase（CLI 輸出隱藏，以免顯示本機金鑰）...")
    run_quiet([supabase, "start"])
    run(["docker", "compose", *DEV_COMPOSE, "up", "-d", "--build"])
    print("\n開發服務已啟動：")
    print("  前端：  http://127.0.0.1:3000")
    print("  後端：  http://127.0.0.1:8000/api/health")
    print("  Studio：http://127.0.0.1:54323")
    print("請在 VS Code 修改程式；完成後回到這個終端輸入 end。")


def run_end_checks() -> None:
    compose = ["docker", "compose", *DEV_COMPOSE]
    run(compose + ["stop", "frontend"])
    run(npm_command("typecheck"), cwd=ROOT / "frontend")
    run(npm_command("build"), cwd=ROOT / "frontend")
    run(compose + ["exec", "-T", "backend", "python", "-"], input_text=SMOKE_TEST)
    run(compose + ["down"])
    run(["docker", "compose", "build", "frontend", "backend"])


def is_server_machine() -> bool:
    if not MACHINE_CONFIG.is_file():
        answer = input("\n這台電腦是不是家裡的伺服器（網站要在這台上線）？輸入 yes 或 no（只會問一次）：")
        MACHINE_CONFIG.write_text(
            f"IS_SERVER={'true' if answer.strip().lower() == 'yes' else 'false'}\n", encoding="utf-8"
        )
    return read_env_file(MACHINE_CONFIG).get("IS_SERVER") == "true"


def has_git_repo() -> bool:
    return (ROOT / ".git").is_dir() and shutil.which("git") is not None


def publish_to_github() -> None:
    if not has_git_repo():
        print("\n此資料夾還不是 Git 專案，略過推送 GitHub。")
        return
    changes = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=False
    ).stdout.strip()
    if changes:
        message = input("\n提交說明（直接按 Enter 使用「update」）：").strip() or "update"
        run(["git", "add", "-A"])
        run(["git", "commit", "-m", message])
    run(["git", "push"])


def wait_for_http(url: str, attempts: int = 30) -> None:
    import time
    import urllib.request

    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(2)
    raise WorkflowError(f"健康檢查失敗：{url}")


def deploy_local(supabase: str) -> None:
    run_quiet([supabase, "start"])
    token = read_env_file(ROOT / ".env").get("TUNNEL_TOKEN", "")
    profile = [] if not token or token.startswith("replace-with-") else ["--profile", "tunnel"]
    run(["docker", "compose", *profile, "up", "-d", "--build", "--wait"])
    model = read_env_file(ROOT / ".env").get("OLLAMA_CHAT_MODEL", "qwen2.5:3b")
    run(["docker", "compose", "exec", "-T", "ollama", "ollama", "pull", model])
    wait_for_http("http://127.0.0.1:8000/api/health")
    wait_for_http("http://127.0.0.1:3000")
    print("\n已上線：前端 http://127.0.0.1:3000，後端 http://127.0.0.1:8000/api/health")


def configure_console() -> None:
    if os.name == "nt":
        import ctypes

        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    configure_console()
    print("AI 工作平台：yes = 開始開發；deploy = 拉最新程式並上線（僅伺服器）。")
    try:
        supabase = check_local_setup()
        while True:
            answer = input("\n請輸入 yes 或 deploy：").strip().lower()
            if answer in ("yes", "deploy"):
                break
            print("請輸入 yes 或 deploy。")
        if answer == "deploy":
            if not is_server_machine():
                raise WorkflowError("這台不是伺服器，不能 deploy。")
            if has_git_repo():
                run(["git", "pull", "--ff-only"])
            deploy_local(supabase)
            return 0
        start_development(supabase)
        while True:
            if input("\n開發完成後輸入 end：").strip().lower() == "end":
                break
            print("開發服務持續執行；完成後請輸入 end。")
        run_end_checks()
        publish_to_github()
        if is_server_machine():
            deploy_local(supabase)
            print("\n測試、build、推送 GitHub 與本機上線全部完成。")
        else:
            print("\n測試、build 與推送 GitHub 完成。回家後在伺服器執行同一指令並輸入 deploy。")
        return 0
    except (WorkflowError, OSError, KeyboardInterrupt) as exc:
        if isinstance(exc, KeyboardInterrupt):
            print("\n已取消流程。")
            return 130
        print(f"\n流程停止：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
