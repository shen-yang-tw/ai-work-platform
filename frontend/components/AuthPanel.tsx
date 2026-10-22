// frontend/components/AuthPanel.tsx
'use client';

// 內嵌登入面板：因為本專案只允許 4 個頁面路由，所以登入直接在首頁區塊內完成，不另開登入頁。
import { useId, useState, type FormEvent } from 'react';
// isAuthRetryableFetchError 用來判斷是否為網路層失敗（例如 Supabase 服務沒有啟動）
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
// Toast 用於註冊成功後的提示，因為成功後此面板會被卸載
import { toast } from 'sonner';
import { useApp } from '@/components/Providers';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSupabase } from '@/lib/supabase';

// 錯誤訊息的翻譯 key 集合，集中定義避免拼錯
type AuthErrorKey = 'auth.failed' | 'auth.networkError' | 'auth.invalidInput';
// 面板的兩種模式：登入或註冊，標題、按鈕與送出行為都依模式決定
type AuthMode = 'signIn' | 'signUp';

export function AuthPanel() {
  const { t } = useApp();
  // useId 產生穩定唯一的 id，讓 label 與 input 正確關聯（無障礙必要）
  const headingId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // busy 期間禁止重複送出
  const [busy, setBusy] = useState(false);
  // 錯誤訊息的 key；null 表示沒有錯誤
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);
  // 註冊完成的提示：送出後顯示在狀態區，不再沿用登入的標題
  const [signUpDone, setSignUpDone] = useState(false);

  // 檢查輸入是否合法：信箱不可為空，密碼至少 6 字元（與 Supabase 預設規則一致）
  // 合法回傳 null，不合法回傳錯誤 key
  function validateInput(): AuthErrorKey | null {
    if (!email.trim() || password.length < 6) {
      return 'auth.invalidInput';
    }
    return null;
  }

  // 把 Supabase 的錯誤轉成使用者看得懂的訊息：網路錯誤與帳密錯誤要分開顯示
  function toErrorKey(error: unknown): AuthErrorKey {
    return isAuthRetryableFetchError(error) ? 'auth.networkError' : 'auth.failed';
  }

  // 切換模式時清除上一個模式殘留的錯誤與結果提示
  function switchMode(next: AuthMode) {
    setMode(next);
    setErrorKey(null);
    setSignUpDone(false);
  }

  // 送出表單：依目前模式決定是登入還是註冊，兩者的邏輯完全分開
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 阻止表單預設的整頁重新載入
    event.preventDefault();
    setSignUpDone(false);
    const invalid = validateInput();
    if (invalid) {
      setErrorKey(invalid);
      return;
    }
    setBusy(true);
    setErrorKey(null);
    // try/finally 確保無論成功、失敗或拋出例外，都會解除 busy，避免按鈕永久停用
    try {
      const supabase = getSupabase();
      const trimmedEmail = email.trim();
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        if (error) {
          setErrorKey(toErrorKey(error));
          return;
        }
        // 成功時 AuthGate 會透過 onAuthStateChange 自動切換畫面、面板會被卸載，所以改用全域 Toast 告知使用者
        toast.success(t('auth.signInSuccess'));
        return;
      }
      const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });
      if (error) {
        setErrorKey(toErrorKey(error));
        return;
      }
      // 若專案沒有開啟信箱驗證，註冊會直接帶回 session，AuthGate 會自動進入頁面
      // 面板此時會被卸載，所以改用全域 Toast 告知使用者已註冊並登入
      if (data.session) {
        toast.success(t('auth.signUpSuccess'));
      } else {
        setSignUpDone(true);
      }
    } catch {
      // 例如環境變數缺少時 getSupabase 會拋出例外
      setErrorKey('auth.failed');
    } finally {
      setBusy(false);
    }
  }

  // 狀態提示文字：處理中顯示進度，註冊完成顯示結果；沒有狀態時為空字串
  const statusText = busy
    ? t(mode === 'signIn' ? 'auth.signingIn' : 'auth.signingUp')
    : signUpDone
      ? t('auth.signUpDone')
      : '';

  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-md rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
      {/* 登入／註冊切換放在區塊最上方，使用 shadcn Tabs（底線樣式）；方向鍵與 Enter/Space 由 Radix 處理 */}
      <Tabs value={mode} onValueChange={(next) => switchMode(next as AuthMode)} className="gap-4">
        <TabsList aria-label={t('auth.modeGroup')}>
          <TabsTrigger value="signIn" disabled={busy}>
            {t('auth.signIn')}
          </TabsTrigger>
          <TabsTrigger value="signUp" disabled={busy}>
            {t('auth.signUp')}
          </TabsTrigger>
        </TabsList>

        {/* 內容區只渲染目前選中的模式，標題、說明、狀態與表單都跟著切換 */}
        <TabsContent value={mode} className="space-y-4">
          <h2 id={headingId} className="text-xl font-semibold">
            {mode === 'signIn' ? t('auth.title') : t('auth.signUpTitle')}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {mode === 'signIn' ? t('auth.description') : t('auth.signUpDescription')}
          </p>

          {/* 狀態區常駐在 DOM 中，內容變化時螢幕閱讀器才會朗讀；沒有文字時由 empty:hidden 隱藏 */}
          <div
            role="status"
            aria-live="polite"
            className={`empty:hidden rounded p-3 text-sm ${
              signUpDone
                ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300'
                : 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
            }`}
          >
            {statusText}
          </div>

          {/* 錯誤訊息用 role="alert"，出現時螢幕閱讀器會立刻朗讀 */}
          {errorKey && (
            <p id={errorId} role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {t(errorKey)}
            </p>
          )}

          <form onSubmit={handleSubmit} aria-describedby={errorKey ? errorId : undefined} aria-busy={busy} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor={emailId} className="block text-sm font-medium">
                {t('auth.email')}
              </label>
              <input
                id={emailId}
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={passwordId} className="block text-sm font-medium">
                {t('auth.password')}
              </label>
              <input
                id={passwordId}
                type="password"
                name="password"
                // 登入用 current-password，註冊用 new-password，讓密碼管理工具知道要帶入或建議新密碼
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700"
              />
            </div>

            {/* 送出按鈕文字跟著模式變化，讓使用者清楚知道按下去會做什麼；按 Enter 也會送出目前模式的表單 */}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {mode === 'signIn' ? t('auth.signIn') : t('auth.submitSignUp')}
            </button>
          </form>
        </TabsContent>
      </Tabs>
    </section>
  );
}
