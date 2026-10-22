// frontend/lib/supabase.ts
// Supabase 瀏覽器端客戶端。只使用 anon 公開金鑰（設計上可公開），真正的資料權限由資料庫 RLS 與後端 JWT 驗證把關。

// createBrowserClient 會把登入 session 存進瀏覽器 cookie，重新整理頁面後仍保持登入
import { createBrowserClient } from '@supabase/ssr';
// SupabaseClient 型別讓 auth、from 等方法有完整的型別推斷
import type { SupabaseClient } from '@supabase/supabase-js';

// 讀取環境變數並清理：去除前後空白與換行，防止編輯器自動換行造成驗證失敗
function cleanEnv(value: string | undefined, name: string): string {
  const cleaned = (value ?? '').trim().replace(/\n/g, '').replace(/\r/g, '');
  if (!cleaned) {
    throw new Error(`缺少環境變數 ${name}，請檢查 .env 設定`);
  }
  return cleaned;
}

// 整個應用共用同一個 Supabase 實例，避免重複監聽登入狀態
let client: SupabaseClient | null = null;

// 取得單例客戶端；只能在事件處理或 useEffect 中呼叫，避免建置時就讀取環境變數
export function getSupabase(): SupabaseClient {
  if (!client) {
    // NEXT_PUBLIC_ 變數會在建置時寫入程式碼，所以必須用字面量直接讀取，不能用動態 key
    client = createBrowserClient(
      cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
      cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    );
  }
  return client;
}
