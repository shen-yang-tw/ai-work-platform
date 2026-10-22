// frontend/app/layout.tsx
// 根版面：Next.js 會把這個檔案包在所有頁面外面。它是伺服器元件，負責 HTML 骨架、中繼資料與主題初始化。
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// 匯入全域樣式（Tailwind 與自訂變數）
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';

// 頁面標題與描述，給瀏覽器分頁與搜尋引擎使用
export const metadata: Metadata = {
  title: 'AI 工作平台 & 向量模型',
  description: '個人使用的 AI 對話、文件向量化、模型調校與提示詞管理平台',
  // 個人工具不希望被搜尋引擎收錄
  robots: { index: false, follow: false },
};

// 在頁面水合（hydration）前就先加上 dark class，避免深色使用者先看到白畫面再跳成黑色
const themeInitScript = `(function(){try{if(localStorage.getItem('theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // lang 預設為繁體中文，suppressHydrationWarning 允許 dark class 在水合前被修改而不報警告
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        {/* 內容是固定字串，不含使用者輸入，所以用 dangerouslySetInnerHTML 是安全的 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
