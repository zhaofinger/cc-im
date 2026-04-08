#!/bin/bash
# CC-IM Install Script
# Download and install pre-built binary from GitHub Releases
# Usage: curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash

set -e

PROJECT_NAME="cc-im"
REPO_URL="https://github.com/zhaofinger/cc-im"
INSTALL_DIR="$HOME/.cc-im"
BIN_DIR="$HOME/.local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_prompt() { echo -e "${CYAN}[INPUT]${NC} $1"; }

is_noninteractive() {
    [[ "${CC_IM_INSTALL_NONINTERACTIVE:-}" == "1" || ! -t 0 ]]
}

# Detect OS and architecture
detect_platform() {
    local OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    local ARCH=$(uname -m)

    case "$ARCH" in
        x86_64|amd64)
            ARCH="x64"
            ;;
        arm64|aarch64)
            ARCH="arm64"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    case "$OS" in
        linux)
            PLATFORM="linux-${ARCH}"
            ;;
        darwin)
            PLATFORM="darwin-${ARCH}"
            ;;
        *)
            log_error "Unsupported OS: $OS"
            exit 1
            ;;
    esac

    echo "$PLATFORM"
}

# Get latest release version
get_latest_version() {
    local version_url="${REPO_URL}/releases/latest"
    local version

    # Try to get version from GitHub API
    if command -v curl &> /dev/null; then
        version=$(curl -sI "$version_url" | grep -i "location:" | sed 's/.*\/tag\///' | tr -d '\r')
    fi

    # Fallback: use API endpoint
    if [[ -z "$version" ]]; then
        version=$(curl -s "${REPO_URL/github.com/api.github.com/repos\/zhaofinger\/cc-im}/releases/latest" | grep -o '"tag_name": "[^"]*"' | sed 's/.*"\([^"]*\)".*/\1/')
    fi

    echo "$version"
}

# Download binary from GitHub Releases
download_binary() {
    local version="${1:-latest}"
    local platform="$2"
    local download_url

    if [[ "$version" == "latest" ]]; then
        version=$(get_latest_version)
        if [[ -z "$version" ]]; then
            log_error "Failed to get latest version"
            exit 1
        fi
    fi

    log_info "Downloading ${PROJECT_NAME} ${version} for ${platform}..."

    local archive_name="${PROJECT_NAME}-${platform}.tar.gz"
    download_url="${REPO_URL}/releases/download/${version}/${archive_name}"

    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    # Download with retry
    local max_retries=3
    local retry=0

    while [[ $retry -lt $max_retries ]]; do
        if curl -fsSL -o "$archive_name" "$download_url" 2>/dev/null; then
            log_success "Downloaded ${archive_name}"
            break
        fi

        retry=$((retry + 1))
        if [[ $retry -lt $max_retries ]]; then
            log_warn "Download failed, retrying... (${retry}/${max_retries})"
            sleep 2
        else
            log_error "Failed to download binary after ${max_retries} attempts"
            log_info "You can manually download from:"
            log_info "  ${REPO_URL}/releases"
            exit 1
        fi
    done

    # Extract
    log_info "Extracting..."
    tar -xzf "$archive_name"
    rm -f "$archive_name"

    # Move binary to standard location
    mv "${PROJECT_NAME}-${platform}" "$PROJECT_NAME"
    chmod +x "$PROJECT_NAME"

    log_success "Binary installed to: ${INSTALL_DIR}/${PROJECT_NAME}"
}

