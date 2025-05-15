FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install system dependencies including Docker CLI and Docker Compose
RUN apt-get update && apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli \
    # Detect architecture and download appropriate Docker Compose binary
    && ARCH=$(dpkg --print-architecture) \
    && case ${ARCH} in \
         amd64) DOCKER_COMPOSE_ARCH="x86_64" ;; \
         arm64) DOCKER_COMPOSE_ARCH="aarch64" ;; \
         armhf) DOCKER_COMPOSE_ARCH="armv7" ;; \
         *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
       esac \
    && curl -L "https://github.com/docker/compose/releases/download/v2.23.1/docker-compose-linux-${DOCKER_COMPOSE_ARCH}" -o /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose \
    && ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Create required directories
RUN mkdir -p /app/projects /app/metadata

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV COMPOSE_DIR=/app/projects
ENV METADATA_DIR=/app/metadata
ENV FLASK_APP=composr_agent.py

# Expose API port
EXPOSE 5005

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5005/health || exit 1

# Command to run the application
CMD ["gunicorn", "--bind", "0.0.0.0:5005", "--workers", "4", "--threads", "2", "--timeout", "120", "app:app"]