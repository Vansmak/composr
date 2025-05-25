# Multi-stage build for size optimization
FROM python:3.9-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    gcc \
    musl-dev \
    linux-headers \
    curl

# Set working directory
WORKDIR /app

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# Production stage
FROM python:3.9-alpine

# Install runtime dependencies only
RUN apk add --no-cache \
    curl \
    ca-certificates

# Install Docker CLI - multi-architecture aware
RUN DOCKER_VERSION=24.0.7 \
    && TARGETARCH=$(uname -m) \
    && case ${TARGETARCH} in \
         x86_64) DOCKER_ARCH="x86_64" ;; \
         aarch64) DOCKER_ARCH="aarch64" ;; \
         armv7l) DOCKER_ARCH="armhf" ;; \
         armv6l) DOCKER_ARCH="armel" ;; \
         *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
       esac \
    && curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_VERSION}.tgz" | tar xz --strip-components=1 -C /usr/local/bin docker/docker \
    && chmod +x /usr/local/bin/docker

# Install Docker Compose - multi-architecture aware
RUN DOCKER_COMPOSE_VERSION=v2.23.1 \
    && TARGETARCH=$(uname -m) \
    && case ${TARGETARCH} in \
         x86_64) COMPOSE_ARCH="x86_64" ;; \
         aarch64) COMPOSE_ARCH="aarch64" ;; \
         armv7l) COMPOSE_ARCH="armv7" ;; \
         armv6l) COMPOSE_ARCH="armv6" ;; \
         *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
       esac \
    && curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${COMPOSE_ARCH}" -o /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

# Copy Python packages from builder stage  
COPY --from=builder /root/.local /root/.local

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Make sure the local bin is in PATH
ENV PATH=/root/.local/bin:$PATH

# Expose port
EXPOSE 5003

# Command to run the application
CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--workers", "4", "--threads", "2", "--timeout", "120", "app:app"]