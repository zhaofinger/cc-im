#!/bin/bash
# CC-IM Service Installer
# Supports: Linux (systemd) and macOS (launchd)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="cc-im"
LOG_DIR="$PROJECT_DIR/logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
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

# Check if bun is installed
check_bun() {
    if command -v bun &> /dev/null; then
        BUN_PATH=$(which bun)
        if "$BUN_PATH" --version >/dev/null 2>&1; then
            log_info "Found bun at: $BUN_PATH"
            return 0
        fi

        log_error "Found bun at $BUN_PATH, but the binary cannot execute on this machine."
        log_info "If this host is an older x64 CPU, reinstall via install.sh so it can fall back to Bun baseline."
        return 1
    else
        log_error "bun is not installed. Please install bun first:"
        echo "  curl -fsSL https://bun.sh/install | bash"
        return 1
    fi
}

# Check .env file
check_env() {
    if [[ ! -f "$PROJECT_DIR/.env" ]]; then
        log_warn ".env file not found"
        log_info "Creating .env from example..."
        if [[ -f "$PROJECT_DIR/.env.example" ]]; then
            cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
            log_warn "Please edit $PROJECT_DIR/.env with your configuration before starting the service"
        else
            log_error ".env.example not found. Please create .env manually"
            return 1
        fi
    else
        log_info "Found .env file"
    fi
}

# Create logs directory
setup_logs() {
    mkdir -p "$LOG_DIR"
    log_info "Logs directory: $LOG_DIR"
}

# Install for Linux (systemd)
install_linux() {
    log_info "Installing for Linux (systemd)..."

    # Check if systemd is available
    if ! command -v systemctl &> /dev/null; then
        log_error "systemctl not found. This system doesn't appear to use systemd."
        return 1
    fi

    # Determine service file location
    if [[ $EUID -eq 0 ]]; then
        SERVICE_DIR="/etc/systemd/system"
        USE_USER=false
    else
        SERVICE_DIR="$HOME/.config/systemd/user"
        USE_USER=true
        log_info "Installing as user service (run with --system for system-wide)"
    fi

    # Create service directory if needed
    mkdir -p "$SERVICE_DIR"

    # Get current user info
    USER_NAME=$(whoami)
    GROUP_NAME=$(id -gn)
    HOME_DIR="$HOME"

    # Copy and customize service file
    SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
    log_info "Creating service file: $SERVICE_FILE"

    # Set target based on user vs system install
    if [[ "$USE_USER" == true ]]; then
        TARGET="default.target"
    else
        TARGET="multi-user.target"
    fi

    sed -e "s|%USER%|$USER_NAME|g" \
        -e "s|%GROUP%|$GROUP_NAME|g" \
        -e "s|%WORKDIR%|$PROJECT_DIR|g" \
        -e "s|%HOME%|$HOME_DIR|g" \
        -e "s|%BUN_PATH%|$BUN_PATH|g" \
        -e "s|%LOGDIR%|$LOG_DIR|g" \
        -e "s|%TARGET%|$TARGET|g" \
        "$SCRIPT_DIR/cc-im.service" > "$SERVICE_FILE"

    # Reload systemd
    if [[ "$USE_USER" == true ]]; then
        systemctl --user daemon-reload
        log_info "To start the service, run:"
        echo "  systemctl --user start $SERVICE_NAME"
        echo "  systemctl --user enable $SERVICE_NAME  # Enable auto-start"
    else
        systemctl daemon-reload
        log_info "To start the service, run:"
        echo "  sudo systemctl start $SERVICE_NAME"
        echo "  sudo systemctl enable $SERVICE_NAME  # Enable auto-start"
    fi

    log_success "Linux service installed successfully!"
}

# Install for macOS (launchd)
install_macos() {
    log_info "Installing for macOS (launchd)..."

    # Determine plist file location
    if [[ $EUID -eq 0 ]]; then
        PLIST_DIR="/Library/LaunchDaemons"
        USE_SUDO=true
        log_info "Installing as system service"
    else
        PLIST_DIR="$HOME/Library/LaunchAgents"
        USE_SUDO=false
        log_info "Installing as user service"
    fi

    # Create LaunchAgents directory if needed
    mkdir -p "$PLIST_DIR"

    # Get current user info
    USER_NAME=$(whoami)
    HOME_DIR="$HOME"

    # Copy and customize plist file
    PLIST_FILE="$PLIST_DIR/com.cc-im.app.plist"
    log_info "Creating plist file: $PLIST_FILE"

    sed -e "s|%USER%|$USER_NAME|g" \
        -e "s|%WORKDIR%|$PROJECT_DIR|g" \
        -e "s|%HOME%|$HOME_DIR|g" \
        -e "s|%BUN_PATH%|$BUN_PATH|g" \
        -e "s|%LOGDIR%|$LOG_DIR|g" \
        "$SCRIPT_DIR/com.cc-im.app.plist" > "$PLIST_FILE"

    # Set correct permissions
    if [[ "$USE_SUDO" == true ]]; then
        sudo chown root:wheel "$PLIST_FILE"
        sudo chmod 644 "$PLIST_FILE"
    else
        chmod 644 "$PLIST_FILE"
    fi

    # Load the service
    log_info "Loading service..."
    if [[ "$USE_SUDO" == true ]]; then
        if ! sudo launchctl bootstrap system "$PLIST_FILE" 2>/dev/null; then
            # Fallback to older load method
            if ! sudo launchctl load -w "$PLIST_FILE" 2>/dev/null; then
                log_error "Failed to load service. Checking plist validity..."
                if ! plutil -lint "$PLIST_FILE" &>/dev/null; then
                    log_error "Plist file has syntax errors"
                    plutil -lint "$PLIST_FILE"
                fi
                exit 1
            fi
        fi
        log_success "System service loaded"
        log_info "To start the service, run:"
        echo "  sudo launchctl start com.cc-im.app"
    else
        if ! launchctl bootstrap gui/$(id -u) "$PLIST_FILE" 2>/dev/null; then
            # Fallback to older load method
            if ! launchctl load -w "$PLIST_FILE" 2>/dev/null; then
                log_error "Failed to load service. Checking plist validity..."
                if ! plutil -lint "$PLIST_FILE" &>/dev/null; then
                    log_error "Plist file has syntax errors"
                    plutil -lint "$PLIST_FILE"
                fi
                exit 1
            fi
        fi
        log_success "User service loaded"
        log_info "To start the service, run:"
        echo "  launchctl start com.cc-im.app"
    fi

    log_success "macOS service installed successfully!"
}

