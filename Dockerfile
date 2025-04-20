# Stage 1: Build frontend
FROM node:18 AS buildfrontend
WORKDIR /app
COPY ./temp-personal-ai-notes-client-vite/package*.json ./
RUN npm install
COPY ./temp-personal-ai-notes-client-vite .
RUN npm run build

# Stage 2: Build api
FROM node:18 AS buildapi
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY ./src ./
COPY ./.env ./
COPY ./tsconfig.json ./
RUN npm run build

# Stage 3: Production
FROM node:18-alpine AS production
WORKDIR /app
COPY --from=buildapi /app/build ./build
COPY --from=buildapi /app/package*.json ./
COPY --from=buildapi /app/.env ./.env
COPY --from=buildfrontend /app/dist ./dist
RUN npm install --only=production
RUN ls -al
EXPOSE 2000
CMD ["npm", "start"]

# How to build and run the Docker container:
# 1. Build the Docker image: docker build -t ai-notes-docker .

# 2. Run the Docker container: docker run -p 2000:2000 ai-notes-docker
# 3. Access the application in your browser at http://localhost:2000