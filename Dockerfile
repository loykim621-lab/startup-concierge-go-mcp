# 창업지원 컨시어지GO MCP — 카카오클라우드 배포용 컨테이너 (Streamable HTTP)
# 멀티스테이지: builder에서 컴파일 → runtime에 dist + 운영 의존성 + 수집 데이터만 탑재.

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV PORT=8080
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# 수집된 공고 스토어(실데이터)를 함께 탑재. 운영 중 재수집은 collector 잡으로 갱신.
COPY data ./data

EXPOSE 8080
# 헬스체크 (카카오클라우드 LB 연동)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