# Print usage
print_usage() {
    cat << EOF
CC-IM Service Installer

Usage: $0 [OPTIONS]

Options:
  --system       Install as system service (requires root/sudo)
  --user         Install as user service (default)
  --uninstall    Remove the service
  --help         Show this help message

Examples:
  $0                    # Install as user service
  sudo $0 --system      # Install as system service
  $0 --uninstall        # Remove user service
  sudo $0 --uninstall   # Remove system service

EOF
}

# Uninstall service
uninstall_service() {
    OS=$(detect_os)

    if [[ "$OS" == "linux" ]]; then
        if [[ $EUID -eq 0 ]]; then
            SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
            log_info "Stopping and disabling system service..."
            systemctl stop "$SERVICE_NAME" 2>/dev/null || true
            systemctl disable "$SERVICE_NAME" 2>/dev/null || true
            rm -f "$SERVICE_FILE"
            systemctl daemon-reload
        else
            SERVICE_FILE="$HOME/.config/systemd/user/$SERVICE_NAME.service"
            log_info "Stopping and disabling user service..."
            systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
            systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
            rm -f "$SERVICE_FILE"
            systemctl --user daemon-reload
        fi
        log_success "Linux service uninstalled"

    elif [[ "$OS" == "macos" ]]; then
        log_info "Unloading and removing macOS service..."
        if [[ $EUID -eq 0 ]]; then
            PLIST_FILE="/Library/LaunchDaemons/com.cc-im.app.plist"
            # Bootout system service (newer macOS)
            if ! sudo launchctl bootout system/com.cc-im.app 2>/dev/null; then
                # Fallback: unload and stop
                sudo launchctl unload -w "$PLIST_FILE" 2>/dev/null || true
                sudo launchctl stop com.cc-im.app 2>/dev/null || true
            fi
            sudo rm -f "$PLIST_FILE"
            # Verify removal
            if sudo launchctl print system/com.cc-im.app &>/dev/null; then
                log_warn "Service may still be registered. You may need to restart."
            else
                log_info "Service successfully removed from launchd"
            fi
        else
            PLIST_FILE="$HOME/Library/LaunchAgents/com.cc-im.app.plist"
            USER_ID=$(id -u)
            # Bootout user service (newer macOS)
            if ! launchctl bootout gui/$USER_ID/com.cc-im.app 2>/dev/null; then
                # Fallback: unload and stop
                launchctl unload -w "$PLIST_FILE" 2>/dev/null || true
                launchctl stop com.cc-im.app 2>/dev/null || true
            fi
            rm -f "$PLIST_FILE"
            # Verify removal
            if launchctl print gui/$USER_ID/com.cc-im.app &>/dev/null; then
                log_warn "Service may still be registered. You may need to log out and back in."
            else
                log_info "Service successfully removed from launchd"
            fi
        fi
        log_success "macOS service uninstalled"
    fi
}

# Main function
main() {
    echo "=== CC-IM Service Installer ==="
    echo ""

    # Parse arguments
    local UNINSTALL=false
    local SYSTEM=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            --uninstall)
                UNINSTALL=true
                shift
                ;;
            --system)
                SYSTEM=true
                shift
                ;;
            --user)
                SYSTEM=false
                shift
                ;;
            --help|-h)
                print_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                print_usage
                exit 1
                ;;
        esac
    done

    # Detect OS
    OS=$(detect_os)
    log_info "Detected OS: $OS"

    if [[ "$OS" == "unknown" ]]; then
        log_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi

    # Handle uninstall
    if [[ "$UNINSTALL" == true ]]; then
        uninstall_service
        exit 0
    fi

    # Check prerequisites
    check_bun || exit 1
    check_env || exit 1
    setup_logs

    # Install based on OS
    if [[ "$OS" == "linux" ]]; then
        install_linux
    elif [[ "$OS" == "macos" ]]; then
        install_macos
    fi

    echo ""
    log_success "Installation complete!"
    echo ""
    log_info "View logs:"
    echo "  tail -f $LOG_DIR/app.log"
    echo ""
    log_info "For more commands, see: cc-im --help"
    echo ""
    log_info "Quick commands:"
    echo "  cc-im start    - Start the service"
    echo "  cc-im stop     - Stop the service"
    echo "  cc-im restart  - Restart the service"
    echo "  cc-im status   - Check service status"
    echo "  cc-im logs     - View logs"
}

main "$@"
