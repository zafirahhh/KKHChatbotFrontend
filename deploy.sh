#!/bin/bash
# Deployment script for KKH Nursing Chatbot

echo "🚀 Deploying KKH Nursing Chatbot to Fly.io..."

# Build and deploy
echo "📦 Building and deploying..."
fly deploy

# Check deployment status
echo "🔍 Checking deployment status..."
fly status

echo "✅ Deployment script completed!"
echo "🌐 Your app should be available at: https://kkh-chatbot-api.fly.dev"
echo "🏥 Health check: https://kkh-chatbot-api.fly.dev/health"
echo "📖 API docs: https://kkh-chatbot-api.fly.dev/docs"

# Show logs for debugging
echo "📋 Recent logs:"
fly logs --app kkh-chatbot-api
