FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install system dependencies including Docker CLI
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
    && apt-get install -y docker-ce-cli

# Architecture-specific Docker Compose installation
RUN DOCKER_COMPOSE_VERSION=v2.23.1 \
    && ARCHITECTURE=$(uname -m) \
    && case ${ARCHITECTURE} in \
         x86_64) COMPOSE_ARCH="x86_64" ;; \
         aarch64) COMPOSE_ARCH="aarch64" ;; \
         armv7l) COMPOSE_ARCH="armv7" ;; \
         *) echo "Unsupported architecture: ${ARCHITECTURE}" && exit 1 ;; \
       esac \
    && curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${COMPOSE_ARCH}" -o /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose \
    && ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Command to run the application with Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--workers", "4", "--threads", "2", "--timeout", "120", "app:app"]