#!/bin/bash

# Get version from command line or read from VERSION file
if [ "$1" ]; then
    VERSION=$1
elif [ -f "VERSION" ]; then
    VERSION=$(cat VERSION)
else
    echo "Usage: ./git-release.sh [version]"
    echo "Example: ./git-release.sh 1.4.0"
    echo "Or run without args to use VERSION file"
    exit 1
fi

echo "Creating git release for version: $VERSION"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Error: Not in a git repository"
    exit 1
fi

# Add files
echo "Adding files to git..."
git add .

# Commit
echo "Creating commit..."
git commit -m "Release version $VERSION"

# Create tag
echo "Creating tag v$VERSION..."
git tag -a "v$VERSION" -m "Version $VERSION"

# Push commits
echo "Pushing to origin..."
git push origin main

# Push tags
echo "Pushing tags..."
git push origin "v$VERSION"

echo "Git release completed for version $VERSION"
