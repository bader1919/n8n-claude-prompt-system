# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S n8nuser -u 1001

# Copy application code
COPY . .

# Remove development files and sensitive data
RUN rm -rf __tests__ .env.example .git

# Set ownership to non-root user
RUN chown -R n8nuser:nodejs /app
USER n8nuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health/live || exit 1

# Start application
CMD ["node", "api_server.js"]