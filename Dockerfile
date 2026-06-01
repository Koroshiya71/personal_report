FROM node:20-alpine

# Install git for self-updating capability
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package descriptors first to cache npm installs
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the files
COPY . .

# Build the Vite dashboard for production
RUN npm run build

# Expose the port for the dashboard HTTP server
EXPOSE 8080

# Run the entrypoint script
CMD ["node", "scraper/docker_entrypoint.js"]
