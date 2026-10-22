# backend/app/repositories/usage_repo.py
# 每日用量資料存取。所有寫入都由後端完成，使用者無法直接改寫額度。

# 日期型別，用來指定今天（UTC）
from datetime import datetime, timezone

# 資料庫連線工具
from app.core.db import db_connection


def _today_utc():
    # 以 UTC 日期作為每日額度的分界，與資料表預設值一致
    return datetime.now(timezone.utc).date()


def get_user_usage_today(user_id: str) -> dict:
    # 查詢此使用者今天的用量，若沒有紀錄則回傳 0
    with db_connection() as conn:
        # 使用參數化查詢，%s 的值由驅動程式安全地代入，防止 SQL 注入
        row = conn.execute(
            "select tokens, uploads, requests from public.usage_daily where user_id = %s and day = %s",
            (user_id, _today_utc()),
        ).fetchone()
    # 若沒有紀錄，代表今天還沒有任何用量
    if row is None:
        return {"tokens": 0, "uploads": 0, "requests": 0}
    return dict(row)


def get_global_tokens_today() -> int:
    # 加總全站今天的 Token 用量，用於全站每日上限檢查
    with db_connection() as conn:
        row = conn.execute(
            "select coalesce(sum(tokens), 0) as total from public.usage_daily where day = %s",
            (_today_utc(),),
        ).fetchone()
    return int(row["total"])


def add_usage(user_id: str, tokens: int = 0, uploads: int = 0, requests: int = 0) -> None:
    # 新增或累加今天的用量；若當天還沒有紀錄就插入，有就更新
    with db_connection() as conn:
        conn.execute(
            """
            insert into public.usage_daily (user_id, day, tokens, uploads, requests)
            values (%s, %s, %s, %s, %s)
            on conflict (user_id, day) do update set
              tokens = public.usage_daily.tokens + excluded.tokens,
              uploads = public.usage_daily.uploads + excluded.uploads,
              requests = public.usage_daily.requests + excluded.requests
            """,
            (user_id, _today_utc(), tokens, uploads, requests),
        )
        # 明確提交交易，確保用量真的寫入資料庫
        conn.commit()
