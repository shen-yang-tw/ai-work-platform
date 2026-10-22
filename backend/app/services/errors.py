# backend/app/services/errors.py
# 統一的供應商錯誤型別。Gemini 或 Ollama 失敗時都丟出這個例外，讓上層用同一種方式處理。


class ProviderError(Exception):
    # 繼承 Exception，錯誤訊息只放不含機密的描述，不包含金鑰或完整回應內容
    pass
