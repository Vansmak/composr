#!/bin/bash

# Get version from command line, default to 'latest'
VERSION=${1:-latest}

# Check if version was provided
if [ "$VERSION" = "latest" ]; then
    echo "Usage: ./build.sh <version>"
    echo "Example: ./build.sh 1.4.0"
    exit 1
fi

# Write version to VERSION file
echo "Updating VERSION file to $VERSION"
echo "$VERSION" > VERSION

# Update version in app.py if it exists
if [ -f "app.py" ]; then
    echo "Updating version in app.py"
    sed -i "s/__version__ = \".*\"/__version__ = \"$VERSION\"/" app.py
fi

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

echo "Successfully built and pushed version $VERSION"
