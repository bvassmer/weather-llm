FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ARG VITE_WEATHER_LLM_API_BASE_URL=http://localhost:3000
ARG VITE_SSE_IDLE_TIMEOUT_MS=150000
ENV VITE_WEATHER_LLM_API_BASE_URL=$VITE_WEATHER_LLM_API_BASE_URL
ENV VITE_SSE_IDLE_TIMEOUT_MS=$VITE_SSE_IDLE_TIMEOUT_MS
RUN npm run build

FROM nginx:1.29-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80