# Create .env interactively
setup_env() {
    local ENV_FILE="$INSTALL_DIR/.env"

    if [[ -f "$ENV_FILE" ]]; then
        log_info "Found existing .env file"
        return 0
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Let's configure your bot"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if is_noninteractive; then
        local TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
        local TELEGRAM_ALLOWED_CHAT_ID="${TELEGRAM_ALLOWED_CHAT_ID:-}"
        local WORKSPACE_ROOT_VALUE="${WORKSPACE_ROOT:-/code_workspace}"
        local LOG_DIR_VALUE="${LOG_DIR:-$INSTALL_DIR/logs}"

        if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_ALLOWED_CHAT_ID" ]]; then
            log_error "TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID are required in non-interactive mode"
            exit 1
        fi

        if [[ ! -d "$WORKSPACE_ROOT_VALUE" ]]; then
            log_info "Creating workspace directory: $WORKSPACE_ROOT_VALUE"
            mkdir -p "$WORKSPACE_ROOT_VALUE"
        fi

        cat > "$ENV_FILE" << EOF
# Telegram Bot Configuration (Required)
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN

# Security (Recommended)
TELEGRAM_ALLOWED_CHAT_ID=$TELEGRAM_ALLOWED_CHAT_ID

# Paths
WORKSPACE_ROOT=$WORKSPACE_ROOT_VALUE
LOG_DIR=$LOG_DIR_VALUE

# Claude Commands Page Size
CLAUDE_COMMANDS_PAGE_SIZE=8

# Agent Provider (claude or codex)
AGENT_PROVIDER=claude
EOF

        log_success ".env file created!"
        return 0
    fi

    # Required: Telegram Bot Token
    local TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
    while [[ -z "$TELEGRAM_BOT_TOKEN" ]]; do
        log_prompt "Enter your Telegram Bot Token (required):"
        echo "  💡 Get it from @BotFather: https://t.me/botfather"
        read -r TELEGRAM_BOT_TOKEN
        if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
            log_error "Telegram Bot Token is required"
        fi
    done

    # Required: Allowed Chat ID
    echo ""
    local TELEGRAM_ALLOWED_CHAT_ID="${TELEGRAM_ALLOWED_CHAT_ID:-}"
    while [[ -z "$TELEGRAM_ALLOWED_CHAT_ID" ]]; do
        log_prompt "Enter your Telegram Chat ID (required):"
        echo "  💡 Use @userinfobot to get your chat ID"
        read -r TELEGRAM_ALLOWED_CHAT_ID
        if [[ -z "$TELEGRAM_ALLOWED_CHAT_ID" ]]; then
            log_error "Telegram Chat ID is required"
        fi
    done

    # Optional: Workspace Root
    echo ""
    log_prompt "Enter workspace root directory (default: /code_workspace):"
    echo "  💡 This directory should contain your code projects"
    read -r WORKSPACE_ROOT
    WORKSPACE_ROOT=${WORKSPACE_ROOT:-/code_workspace}

    # Create workspace if not exists
    if [[ ! -d "$WORKSPACE_ROOT" ]]; then
        log_info "Creating workspace directory: $WORKSPACE_ROOT"
        mkdir -p "$WORKSPACE_ROOT"
    fi

    # Optional: Log Directory
    echo ""
    log_prompt "Enter log directory (default: $INSTALL_DIR/logs):"
    read -r LOG_DIR
    LOG_DIR=${LOG_DIR:-$INSTALL_DIR/logs}

    # Create .env file
    cat > "$ENV_FILE" << EOF
# Telegram Bot Configuration (Required)
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN

# Security (Recommended)
TELEGRAM_ALLOWED_CHAT_ID=$TELEGRAM_ALLOWED_CHAT_ID

# Paths
WORKSPACE_ROOT=$WORKSPACE_ROOT
LOG_DIR=$LOG_DIR

# Claude Commands Page Size
CLAUDE_COMMANDS_PAGE_SIZE=8

# Agent Provider (claude or codex)
AGENT_PROVIDER=claude
EOF

    log_success ".env file created!"
}

# Install as background service
install_service() {
    local OS=$(uname -s | tr '[:upper:]' '[:lower:]')

    if [[ "$OS" != "linux" && "$OS" != "darwin" ]]; then
        log_warn "Unknown OS. Skipping service installation."
        log_info "You can run the bot manually with: ${INSTALL_DIR}/${PROJECT_NAME}"
        return 1
    fi

    log_info "Installing as background service..."
    create_minimal_service "$OS"
}

# Create minimal service configuration
create_minimal_service() {
    local OS="$1"

    if [[ "$OS" == "linux" ]]; then
        mkdir -p "$HOME/.config/systemd/user"
        cat > "$HOME/.config/systemd/user/${PROJECT_NAME}.service" << EOF
[Unit]
Description=CC-IM Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${INSTALL_DIR}/${PROJECT_NAME}
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
EOF
        log_success "Service file created"
        log_info "To start: systemctl --user start ${PROJECT_NAME}"
    elif [[ "$OS" == "darwin" ]]; then
        mkdir -p "$HOME/Library/LaunchAgents"
        cat > "$HOME/Library/LaunchAgents/com.cc-im.app.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cc-im.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/${PROJECT_NAME}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/logs/app.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/logs/error.log</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF
        log_success "LaunchAgent created"
        log_info "To start: launchctl start com.cc-im.app"
    fi
}

