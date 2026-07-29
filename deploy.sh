#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
FUNCTIONS_DIR="$REPO_DIR/functions/backend"
WEBAPP_DIR="$REPO_DIR/enable-device"

usage() {
  echo "Usage: $0 [functions|webapp|all] [default|staging]"
  echo ""
  echo "  functions  Build and deploy Cloud Functions"
  echo "  webapp     Build and deploy the web application (Firebase Hosting)"
  echo "  all        Build and deploy both (default)"
  echo ""
  echo "  default    Target the production Firebase project (default)"
  echo "  staging    Target the staging Firebase project (enableitalia-staging)"
  exit 1
}

TARGET="${1:-all}"
PROJECT_ALIAS="${2:-default}"

case "$TARGET" in
  functions|webapp|all) ;;
  *) usage ;;
esac

case "$PROJECT_ALIAS" in
  default|staging) ;;
  *) usage ;;
esac

echo "==> Target Firebase project alias: $PROJECT_ALIAS"

build_functions() {
  echo "==> [functions] Building..."
  cd "$FUNCTIONS_DIR"
  npm run build
  echo "==> [functions] Build successful."
  cd "$REPO_DIR"
}

deploy_functions() {
  echo "==> [functions] Deploying to Cloud Functions..."
  firebase deploy --only functions --project "$PROJECT_ALIAS"
  echo "==> [functions] Deploy completed."
}

build_webapp() {
  echo "==> [webapp] Building..."
  cd "$WEBAPP_DIR"
  if [ "$PROJECT_ALIAS" = "staging" ]; then
    npm run build -- --mode staging
  else
    npm run build
  fi
  echo "==> [webapp] Build successful."
  cd "$REPO_DIR"
}

deploy_webapp() {
  echo "==> [webapp] Deploying to Firebase Hosting..."
  firebase deploy --only hosting --project "$PROJECT_ALIAS"
  echo "==> [webapp] Deploy completed."
}

case "$TARGET" in
  functions)
    build_functions
    deploy_functions
    ;;
  webapp)
    build_webapp
    deploy_webapp
    ;;
  all)
    build_functions
    build_webapp
    firebase deploy --only functions,hosting --project "$PROJECT_ALIAS"
    echo "==> [all] Deploy completed."
    ;;
esac
