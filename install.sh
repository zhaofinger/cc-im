#!/bin/bash
# CC-IM Install Script
# One-line install and setup as a background service
# Usage: curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash

set -e

PROJECT_NAME="cc-im"
REPO_URL="https://github.com/zhaofinger/cc-im.git"
INSTALL_DIR="$HOME/.cc-im"

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

has_prompt_tty() {
    if [[ "${CC_IM_INSTALL_NONINTERACTIVE:-0}" == "1" ]]; then
        return 1
    fi

    [[ -r /dev/tty ]]
}

read_user_input() {
    local __var_name="$1"
    local __input=""

    if has_prompt_tty; then
        if IFS= read -r __input < /dev/tty; then
            printf -v "$__var_name" '%s' "$__input"
            return 0
        fi
    fi

    if [[ -t 0 ]]; then
        if IFS= read -r __input; then
            printf -v "$__var_name" '%s' "$__input"
            return 0
        fi
    fi

    return 1
}

require_interactive_input() {
    local __var_name="$1"
    local __label="$2"

    if read_user_input "$__var_name"; then
        return 0
    fi

    log_error "Unable to read ${__label} interactively."
    log_info "Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID before running install.sh in non-interactive mode."
    exit 1
}

read_optional_input() {
    local __var_name="$1"
    local __default_value="$2"

    if read_user_input "$__var_name"; then
        return 0
    fi

    printf -v "$__var_name" '%s' "$__default_value"
}

wait_for_confirmation() {
    local _confirmation=""

    log_prompt "Press Enter to continue or Ctrl+C to cancel..."
    if ! read_user_input _confirmation; then
        log_warn "Interactive confirmation unavailable. Continuing immediately."
    fi
}

print_banner() {
    echo ""
    echo "╔══════════════════════════════════════════╗"
    echo "║                                          ║"
    echo "║    🤖 CC-IM - Claude Code Telegram Bot   ║"
    echo "║                                          ║"
    echo "╚══════════════════════════════════════════╝"
    echo ""
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    else
        echo "unknown"
    fi
}

# Check and install git
check_git() {
    if command_exists git; then
        return 0
    fi

    log_warn "git is not installed"
    log_info "Installing git..."

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command_exists apt-get; then
            sudo apt-get update && sudo apt-get install -y git
        elif command_exists yum; then
            sudo yum install -y git
        elif command_exists pacman; then
            sudo pacman -S --noconfirm git
        else
            log_error "Cannot install git automatically. Please install git manually."
            exit 1
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        log_error "Please install git first: xcode-select --install"
        exit 1
    else
        log_error "Unsupported OS. Please install git manually."
        exit 1
    fi
}

# Check and install bun
check_and_install_bun() {
    if command_exists bun; then
        log_success "Found bun at: $(which bun)"
        return 0
    fi

    log_warn "bun is not installed"
    log_info "Installing bun..."

    if curl -fsSL https://bun.sh/install | bash; then
        log_success "bun installed successfully"

        # Add to PATH for current session
        if [[ -f "$HOME/.bashrc" ]]; then
            source "$HOME/.bashrc" 2>/dev/null || true
        fi
        if [[ -f "$HOME/.zshrc" ]]; then
            source "$HOME/.zshrc" 2>/dev/null || true
        fi

        if [[ -f "$HOME/.bun/bin/bun" ]]; then
            export PATH="$HOME/.bun/bin:$PATH"
        fi

        if command_exists bun || [[ -f "$HOME/.bun/bin/bun" ]]; then
            return 0
        else
            log_error "Please restart your terminal and try again"
            exit 1
        fi
    else
        log_error "Failed to install bun. Visit: https://bun.sh"
        exit 1
    fi
}

