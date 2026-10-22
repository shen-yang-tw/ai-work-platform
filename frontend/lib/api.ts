// frontend/lib/api.ts
// 後端 API 呼叫工具：自動附上 Supabase JWT、解析 SSE 串流、統一錯誤格式。

// 取得 Supabase 客戶端以讀取目前登入者的 token
import { getSupabase } from '@/lib/supabase';
// 錯誤訊息的 key 型別，供 apiErrorKey 回傳；messages 與 Locale 用來在自動登出時顯示提示
import { messages, type Locale, type MessageKey } from '@/lib/i18n';
// 讀取使用者偏好的語言，讓非 React 的程式碼也能顯示對應語言的提示
import { readLocal } from '@/lib/prefs';
// Toast 提示元件，與 Providers 中的 Toaster 配對
import { toast } from 'sonner';

// 後端基底網址：去除前後空白、換行與結尾斜線，避免拼接出錯
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '')
  .trim()
  .replace(/\n/g, '')
  .replace(/\r/g, '')
  .replace(/\/+$/, '');

// 統一的 API 錯誤，帶有 HTTP 狀態碼；畫面依狀態碼顯示多語系訊息，不直接顯示後端原始文字
export class ApiError extends Error {
  status: number;
  // 是否因登入已被撤銷而自動登出；畫面據此只顯示「登入已失效」提示
  sessionEnded: boolean;
  constructor(status: number, message: string, sessionEnded = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.sessionEnded = sessionEnded;
  }
}

// 取得目前登入者的 access token；沒有登入時丟出 401
async function getAccessToken(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError(401, 'unauthenticated');
  }
  return token;
}

// 後端回 401 時，先嘗試刷新登入；刷新失敗代表登入已被登出撤銷，就清掉本機登入狀態讓畫面回到登入頁。回傳是否因此自動登出
async function handleUnauthorized(status: number): Promise<boolean> {
  if (status !== 401) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    await supabase.auth.signOut({ scope: 'local' });
    // 自動登出時告知使用者原因，避免畫面突然跳回登入頁；與頁面錯誤提示使用同一 id，確保只顯示一則
    const locale: Locale = readLocal('locale') === 'en' ? 'en' : 'zh-TW';
    toast.error(messages[locale]['auth.sessionEnded'], { id: 'auth.sessionEnded' });
    return true;
  }
  return false;
}

// 一般 JSON 請求。body 是 FormData 時原樣送出，讓瀏覽器自動加上 multipart 邊界
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) {
    // 不手動設定 Content-Type，讓瀏覽器自動帶上 multipart boundary
    body = init.body;
  } else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const sessionEnded = await handleUnauthorized(res.status);
    throw new ApiError(res.status, `HTTP ${res.status}`, sessionEnded);
  }
  return (await res.json()) as T;
}

// SSE 單一事件的格式：事件名稱與已解析的 JSON 資料
export type SseEvent = { event: string; data: unknown };

// 解析一個以空行結束的 SSE 區塊；沒有資料行或 JSON 壞掉時回傳 null
function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

// 以 POST 發送請求並逐段讀取 SSE 串流。後端只使用 \n 換行，所以以 \n\n 切割事件
export async function streamSse(
  path: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    const sessionEnded = await handleUnauthorized(res.status);
    throw new ApiError(res.status, `HTTP ${res.status}`, sessionEnded);
  }
  if (!res.body) {
    throw new ApiError(500, 'empty response body');
  }

  // getReader 讓我們可以一段一段讀取，而不是等整個回應結束
  const reader = res.body.getReader();
  // TextDecoder 處理多位元組字元（中文）被切在兩段之間的情況
  const decoder = new TextDecoder('utf-8');
  // 尚未組成完整事件的文字暫存區
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // stream: true 讓解碼器保留未完成的位元組，等下一段再接上
    buffer += decoder.decode(value, { stream: true });

    // 每遇到一個空行，就代表一個完整事件已到達
    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const parsed = parseBlock(block);
      if (parsed) onEvent(parsed);
      separator = buffer.indexOf('\n\n');
    }
  }

  // 串流結束後把解碼器剩下的內容沖出來，並處理最後一個沒有空行結尾的事件
  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = parseBlock(buffer);
    if (parsed) onEvent(parsed);
  }
}

// 把任意錯誤轉成多語系訊息的 key，畫面用 t(apiErrorKey(err)) 顯示
export function apiErrorKey(err: unknown): MessageKey {
  if (err instanceof ApiError) {
    // 已自動登出時改用同一則「登入已失效」提示，避免與一般「請重新登入」重複出現
    if (err.sessionEnded) return 'auth.sessionEnded';
    if (err.status === 401 || err.status === 403) return 'err.auth';
    if (err.status === 429) return 'err.rateLimit';
    if (err.status === 413) return 'err.tooLarge';
    if (err.status === 422) return 'err.invalid';
    if (err.status >= 500) return 'err.server';
  }
  return 'err.generic';
}
