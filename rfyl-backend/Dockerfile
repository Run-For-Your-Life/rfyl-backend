FROM node:20-slim

WORKDIR /app

# Install dependencies (including dev for build), skip husky
COPY package*.json ./
ENV HUSKY=0
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Prune dev dependencies for a smaller runtime image
RUN npm prune --production

# Set runtime env
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Start compiled server
CMD ["node", "dist/index.js"]
