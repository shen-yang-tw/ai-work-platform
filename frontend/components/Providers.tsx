// frontend/components/Providers.tsx
'use client';

// 全域狀態（語言、主題）與通知系統的提供者。必須是客戶端元件，因為要讀寫 localStorage 與 DOM。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
// sonner 的 Toaster：負責顯示右上角或頂部的 Toast 通知，本身帶有 aria-live 讓螢幕閱讀器朗讀
import { Toaster } from 'sonner';
import { messages, type Locale, type MessageKey } from '@/lib/i18n';
import { readLocal, writeLocal } from '@/lib/prefs';

// 主題只有淺色與深色兩種
type Theme = 'light' | 'dark';

// 全域 Context 的內容型別
type AppContextValue = {
  locale: Locale;
  theme: Theme;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  // 翻譯函式：依目前語言取文字，並把 {name} 佔位符換成傳入的值
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

// 建立 Context，預設值為 null，用來偵測是否忘記包 Provider
const AppContext = createContext<AppContextValue | null>(null);

// 提供者元件：包住整個應用，讓所有子元件都能用 useApp() 取得語言與主題
export function Providers({ children }: { children: ReactNode }) {
  // 伺服器端渲染時預設為繁體中文與淺色，等掛載後再讀取使用者偏好，避免水合不一致
  const [locale, setLocaleState] = useState<Locale>('zh-TW');
  const [theme, setThemeState] = useState<Theme>('light');
  // ready 旗標：確認已讀取使用者偏好後，才允許同步 dark class，避免提前清掉 layout 初始化腳本加上的 dark
  const [ready, setReady] = useState(false);

  // 掛載後讀取 localStorage 中的語言與主題偏好
  useEffect(() => {
    const savedLocale = readLocal('locale');
    if (savedLocale === 'en' || savedLocale === 'zh-TW') {
      setLocaleState(savedLocale);
    }
    setThemeState(readLocal('theme') === 'dark' ? 'dark' : 'light');
    setReady(true);
  }, []);

  // 語言改變時同步 <html lang>，讓螢幕閱讀器使用正確的語音
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // 主題改變時切換 <html> 的 dark class，Tailwind 的 dark: 樣式依此生效
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme, ready]);

  // 設定語言並記住選擇
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeLocal('locale', next);
  }, []);

  // 設定主題並記住選擇
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeLocal('theme', next);
  }, []);

  // 翻譯函式依目前語言查表
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      let text = messages[locale][key];
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          // 用 split/join 取代所有出現的 {name}，不需要 replaceAll 的較新語法
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    },
    [locale],
  );

  // 把值包進 useMemo，避免每次渲染都產生新物件而讓所有消費者重新渲染
  const value = useMemo(
    () => ({ locale, theme, setLocale, setTheme, t }),
    [locale, theme, setLocale, setTheme, t],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      {/* 通知容器：依主題切換顏色，richColors 讓成功與錯誤有不同底色 */}
      <Toaster richColors closeButton position="top-center" theme={theme} />
    </AppContext.Provider>
  );
}

// 取用全域狀態的 Hook；若元件不在 Providers 內就丟出錯誤，方便及早發現
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp 必須在 Providers 內使用');
  }
  return ctx;
}
