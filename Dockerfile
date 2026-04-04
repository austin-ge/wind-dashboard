FROM node:20-alpine

# Install nginx
RUN apk add --no-cache nginx

# Setup backend
WORKDIR /app
COPY backend/package.json ./
RUN npm install --production
COPY backend/server.js ./

# Setup frontend
COPY index.html /usr/share/nginx/html/index.html
# Alpine nginx uses http.d/ not conf.d/
RUN rm -f /etc/nginx/http.d/default.conf
COPY nginx.conf /etc/nginx/http.d/default.conf

# Create data dir for SQLite
RUN mkdir -p /data

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
