FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs parse-page.mjs parse-competition.mjs parse-pool.mjs read-pool.mjs ./
USER pwuser
ENV HOST=0.0.0.0 PORT=8788
EXPOSE 8788
CMD ["node", "server.mjs"]
