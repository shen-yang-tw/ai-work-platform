# backend/app/core/rate_limit.py
# 記憶體內的滑動視窗限流：分為「每位使用者每分鐘」與「全站每分鐘」兩層保護。

# time.monotonic 不受系統時間調整影響，適合計算間隔
import time
# deque 是雙端佇列，適合快速丟掉過期的時間戳
from collections import defaultdict, deque
# threading.Lock 保護共享狀態，避免多執行緒同時修改字典
from threading import Lock

# FastAPI 的 HTTP 例外，用來回傳 429
from fastapi import HTTPException, status

# 讀取各種上限設定
from app.core.config import settings

# 每位使用者的請求時間戳佇列
_user_windows: dict[str, deque[float]] = defaultdict(deque)
# 全站共用的請求時間戳佇列
_global_window: deque[float] = deque()
# 保護上面兩個結構的鎖
_lock = Lock()
# 滑動視窗長度：60 秒
_WINDOW_SECONDS = 60.0


def _trim(window: deque[float], now: float) -> None:
    # 只要最舊的時間戳超過 60 秒，就從左側移除
    while window and now - window[0] > _WINDOW_SECONDS:
        window.popleft()


def check_ai_rate_limit(user_id: str) -> None:
    # 取得目前的單調時間
    now = time.monotonic()
    # 進入臨界區，確保計數正確
    with _lock:
        # 取出此使用者的視窗並清除過期紀錄
        user_window = _user_windows[user_id]
        _trim(user_window, now)
        _trim(_global_window, now)

        # 先檢查全站上限，若已滿就直接拒絕
        if len(_global_window) >= settings.global_rpm_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="目前全站請求過多，請稍後再試",
                headers={"Retry-After": "60"},
            )
        # 再檢查單一使用者上限
        if len(user_window) >= settings.user_rpm_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="請求太頻繁，請稍後再試",
                headers={"Retry-After": "60"},
            )

        # 兩層都通過，記錄這一次請求
        user_window.append(now)
        _global_window.append(now)
