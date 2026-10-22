// frontend/next.config.js
// Next.js 設定檔。output: 'standalone' 會把執行所需的檔案集中到 .next/standalone，讓 Docker 映像可以極小化。

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 產生獨立伺服器輸出，Docker 第二階段只需要複製這個資料夾
  output: 'standalone',
  // 開啟 React 嚴格模式，開發時提早發現副作用與不安全的生命週期問題
  reactStrictMode: true,
  // 不對外暴露 X-Powered-By 標頭，減少指紋資訊
  poweredByHeader: false,
  // 開發模式預設會擋下跨來源的 HMR 與資源請求；這裡只允許本機位址，避免首頁卡在骨架屏
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

module.exports = nextConfig;
