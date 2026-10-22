// frontend/postcss.config.mjs
// PostCSS 設定：Tailwind CSS v4 透過 @tailwindcss/postcss 外掛整合到 Next.js 的 CSS 管線。

// 以物件形式註冊外掛，key 是外掛名稱，值是空物件代表使用預設選項
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
