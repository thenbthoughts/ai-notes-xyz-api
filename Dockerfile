# Stage 1: Clone
FROM alpine:latest as gitclone
RUN apk add --no-cache git
WORKDIR /app
RUN git clone https://github.com/thenbthoughts/ai-notes-xyz-client.git
RUN git clone https://github.com/thenbthoughts/ai-notes-xyz-api.git

# Stage 2: Build frontend
FROM node:22-trixie-slim AS buildfrontend
WORKDIR /app
COPY --from=gitclone /app/ai-notes-xyz-client/package*.json ./
RUN npm install
COPY --from=gitclone /app/ai-notes-xyz-client ./
RUN npm run build

# Stage 3: Build api (dev deps → build → prune)
FROM node:22-trixie-slim AS buildapi
WORKDIR /app
ENV NODE_ENV=development
COPY --from=gitclone /app/ai-notes-xyz-api/package*.json ./
RUN npm install
COPY --from=gitclone /app/ai-notes-xyz-api/src ./src
COPY --from=gitclone /app/ai-notes-xyz-api/tsconfig.json ./tsconfig.json
RUN npm run build
ENV NODE_ENV=production
RUN npm prune --omit=dev

# Stage 4: Production
FROM node:22-trixie-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=buildapi /app/build ./build
COPY --from=buildapi /app/package*.json ./
COPY --from=buildapi /app/node_modules ./node_modules
COPY --from=buildfrontend /app/dist ./dist
RUN node -e "require('fs').writeFileSync('./dist/DEPLOY_DATE.txt', new Date().toISOString())"
EXPOSE 2000
CMD ["npm", "start"]

# How to build and run the Docker container:
# 1. Build the Docker image: docker build -t ai-notes-docker .
# 2. Run the Docker container: docker run -p 2000:2000 ai-notes-docker
# 3. Access the application in your browser at http://localhost:2000