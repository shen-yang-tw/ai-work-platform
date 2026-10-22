# backend/app/services/budget.py
# 每日 Token 額度檢查。在呼叫任何付費或有限額的模型前先檢查，超過上限就拒絕。

# 讀取上限設定
from app.core.config import settings
# 讀取使用者與全站今天的用量
from app.repositories import usage_repo


class BudgetExceeded(Exception):
    # 額度用完時丟出的錯誤，訊息會原樣顯示給使用者，因此不含任何內部資訊
    pass


def ensure_budget(user_id: str) -> None:
    # 先檢查單一使用者的每日上限
    user_usage = usage_repo.get_user_usage_today(user_id)
    if user_usage["tokens"] >= settings.user_daily_token_limit:
        raise BudgetExceeded("今日個人 Token 額度已用完，請明天再試")

    # 再檢查全站的每日上限，保護整體預算
    if usage_repo.get_global_tokens_today() >= settings.global_daily_token_limit:
        raise BudgetExceeded("今日全站 Token 額度已用完，請明天再試")


def estimate_tokens(text: str) -> int:
    # 粗估 Token 數：一般英文約 4 字元 1 Token，中文較接近 1 字 1 Token，這裡取保守的 2 字元 1 Token
    return max(1, len(text) // 2)
