FROM node:20-alpine AS backend
WORKDIR /app
COPY backend/package.json ./
RUN npm install --production
COPY backend/server.js ./

FROM nginx:alpine
# Install Node.js runtime
RUN apk add --no-cache nodejs

# Copy backend
COPY --from=backend /app /app

# Copy frontend
COPY index.html /usr/share/nginx/html/index.html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create data dir for SQLite
RUN mkdir -p /data

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
