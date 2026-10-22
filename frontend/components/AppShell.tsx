// frontend/components/AppShell.tsx
'use client';

// 應用外框：跳至內容連結、頂部導覽列、語言與主題切換、登出按鈕。所有頁面都會包在這裡面。
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useApp } from '@/components/Providers';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabase';
import type { MessageKey } from '@/lib/i18n';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

// 導覽列項目，固定只有 4 個路由
const NAV_ITEMS: { href: string; labelKey: MessageKey }[] = [
  { href: '/', labelKey: 'nav.chat' },
  { href: '/knowledge', labelKey: 'nav.knowledge' },
  { href: '/tuning', labelKey: 'nav.tuning' },
  { href: '/settings', labelKey: 'nav.settings' },
];

export function AppShell({ children }: { children: ReactNode }) {
  // 取得語言與主題狀態，以及翻譯函式
  const { t, locale, theme, setLocale, setTheme } = useApp();
  // 取得目前路徑，用來標示導覽列中的目前頁面
  const pathname = usePathname();
  // 是否已登入，決定要不要顯示登出按鈕
  const [signedIn, setSignedIn] = useState(false);
  // 目前登入的電子郵件，顯示在頂部讓使用者確認自己正在使用哪個帳號
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // 訂閱登入狀態變化，登入或登出時自動更新按鈕與帳號顯示
  useEffect(() => {
    const supabase = getSupabase();
    // 回呼參數要明確標註型別：Supabase 這個方法有多載，TypeScript 無法自動推斷參數型別
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setSignedIn(Boolean(session));
      setUserEmail(session?.user.email ?? null);
    });
    // 元件卸載時取消訂閱，避免記憶體洩漏
    return () => data.subscription.unsubscribe();
  }, []);

  // 登出：只登出目前這台瀏覽器（scope: 'local'），其他裝置的登入保留；全部裝置登出請到設定頁操作
  async function handleSignOut() {
    const { error } = await getSupabase().auth.signOut({ scope: 'local' });
    if (error) {
      toast.error(t('err.generic'));
      return;
    }
    toast.success(t('common.signedOut'));
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* 跳至內容連結：平常隱藏，鍵盤按 Tab 第一次時才出現，方便跳過導覽列 */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-zinc-900 focus:shadow dark:focus:bg-zinc-900 dark:focus:text-zinc-100"
      >
        {t('common.skip')}
      </a>

      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          {/* 網站名稱：用 h1 標示，但頁面主要標題由各頁自己的 h2 負責 */}
          <h1 className="text-lg font-semibold">{t('common.appName')}</h1>

          <div className="flex flex-wrap items-center gap-2">
            {/* 主要導覽：nav 元素加上 aria-label，讓螢幕閱讀器知道這是哪一組連結 */}
            <nav aria-label={t('nav.label')}>
              <ul className="flex flex-wrap gap-1">
                {NAV_ITEMS.map((item) => {
                  // 目前頁面判斷：首頁只有完全等於 / 才算作用中
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        // aria-current="page" 告訴螢幕閱讀器這是目前所在的頁面
                        aria-current={active ? 'page' : undefined}
                        className={`inline-block rounded px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                          active
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* 語言切換：依目前語言顯示對應的切換按鈕文字與 aria-label */}
            <button
              type="button"
              onClick={() => setLocale(locale === 'zh-TW' ? 'en' : 'zh-TW')}
              aria-label={locale === 'zh-TW' ? t('common.switchLanguage') : t('common.switchLanguageZh')}
              className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {locale === 'zh-TW' ? 'EN' : '中文'}
            </button>

            {/* 主題切換：aria-pressed 表示目前是否為深色模式 */}
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-pressed={theme === 'dark'}
              aria-label={theme === 'dark' ? t('common.themeToLight') : t('common.themeToDark')}
              className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {theme === 'dark' ? t('common.themeLight') : t('common.themeDark')}
            </button>

            {/* 登出按鈕與帳號顯示只在已登入時出現 */}
            {signedIn && userEmail && (
              <span className="max-w-[16rem] truncate text-sm text-zinc-600 dark:text-zinc-400" title={userEmail}>
                {t('common.signedInAs', { email: userEmail })}
              </span>
            )}
            {signedIn && (
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('common.signOut')}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 主要內容區：id="main" 是跳至內容連結的目標，tabIndex=-1 讓連結跳轉後焦點能真正移過來 */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 focus:outline-none">
        {/* AuthGate 負責判斷登入狀態：未登入顯示登入面板，已登入才顯示頁面內容 */}
        <AuthGate>{children}</AuthGate>
      </main>
    </div>
  );
}
