// frontend/lib/prefs.ts
// 瀏覽器本地偏好設定的讀寫工具：草稿快取、調校參數等。所有存取都包在 try/catch，隱私模式或空間不足時不會崩潰。

// 伺服器端渲染時沒有 window 與 localStorage，所以先檢查是否可用
function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

// 讀取字串，不存在或失敗時回傳 null
export function readLocal(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// 寫入字串，失敗時靜默忽略（草稿只是備份，不應影響主要功能）
export function writeLocal(key: string, value: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 寫入失敗（例如空間已滿）時不處理
  }
}

// 模型調校參數的型別與預設值
export type TuningParams = { temperature: number; maxTokens: number };
export const DEFAULT_TUNING: TuningParams = { temperature: 0.7, maxTokens: 1024 };
// 儲存調校參數的 localStorage key
const TUNING_KEY = 'tuning:params';

// 讀取調校參數並做範圍檢查；JSON 壞掉或數值超出範圍時改用預設值
export function readTuning(): TuningParams {
  const raw = readLocal(TUNING_KEY);
  if (!raw) return DEFAULT_TUNING;
  try {
    const parsed = JSON.parse(raw) as Partial<TuningParams>;
    // 溫度限制在 0 到 2 之間，與後端 schema 一致
    const temperature = typeof parsed.temperature === 'number'
      ? Math.min(2, Math.max(0, parsed.temperature))
      : DEFAULT_TUNING.temperature;
    // 最大 Token 限制在 1 到 4096 之間，與後端 schema 一致
    const maxTokens = typeof parsed.maxTokens === 'number'
      ? Math.min(4096, Math.max(1, Math.round(parsed.maxTokens)))
      : DEFAULT_TUNING.maxTokens;
    return { temperature, maxTokens };
  } catch {
    return DEFAULT_TUNING;
  }
}

// 把調校參數以 JSON 格式存入瀏覽器
export function writeTuning(params: TuningParams): void {
  writeLocal(TUNING_KEY, JSON.stringify(params));
}
