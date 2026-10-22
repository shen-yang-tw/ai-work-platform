# frontend/Dockerfile
# Next.js 多階段建置：deps（安裝依賴）→ builder（編譯）→ runner（只保留 standalone 產物，使用非特權 node 使用者執行）

# ---------- 共用基底：node 22 alpine 體積小，符合 Next.js 16 的 Node 版本需求 ----------
FROM node:22-alpine AS base
# 關閉 Next.js 遙測，避免容器內對外送出使用資料
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- 階段一：安裝依賴 ----------
FROM base AS deps
WORKDIR /app
# 只先複製套件清單，讓依賴層能被快取，程式碼改動時不必重裝套件
COPY package.json package-lock.json* ./
# 有 lockfile 就用 npm ci 精確還原版本；沒有就退回 npm install
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# ---------- 階段二：編譯 ----------
FROM base AS builder
WORKDIR /app
# NEXT_PUBLIC_* 會在 build 時被直接寫進 JavaScript，所以必須以 build arg 傳入，不能只放在執行期環境變數
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# 把第一階段裝好的依賴搬過來
COPY --from=deps /app/node_modules ./node_modules
# 複製原始碼（.dockerignore 會排除 .env、node_modules 等不該進映像檔的東西）
COPY . .
RUN npm run build

# ---------- 階段三：最終執行映像（最小化） ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# standalone 模式只包含執行所需的最小檔案與 node_modules 子集，體積遠小於完整專案
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# 切換為映像檔內建的非特權使用者 node，不以 root 執行
USER node
EXPOSE 3000
# 每 30 秒檢查一次首頁是否回應，讓 Docker 能判斷容器是否健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/ > /dev/null || exit 1
CMD ["node", "server.js"]
