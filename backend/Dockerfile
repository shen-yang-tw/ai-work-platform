# backend/Dockerfile
# 後端多階段建置：第一階段安裝依賴，第二階段只複製成品，最終映像不含編譯工具與原始快取。

# ---------- 第一階段：建置依賴 ----------
# slim 基礎映像體積小，且相容 Python 3.15 的預編譯套件
FROM python:3.15-slim AS builder

# 不產生 .pyc 快取與 pip 快取，減少層的大小
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# 把虛擬環境建立在固定路徑，之後整個複製到第二階段
RUN python -m venv /opt/venv

# 先只複製依賴清單，這樣程式碼變動時不會讓依賴層失效重建
WORKDIR /build
COPY requirements.txt .
RUN /opt/venv/bin/pip install -r requirements.txt

# ---------- 開發環境：掛載原始碼並啟用自動重載 ----------
FROM builder AS development
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--no-server-header"]

# ---------- 第二階段：執行環境 ----------
FROM python:3.15-slim AS runtime

# PYTHONDONTWRITEBYTECODE 避免在唯讀根檔案系統寫入 .pyc；PYTHONUNBUFFERED 讓日誌即時輸出
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# 建立沒有登入權限的系統使用者 appuser，避免以 root 執行服務
RUN groupadd --system appuser \
    && useradd --system --gid appuser --home-dir /app --shell /usr/sbin/nologin appuser

WORKDIR /app

# 從建置階段複製已安裝好的虛擬環境
COPY --from=builder /opt/venv /opt/venv
# 只複製應用程式原始碼，.env 與測試檔案由 .dockerignore 排除
COPY app ./app

# 切換到非特權使用者後才啟動服務
USER appuser

EXPOSE 8000

# 每 30 秒檢查一次健康端點，失敗就讓容器標示為不健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)"

# 只使用單一 worker：速率限制存在記憶體中，多 worker 會讓限制失效
# --no-server-header 避免洩漏伺服器版本
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-server-header"]