# Clone or update repository
setup_repo() {
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull --ff-only
    else
        log_info "Cloning repository..."
        rm -rf "$INSTALL_DIR"
        git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    fi
    log_success "Repository ready at: $INSTALL_DIR"
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

    # Required: Telegram Bot Token
    local TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
    while [[ -z "$TELEGRAM_BOT_TOKEN" ]]; do
        log_prompt "Enter your Telegram Bot Token (required):"
        echo "  💡 Get it from @BotFather: https://t.me/botfather"
        require_interactive_input TELEGRAM_BOT_TOKEN "Telegram Bot Token"
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
        require_interactive_input TELEGRAM_ALLOWED_CHAT_ID "Telegram Chat ID"
        if [[ -z "$TELEGRAM_ALLOWED_CHAT_ID" ]]; then
            log_error "Telegram Chat ID is required"
        fi
    done

    # Optional: Workspace Root
    echo ""
    log_prompt "Enter workspace root directory (default: /code_workspace):"
    echo "  💡 This directory should contain your code projects"
    local WORKSPACE_ROOT="${WORKSPACE_ROOT:-}"
    read_optional_input WORKSPACE_ROOT "${WORKSPACE_ROOT:-/code_workspace}"
    WORKSPACE_ROOT=${WORKSPACE_ROOT:-/code_workspace}

    # Create workspace if not exists
    if [[ ! -d "$WORKSPACE_ROOT" ]]; then
        log_info "Creating workspace directory: $WORKSPACE_ROOT"
        mkdir -p "$WORKSPACE_ROOT"
    fi

    # Optional: Log Directory
    echo ""
    log_prompt "Enter log directory (default: $INSTALL_DIR/logs):"
    local LOG_DIR="${LOG_DIR:-}"
    read_optional_input LOG_DIR "${LOG_DIR:-$INSTALL_DIR/logs}"
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

# Install dependencies
install_deps() {
    log_info "Installing dependencies..."
    cd "$INSTALL_DIR"
    bun install
    log_success "Dependencies installed"
}

# Install as background service
install_service() {
    local OS=$(detect_os)

    if [[ "$OS" == "unknown" ]]; then
        log_warn "Unknown OS. Skipping service installation."
        log_info "You can run the bot manually with: cd $INSTALL_DIR && bun run start"
        return 1
    fi

    log_info "Installing as background service..."
    cd "$INSTALL_DIR"

    if bash deploy/install-service.sh --user; then
        log_success "Service installed successfully!"
        return 0
    else
        log_error "Failed to install service"
        return 1
    fi
}

# Create launcher command
create_launcher() {
    local LAUNCHER="$HOME/.local/bin/cc-im"
    local OS=$(detect_os)

    mkdir -p "$HOME/.local/bin"

    # Create launcher script based on OS
    if [[ "$OS" == "linux" ]]; then
        cat > "$LAUNCHER" << EOF
#!/bin/bash
# CC-IM Service Launcher

if [[ -f "\$HOME/.config/systemd/user/cc-im.service" ]]; then
    echo "Usage:"
    echo "  cc-im start    - Start the service"
    echo "  cc-im stop     - Stop the service"
    echo "  cc-im restart  - Restart the service"
    echo "  cc-im status   - Check service status"
    echo "  cc-im logs     - View logs"
    echo ""
    case "\$1" in
        start)
            systemctl --user start cc-im
            echo "Service started"
            ;;
        stop)
            systemctl --user stop cc-im
            echo "Service stopped"
            ;;
        restart)
            systemctl --user restart cc-im
            echo "Service restarted"
            ;;
        status)
            systemctl --user status cc-im --no-pager
            ;;
        logs)
            tail -f "$INSTALL_DIR/logs/app.log"
            ;;
        *)
            systemctl --user status cc-im --no-pager
            ;;
    esac
else
    echo "Service not installed. Run install.sh to set up."
    exit 1
fi
EOF
    elif [[ "$OS" == "macos" ]]; then
        cat > "$LAUNCHER" << EOF
#!/bin/bash
# CC-IM Service Launcher

if [[ -f "\$HOME/Library/LaunchAgents/com.cc-im.app.plist" ]]; then
    echo "Usage:"
    echo "  cc-im start    - Start the service"
    echo "  cc-im stop     - Stop the service"
    echo "  cc-im restart  - Restart the service"
    echo "  cc-im status   - Check service status"
    echo "  cc-im logs     - View logs"
    echo ""
    case "\$1" in
        start)
            launchctl start com.cc-im.app
            echo "Service started"
            ;;
        stop)
            launchctl stop com.cc-im.app
            echo "Service stopped"
            ;;
        restart)
            launchctl stop com.cc-im.app 2>/dev/null || true
            sleep 1
            launchctl start com.cc-im.app
            echo "Service restarted"
            ;;
        status)
            launchctl print "gui/\$(id - u)/com.cc-im.app" 2>/dev/null || echo "Service not running"
            ;;
        logs)
            tail -f "$INSTALL_DIR/logs/app.log"
            ;;
        *)
            launchctl print "gui/\$(id - u)/com.cc-im.app" 2>/dev/null || echo "Service not running"
            ;;
    esac
else
    echo "Service not installed. Run install.sh to set up."
    exit 1
fi
EOF
    fi

    chmod +x "$LAUNCHER"

    # Add to PATH if not already there
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        echo ""
        log_info "Adding ~/.local/bin to PATH..."

        if [[ -f "$HOME/.bashrc" ]]; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
        fi
        if [[ -f "$HOME/.zshrc" ]]; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
        fi

        export PATH="$HOME/.local/bin:$PATH"
    fi

    log_success "Launcher created: cc-im"
}

# Main
main() {
    print_banner

    log_info "This script will:"
    echo "  1. Install git (if needed)"
    echo "  2. Install bun (if needed)"
    echo "  3. Clone cc-im repository"
    echo "  4. Configure your bot"
    echo "  5. Install dependencies"
    echo "  6. Install as a background service"
    echo ""

    wait_for_confirmation

    echo ""
    check_git
    echo ""
    check_and_install_bun
    echo ""
    setup_repo
    echo ""
    setup_env
    echo ""
    install_deps
    echo ""

    if install_service; then
        create_launcher

        echo ""
        echo "╔══════════════════════════════════════════╗"
        echo "║         🎉 Setup Complete! 🎉            ║"
        echo "╚══════════════════════════════════════════╝"
        echo ""
        log_success "CC-IM is installed as a background service!"
        echo ""
        log_info "Quick Commands:"
        echo "  cc-im start    - Start the service"
        echo "  cc-im stop     - Stop the service"
        echo "  cc-im restart  - Restart the service"
        echo "  cc-im status   - Check service status"
        echo "  cc-im logs     - View logs"
        echo ""
        log_info "Service Status:"
        cc-im status 2>/dev/null || true
        echo ""
        log_info "To start the service now, run: cc-im start"
    else
        log_warn "Service installation failed. You can still run the bot manually:"
        echo "  cd $INSTALL_DIR && bun run start"
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
