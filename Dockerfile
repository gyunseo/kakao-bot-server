FROM node:22-alpine                 
WORKDIR /app

COPY .env ./
COPY index.js ./
COPY package*.json ./
RUN npm ci         

EXPOSE 3000

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["node", "index.js"]