# Create launcher command
create_launcher() {
    local LAUNCHER="$BIN_DIR/cc-im"

    mkdir -p "$BIN_DIR"

    cat > "$LAUNCHER" << EOF
#!/bin/bash
# CC-IM Service Launcher

INSTALL_DIR="${INSTALL_DIR}"

if [[ -f "\$INSTALL_DIR/.env" ]]; then
    source "\$INSTALL_DIR/.env"
fi

case "\$1" in
    start)
        if [[ -f "\$HOME/.config/systemd/user/${PROJECT_NAME}.service" ]]; then
            systemctl --user start ${PROJECT_NAME}
            echo "Service started"
        elif [[ -f "\$HOME/Library/LaunchAgents/com.cc-im.app.plist" ]]; then
            launchctl start com.cc-im.app
            echo "Service started"
        else
            echo "Service not installed. Run install.sh to set up."
            exit 1
        fi
        ;;
    stop)
        if [[ -f "\$HOME/.config/systemd/user/${PROJECT_NAME}.service" ]]; then
            systemctl --user stop ${PROJECT_NAME}
            echo "Service stopped"
        elif [[ -f "\$HOME/Library/LaunchAgents/com.cc-im.app.plist" ]]; then
            launchctl stop com.cc-im.app
            echo "Service stopped"
        else
            echo "Service not installed."
            exit 1
        fi
        ;;
    restart)
        if [[ -f "\$HOME/.config/systemd/user/${PROJECT_NAME}.service" ]]; then
            systemctl --user restart ${PROJECT_NAME}
            echo "Service restarted"
        elif [[ -f "\$HOME/Library/LaunchAgents/com.cc-im.app.plist" ]]; then
            launchctl stop com.cc-im.app 2>/dev/null || true
            sleep 1
            launchctl start com.cc-im.app
            echo "Service restarted"
        else
            echo "Service not installed."
            exit 1
        fi
        ;;
    status)
        if [[ -f "\$HOME/.config/systemd/user/${PROJECT_NAME}.service" ]]; then
            systemctl --user status ${PROJECT_NAME} --no-pager
        elif [[ -f "\$HOME/Library/LaunchAgents/com.cc-im.app.plist" ]]; then
            launchctl print "gui/\$(id - u)/com.cc-im.app" 2>/dev/null || echo "Service not running"
        else
            echo "Service not installed."
            exit 1
        fi
        ;;
    logs)
        if [[ -f "\$INSTALL_DIR/logs/app.log" ]]; then
            tail -f "\$INSTALL_DIR/logs/app.log"
        else
            echo "No log file found at \$INSTALL_DIR/logs/app.log"
            exit 1
        fi
        ;;
    update)
        echo "Updating ${PROJECT_NAME}..."
        curl -fsSL "${REPO_URL}/raw/main/install.sh" | bash
        ;;
    *)
        echo "Usage: cc-im [start|stop|restart|status|logs|update]"
        echo ""
        echo "Commands:"
        echo "  start    - Start the service"
        echo "  stop     - Stop the service"
        echo "  restart  - Restart the service"
        echo "  status   - Check service status"
        echo "  logs     - View logs"
        echo "  update   - Update to latest version"
        echo ""
        # Show current status
        if [[ -f "\$HOME/.config/systemd/user/${PROJECT_NAME}.service" ]]; then
            systemctl --user status ${PROJECT_NAME} --no-pager 2>/dev/null || echo "Service not running"
        elif [[ -f "\$HOME/Library/LaunchAgents/com.cc-im.app.plist" ]]; then
            launchctl print "gui/\$(id - u)/com.cc-im.app" 2>/dev/null || echo "Service not running"
        fi
        ;;
esac
EOF

    chmod +x "$LAUNCHER"

    # Add to PATH if not already there
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        echo ""
        log_info "Adding ${BIN_DIR} to PATH..."

        if [[ -f "$HOME/.bashrc" ]]; then
            echo 'export PATH="'$BIN_DIR':$PATH"' >> "$HOME/.bashrc"
        fi
        if [[ -f "$HOME/.zshrc" ]]; then
            echo 'export PATH="'$BIN_DIR':$PATH"' >> "$HOME/.zshrc"
        fi

        export PATH="$BIN_DIR:$PATH"
    fi

    log_success "Launcher created: cc-im"
}

# Print banner
print_banner() {
    echo ""
    echo "╔══════════════════════════════════════════╗"
    echo "║                                          ║"
    echo "║    🤖 CC-IM - Claude Code Telegram Bot   ║"
    echo "║                                          ║"
    echo "╚══════════════════════════════════════════╝"
    echo ""
}

# Wait for user confirmation
wait_for_confirmation() {
    log_prompt "Press Enter to continue or Ctrl+C to cancel..."
    if is_noninteractive; then
        log_info "Continuing immediately because interactive input is unavailable."
        return 0
    fi

    read -r || true
}

# Main
main() {
    print_banner

    # Check for required tools
    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed"
        exit 1
    fi

    log_info "This script will:"
    echo "  1. Download pre-built binary for your platform"
    echo "  2. Configure your bot"
    echo "  3. Install as a background service"
    echo ""

    wait_for_confirmation

    # Detect platform
    PLATFORM=$(detect_platform)
    log_info "Detected platform: ${PLATFORM}"
    echo ""

    # Download binary
    download_binary "latest" "$PLATFORM"
    echo ""

    # Setup environment
    setup_env
    echo ""

    # Create logs directory
    mkdir -p "$INSTALL_DIR/logs"

    # Install service
    install_service
    echo ""

    # Create launcher
    create_launcher

    echo ""
    echo "╔══════════════════════════════════════════╗"
    echo "║         🎉 Setup Complete! 🎉            ║"
    echo "╚══════════════════════════════════════════╝"
    echo ""
    log_success "CC-IM is installed!"
    echo ""
    log_info "Quick Commands:"
    echo "  cc-im start    - Start the service"
    echo "  cc-im stop     - Stop the service"
    echo "  cc-im restart  - Restart the service"
    echo "  cc-im status   - Check service status"
    echo "  cc-im logs     - View logs"
    echo "  cc-im update   - Update to latest version"
    echo ""
    log_info "To start the service now, run: cc-im start"
}

if [[ ${#BASH_SOURCE[@]} -eq 0 || "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
