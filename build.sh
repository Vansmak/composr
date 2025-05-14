
#!/bin/bash
VERSION=${1:-latest}

# Clean up any existing builder
if docker buildx ls | grep -q "multiarch"; then
    docker buildx rm multiarch
fi

# Create a new one with host network
docker buildx create --name multiarch --driver docker-container --driver-opt network=host --use

echo "Building multi-arch image for version: $VERSION"

docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -t vansmak/composr:$VERSION \
  -t vansmak/composr:latest \
  --push \
  .

# Remove the builder
echo "Cleaning up builder..."
docker buildx rm multiarch
