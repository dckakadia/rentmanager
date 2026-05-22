#!/bin/bash

# RentManager - Setup Script for Ubuntu Server

set -e

echo "=========================================="
echo "RentManager - Installation Script"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "✓ Node.js $(node --version)"

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "Installing PostgreSQL..."
    sudo apt-get install -y postgresql postgresql-contrib
fi

echo "✓ PostgreSQL installed"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
fi

echo "✓ Docker installed"

# Create application directory
INSTALL_DIR="/opt/rentmanager"
if [ ! -d "$INSTALL_DIR" ]; then
    sudo mkdir -p "$INSTALL_DIR"
fi

# Clone repository (if not already cloned)
if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo "Cloning repository..."
    # Modify this URL to your actual repository
    # git clone <your-repo-url> $INSTALL_DIR
fi

cd "$INSTALL_DIR"

echo ""
echo "Installing backend dependencies..."
cd backend
npm install --production

echo "Copying .env.example to .env..."
cp .env.example .env
echo "⚠️  Please edit backend/.env with your configuration"

echo ""
echo "Installing frontend dependencies..."
cd ../frontend
npm install --production

echo "Building frontend..."
npm run build

echo ""
echo "=========================================="
echo "✓ Installation Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit backend/.env with your settings"
echo "2. Run: docker-compose up -d"
echo "3. Run: cd backend && node database/init.js"
echo "4. Start backend: npm run dev"
echo "5. Start frontend: cd frontend && npm run dev"
echo ""
