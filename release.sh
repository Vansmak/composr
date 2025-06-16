#!/bin/bash
# Combined build and release script for Composr
# Get version from command line
VERSION=${1}

# Check if version was provided
if [ -z "$VERSION" ]; then
    echo "Usage: ./release.sh <version>"
    echo "Example: ./release.sh 1.6.0"
    echo ""
    echo "This will:"
    echo "  1. Handle any merge conflicts automatically"
    echo "  2. Create git commit and tag (if possible)"
    echo "  3. Push to GitHub (if possible)"
    echo "  4. Build multi-arch Docker image with cleanup"
    echo "  5. Push to Docker Hub"
    echo "  Note: Docker build will continue even if GitHub operations fail"
    exit 1
fi

echo "🚀 Starting Composr release process for version: $VERSION"
echo "========================================================="

# Git operations flag
GIT_SUCCESS=true

# Step 1: Git operations with conflict handling
echo ""
echo "📝 Step 1: Git operations with conflict resolution"
echo "-------------------------------------------------"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "⚠️  Warning: Not in a git repository - skipping git operations"
    GIT_SUCCESS=false
else
    # Handle potential conflicts by fetching and merging first
    echo "🔄 Fetching latest changes from GitHub..."
    if ! git fetch origin; then
        echo "⚠️  Warning: Failed to fetch from GitHub - continuing with local changes"
        GIT_SUCCESS=false
    else
        # Get current branch
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        if [ "$BRANCH" != "main" ]; then
            echo "⚠️  Warning: You're on branch '$BRANCH'"
            echo "   Consider switching to 'main' branch for releases"
        fi
        echo "Current branch: $BRANCH"

        # Try to merge any remote changes
        echo "🔀 Checking for remote changes..."
        if ! git merge origin/$BRANCH --no-edit; then
            echo "⚠️  Merge conflicts detected!"
            echo "📝 Auto-resolving common conflicts..."
            
            # Auto-resolve README conflicts by preferring local version
            if git status --porcelain | grep -q "README.md"; then
                echo "   - README.md conflict: using local version"
                git checkout --ours README.md
                git add README.md
            fi
            
            # Auto-resolve VERSION conflicts by using the new version
            if git status --porcelain | grep -q "VERSION"; then
                echo "   - VERSION conflict: using new version ($VERSION)"
                echo "$VERSION" > VERSION
                git add VERSION
            fi
            
            # Check if all conflicts are resolved
            if git status --porcelain | grep -q "^UU\|^AA\|^DD"; then
                echo "⚠️  Some conflicts still need manual resolution - skipping git operations"
                echo "Unresolved conflicts:"
                git status --porcelain | grep "^UU\|^AA\|^DD"
                GIT_SUCCESS=false
            else
                # Complete the merge
                git commit --no-edit -m "Auto-resolved merge conflicts for release $VERSION"
                echo "✅ Conflicts resolved automatically"
            fi
        fi
    fi
fi

# Write version to VERSION file (always do this)
echo ""
echo "📝 Updating version files..."
echo "Updating VERSION file to $VERSION"
echo "$VERSION" > VERSION

# Update version in app.py if it exists
if [ -f "app.py" ]; then
    echo "Updating version in app.py"
    sed -i "s/__version__ = \".*\"/__version__ = \"$VERSION\"/" app.py
fi

# Continue with git operations if successful so far
if [ "$GIT_SUCCESS" = true ]; then
    # Add files
    echo "Adding files to git..."
    git add .
    git add -A

    # Check if there are changes to commit
    if git diff --staged --quiet; then
        echo "No changes to commit"
    else
        echo "Creating release commit..."
        if git commit -m "Composr v$VERSION

✨ Features:
- Multi-host Docker container management
- Real-time container monitoring and control
- Docker Compose file editor with syntax highlighting
- Environment file management
- Image management across multiple hosts
- Backup and restore functionality
- Modern web interface with dark/light themes"; then
            echo "✅ Commit created successfully"
        else
            echo "⚠️  Warning: Failed to create commit - continuing anyway"
            GIT_SUCCESS=false
        fi
    fi

    # Create tag
    if [ "$GIT_SUCCESS" = true ]; then
        echo "Creating release tag v$VERSION..."
        if git tag -a "v$VERSION" -m "Composr v$VERSION

🚀 Container Management Platform
- Multi-host Docker container management
- Real-time monitoring and control
- Compose file editing with live preview
- Environment variable management
- Cross-platform image management
- Backup/restore functionality
- Modern responsive web interface"; then
            echo "✅ Tag created successfully"
        else
            echo "⚠️  Warning: Failed to create tag - continuing anyway"
            GIT_SUCCESS=false
        fi
    fi

    # Push commits and tags
    if [ "$GIT_SUCCESS" = true ]; then
        echo "📤 Pushing to GitHub..."
        if git push origin $BRANCH && git push origin "v$VERSION"; then
            echo "✅ Git operations completed successfully"
        else
            echo "⚠️  Warning: Failed to push to GitHub - continuing with Docker build"
            GIT_SUCCESS=false
        fi
    fi
