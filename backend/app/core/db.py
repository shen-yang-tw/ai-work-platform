# backend/app/core/db.py
# 資料庫連線池。後端使用 Postgres 直連，並以 psycopg 的參數化查詢防止 SQL 注入。

# contextlib 讓我們用 with 語法安全地借還連線
from contextlib import contextmanager
# Iterator 用來標註產生器型別
from typing import Iterator
# 連線池與字典型資料列工廠
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# 讀取 DATABASE_URL 等設定
from app.core.config import settings

# 模組層級的連線池變數，第一次使用時才建立（延遲初始化）
_pool: ConnectionPool | None = None


def _get_pool() -> ConnectionPool:
    # 宣告使用模組層級的變數，才能在函式內修改它
    global _pool
    # 若連線字串未設定，直接報錯，避免無聲失敗
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL 尚未設定")
    # 第一次呼叫時才建立連線池，之後重複使用同一個池
    if _pool is None:
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            # 最少保持 1 條連線，最多 5 條，避免耗盡資料庫連線數
            min_size=1,
            max_size=5,
            # 指定查詢結果以字典形式回傳，欄位用名稱存取更清楚
            kwargs={"row_factory": dict_row},
            # 立即開啟連線池，若連線失敗會在啟動時就能看到錯誤
            open=True,
        )
    return _pool


@contextmanager
def db_connection() -> Iterator:
    # 從連線池借出一條連線
    with _get_pool().connection() as conn:
        # 離開 with 區塊時，連線會自動歸還到連線池
        yield conn


def close_pool() -> None:
    # 關閉連線池，供應用程式關閉時呼叫，釋放資料庫連線
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
