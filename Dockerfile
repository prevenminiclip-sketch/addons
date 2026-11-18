FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7000

# Pre-compiled standalone JavaScript - zero npm build overhead
COPY dist ./dist

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7000/health || exit 1

CMD ["node", "dist/server.js"]