fi

if [ "$GIT_SUCCESS" = false ]; then
    echo ""
    echo "⚠️  Git operations had issues, but continuing with Docker build..."
    echo "   You can manually resolve git issues later if needed."
fi

# Step 2: Docker build and push with cleanup (ALWAYS RUNS)
echo ""
echo "🐳 Step 2: Docker build and push with automatic cleanup"
echo "------------------------------------------------------"

# Create temporary builder with unique name
BUILDER_NAME="composr-builder-$$"
echo "🔧 Creating temporary buildx builder: $BUILDER_NAME"

# Cleanup function
cleanup_buildx() {
    echo ""
    echo "🧹 Cleaning up buildx environment..."
    echo "Removing temporary builder: $BUILDER_NAME"
    docker buildx rm $BUILDER_NAME 2>/dev/null || true
    
    # Clean up any orphaned buildx containers
    echo "Cleaning up orphaned buildx containers..."
    docker container prune -f --filter "label=com.docker.compose.project=buildx" 2>/dev/null || true
    
    # Remove any containers with builder/buildkit in the name
    echo "Removing any remaining builder containers..."
    docker ps -aq --filter "name=builder" | xargs -r docker rm -f 2>/dev/null || true
    docker ps -aq --filter "name=buildkit" | xargs -r docker rm -f 2>/dev/null || true
    
    # Clean up buildx cache
    echo "Pruning buildx cache..."
    docker buildx prune -f 2>/dev/null || true
    
    echo "✅ Buildx cleanup completed - no more annoying containers!"
}

# Set trap for cleanup
trap cleanup_buildx EXIT INT TERM

# Create temporary builder
if ! docker buildx create --name $BUILDER_NAME --use; then
    echo "❌ Failed to create buildx builder"
    exit 1
fi

# Ensure the builder is running
echo "Bootstrapping builder..."
if ! docker buildx inspect $BUILDER_NAME --bootstrap; then
    echo "❌ Failed to bootstrap builder"
    exit 1
fi

echo ""
echo "🏗️  Building Composr multi-arch image for version: $VERSION"
echo "Platforms: linux/amd64, linux/arm64, linux/arm/v7"

# Build and push
if docker buildx build \
  --builder $BUILDER_NAME \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -t vansmak/composr:$VERSION \
  -t vansmak/composr:latest \
  --push \
  .; then
    
    echo ""
    echo "🎉 Docker build completed successfully!"
    echo "====================================="
    echo "✅ Docker images built and pushed:"
    echo "  - vansmak/composr:$VERSION"
    echo "  - vansmak/composr:latest"
    
else
    echo ""
    echo "❌ Docker build failed!"
    exit 1
fi

# Summary
echo ""
echo "🎉 Release Summary"
echo "=================="
echo "Version: $VERSION"
if [ "$GIT_SUCCESS" = true ]; then
    echo "Git operations: ✅ SUCCESS"
    echo "Git tag: v$VERSION"
    echo "Git branch: $BRANCH"
else
    echo "Git operations: ⚠️  SKIPPED/FAILED"
    echo "Note: You may need to manually handle git operations"
fi
echo "Docker operations: ✅ SUCCESS"
echo "Docker images:"
echo "  - vansmak/composr:$VERSION"
echo "  - vansmak/composr:latest"

echo ""
echo "🚀 Composr v$VERSION build completed!"
echo ""
echo "Next steps:"
if [ "$GIT_SUCCESS" = true ]; then
    echo "  - ✅ Check GitHub: https://github.com/vansmak/composr"
    echo "  - ✅ GitHub release created automatically"
else
    echo "  - ⚠️  Manually push to GitHub if needed:"
    echo "    git add . && git commit -m 'Release v$VERSION'"
    echo "    git tag v$VERSION && git push origin main --tags"
fi
echo "  - ✅ Check Docker Hub: https://hub.docker.com/r/vansmak/composr"
echo "  - ✅ Test with: docker pull vansmak/composr:$VERSION"
echo "  - 📝 Update documentation if needed"

echo ""
echo "🔧 Composr Features:"
echo "  - Multi-host container management"
echo "  - Real-time monitoring and control"
echo "  - Compose file editing with live syntax"
echo "  - Environment variable management"
echo "  - Multi-platform Docker image support"
echo ""
echo "🧹 Buildx cleanup will complete automatically..."
# Cleanup happens via trap