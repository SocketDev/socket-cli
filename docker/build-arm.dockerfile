# Dockerfile for cross-compiling Socket CLI for ARM architectures
# Supports both ARM64 and ARMv7 builds

ARG ARCH=arm64
ARG NODE_VERSION=20

# Use appropriate base image based on architecture
FROM --platform=linux/${ARCH} node:${NODE_VERSION}-bullseye-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm@latest

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY .npmrc* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Build the binary using yao-pkg
RUN pnpm exec pkg \
    .config/pkg.json \
    --targets node${NODE_VERSION}-linux-${ARCH} \
    --output dist/socket-linux-${ARCH}

# Final stage - minimal image with just the binary
FROM --platform=linux/${ARCH} debian:bullseye-slim

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /app/dist/socket-linux-* /usr/local/bin/socket

# Make it executable
RUN chmod +x /usr/local/bin/socket

# Verify it works
RUN socket --version

# Set entrypoint
ENTRYPOINT ["socket"]