#!/bin/bash
# CC-IM Install Script
# One-line install and setup as a background service
# Usage: curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash

set -e

PROJECT_NAME="cc-im"
REPO_URL="https://github.com/zhaofinger/cc-im.git"
INSTALL_DIR="$HOME/.cc-im"
INSTALL_MODE="install"

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

read_user_input() {
    local __var_name="$1"
    local __input=""

    if [[ "${CC_IM_INSTALL_NONINTERACTIVE:-0}" != "1" ]] && [[ -t 1 ]] && [[ -r /dev/tty ]]; then
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

trim_whitespace() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

strip_matching_quotes() {
    local value="$1"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
    fi

    printf '%s' "$value"
}

list_shell_env_files() {
    printf '%s\n' \
        "$HOME/.bashrc" \
        "$HOME/.bash_profile" \
        "$HOME/.profile" \
        "$HOME/.zshrc" \
        "$HOME/.zprofile"
}

collect_anthropic_var_names() {
    local names=()
    local seen=""
    local line=""
    local key=""
    local file=""

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        key="${line%%=*}"
        if [[ ":$seen:" != *":$key:"* ]]; then
            names+=("$key")
            seen="${seen}:$key"
        fi
    done < <(env | grep '^ANTHROPIC_' || true)

    while IFS= read -r file; do
        [[ -f "$file" ]] || continue

        while IFS= read -r line; do
            if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?(ANTHROPIC_[A-Z0-9_]+)= ]]; then
                key="${BASH_REMATCH[2]}"
                if [[ ":$seen:" != *":$key:"* ]]; then
                    names+=("$key")
                    seen="${seen}:$key"
                fi
            fi
        done < "$file"
    done < <(list_shell_env_files)

    printf '%s\n' "${names[@]}"
}

resolve_anthropic_var() {
    local key="$1"
    local env_value="${!key:-}"
    local file=""
    local line=""
    local candidate=""

    if [[ -n "$env_value" ]]; then
        printf 'env\t%s' "$env_value"
        return 0
    fi

    while IFS= read -r file; do
        [[ -f "$file" ]] || continue

        while IFS= read -r line; do
            if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?${key}=(.*)$ ]]; then
                candidate="${BASH_REMATCH[2]}"
                candidate="${candidate%%#*}"
                candidate="$(trim_whitespace "$candidate")"
                candidate="$(strip_matching_quotes "$candidate")"
                if [[ -n "$candidate" ]]; then
                    printf '%s\t%s' "$file" "$candidate"
                    return 0
                fi
            fi
        done < "$file"
    done < <(list_shell_env_files)

    return 1
}

upsert_env_file_var() {
    local env_file="$1"
    local key="$2"
    local value="$3"
    local temp_file

    mkdir -p "$(dirname "$env_file")"
    touch "$env_file"
    temp_file=$(mktemp "${env_file}.XXXXXX")

    awk -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        index($0, key "=") == 1 {
            if (!updated) {
                print key "=" value
                updated = 1
            }
            next
        }
        { print }
        END {
            if (!updated) {
                print key "=" value
            }
        }
    ' "$env_file" > "$temp_file"

    mv "$temp_file" "$env_file"
}

sync_anthropic_env_vars() {
    local env_file="$INSTALL_DIR/.env"
    local key=""
    local resolved=""
    local source_label=""
    local value=""
    local synced_any=0

    if [[ ! -f "$env_file" ]]; then
        return 0
    fi

    log_info "Syncing ANTHROPIC_* variables into $env_file"

    while IFS= read -r key; do
        [[ -n "$key" ]] || continue

        if resolved="$(resolve_anthropic_var "$key")"; then
            source_label="${resolved%%$'\t'*}"
            value="${resolved#*$'\t'}"
            upsert_env_file_var "$env_file" "$key" "$value"
            if [[ "$source_label" == "env" ]]; then
                log_info "Synced $key from current shell environment"
            else
                log_info "Synced $key from $source_label"
            fi
            synced_any=1
        fi
    done < <(collect_anthropic_var_names)

    if [[ "$synced_any" -eq 0 ]]; then
        log_info "No ANTHROPIC_* variables found in the current shell or shell config files."
    fi
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

bun_binary_works() {
    local bun_path="${1:-bun}"
    "$bun_path" --version >/dev/null 2>&1
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

cpu_supports_avx2() {
    local machine
    machine=$(uname -m)

    if [[ "$machine" != "x86_64" ]]; then
        return 0
    fi

    if [[ "$OSTYPE" == "linux-gnu"* ]] && [[ -r /proc/cpuinfo ]]; then
        grep -qi "avx2" /proc/cpuinfo
        return $?
    fi

    if [[ "$OSTYPE" == "darwin"* ]] && command_exists sysctl; then
        sysctl -a 2>/dev/null | grep -qi "AVX2"
        return $?
    fi

    return 0
}

should_use_baseline_bun() {
    local variant="${CC_IM_BUN_VARIANT:-auto}"

    case "$variant" in
        baseline)
            return 0
            ;;
        standard)
            return 1
            ;;
    esac

    cpu_supports_avx2 || return 0
    return 1
}

install_baseline_bun() {
    local os
    local machine
    local platform
    local archive_path
    local extract_dir
    local download_url
    local bun_binary

    os=$(detect_os)
    machine=$(uname -m)

    if [[ "$machine" != "x86_64" ]]; then
        log_error "Baseline Bun fallback only applies to x86_64 hosts."
        return 1
    fi

    case "$os" in
        linux)
            platform="linux-x64-baseline"
            ;;
        macos)
            platform="darwin-x64-baseline"
            ;;
        *)
            log_error "Unsupported OS for baseline Bun fallback: $os"
            return 1
            ;;
    esac

    if ! command_exists unzip; then
        log_error "unzip is required to install baseline Bun."
        return 1
    fi

    archive_path=$(mktemp "/tmp/cc-im-bun-${platform}.XXXXXX.zip")
    extract_dir=$(mktemp -d "/tmp/cc-im-bun-${platform}.XXXXXX")
    download_url="https://github.com/oven-sh/bun/releases/latest/download/bun-${platform}.zip"

    log_info "Downloading Bun baseline binary for older x64 CPUs..."
    if ! curl -fsSL "$download_url" -o "$archive_path"; then
        rm -f "$archive_path"
        rm -rf "$extract_dir"
        log_error "Failed to download baseline Bun from $download_url"
        return 1
    fi

    unzip -qo "$archive_path" -d "$extract_dir"
    bun_binary=$(find "$extract_dir" -type f -name bun | head -n 1)

    if [[ -z "$bun_binary" ]]; then
        rm -f "$archive_path"
        rm -rf "$extract_dir"
        log_error "Baseline Bun archive did not contain a bun binary."
        return 1
    fi

    mkdir -p "$HOME/.bun/bin"
    cp "$bun_binary" "$HOME/.bun/bin/bun"
    chmod +x "$HOME/.bun/bin/bun"

    rm -f "$archive_path"
    rm -rf "$extract_dir"

    export PATH="$HOME/.bun/bin:$PATH"
    log_success "Installed Bun baseline binary at $HOME/.bun/bin/bun"
    return 0
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
        local bun_path
        bun_path=$(which bun)

        if bun_binary_works "$bun_path"; then
            log_success "Found bun at: $bun_path"
            return 0
        fi

        log_warn "Detected bun at $bun_path, but it cannot execute on this machine."
        if should_use_baseline_bun; then
            log_info "Falling back to Bun baseline build for older x64 CPUs..."
            if install_baseline_bun && bun_binary_works "$HOME/.bun/bin/bun"; then
                return 0
            fi
        fi

        log_error "Existing bun installation is not runnable. Reinstall Bun and try again."
        exit 1
    fi

    log_warn "bun is not installed"
    if should_use_baseline_bun; then
        log_info "Installing Bun baseline build for older x64 CPUs..."
        if install_baseline_bun && bun_binary_works "$HOME/.bun/bin/bun"; then
            return 0
        fi
        log_error "Failed to install Bun baseline binary."
        exit 1
    fi

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

        if bun_binary_works bun || bun_binary_works "$HOME/.bun/bin/bun"; then
            return 0
        else
            log_warn "Installed bun, but the binary cannot execute."
            if should_use_baseline_bun; then
                log_info "Retrying with Bun baseline build..."
                if install_baseline_bun && bun_binary_works "$HOME/.bun/bin/bun"; then
                    return 0
                fi
            fi
            log_error "Please reinstall Bun with a compatible binary and try again"
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
        INSTALL_MODE="update"
        log_info "Existing installation detected at $INSTALL_DIR"
        log_info "Updating repository..."
        cd "$INSTALL_DIR"
        git pull --ff-only
        log_success "Repository updated"
    else
        INSTALL_MODE="install"
        log_info "Cloning repository..."
        rm -rf "$INSTALL_DIR"
        git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
        log_success "Repository cloned"
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

restart_service() {
    local OS=$(detect_os)

    if [[ "$INSTALL_MODE" != "update" ]]; then
        return 0
    fi

    log_info "Update detected. Restarting service..."

    if [[ "$OS" == "linux" ]]; then
        if [[ -f "$HOME/.config/systemd/user/cc-im.service" ]]; then
            systemctl --user daemon-reload
            systemctl --user reset-failed cc-im 2>/dev/null || true
            systemctl --user restart cc-im
            log_success "Service restarted"
            return 0
        fi
    elif [[ "$OS" == "macos" ]]; then
        if [[ -f "$HOME/Library/LaunchAgents/com.cc-im.app.plist" ]]; then
            launchctl stop com.cc-im.app 2>/dev/null || true
            launchctl start com.cc-im.app
            log_success "Service restarted"
            return 0
        fi
    fi

    log_warn "Service restart skipped because no installed service was found."
    return 0
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
        update)
            bash "$INSTALL_DIR/install.sh"
            ;;
        status)
            systemctl --user status cc-im --no-pager
            ;;
        logs)
            tail -f "$INSTALL_DIR/logs/app.log"
            ;;
        ""|--help|-h)
            echo "Usage:"
            echo "  cc-im start    - Start the service"
            echo "  cc-im stop     - Stop the service"
            echo "  cc-im restart  - Restart the service"
            echo "  cc-im update   - Update cc-im and restart service"
            echo "  cc-im status   - Check service status"
            echo "  cc-im logs     - View logs"
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
        update)
            bash "$INSTALL_DIR/install.sh"
            ;;
        status)
            launchctl print "gui/\$(id - u)/com.cc-im.app" 2>/dev/null || echo "Service not running"
            ;;
        logs)
            tail -f "$INSTALL_DIR/logs/app.log"
            ;;
        ""|--help|-h)
            echo "Usage:"
            echo "  cc-im start    - Start the service"
            echo "  cc-im stop     - Stop the service"
            echo "  cc-im restart  - Restart the service"
            echo "  cc-im update   - Update cc-im and restart service"
            echo "  cc-im status   - Check service status"
            echo "  cc-im logs     - View logs"
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

    check_git
    echo ""
    check_and_install_bun
    echo ""

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        INSTALL_MODE="update"
    else
        INSTALL_MODE="install"
    fi

    log_info "This script will:"
    if [[ "$INSTALL_MODE" == "update" ]]; then
        echo "  1. Update the existing cc-im installation"
        echo "  2. Refresh dependencies and service files"
        echo "  3. Restart the background service"
    else
        echo "  1. Install git (if needed)"
        echo "  2. Install bun (if needed)"
        echo "  3. Clone cc-im repository"
        echo "  4. Configure your bot"
        echo "  5. Install dependencies"
        echo "  6. Install as a background service"
    fi
    echo ""

    wait_for_confirmation

    echo ""
    setup_repo
    echo ""
    setup_env
    echo ""
    sync_anthropic_env_vars
    echo ""
    install_deps
    echo ""

    if install_service; then
        create_launcher
        restart_service

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
        echo "  cc-im update   - Update cc-im and restart service"
        echo "  cc-im status   - Check service status"
        echo "  cc-im logs     - View logs"
        echo ""
        if [[ "$INSTALL_MODE" == "update" ]]; then
            log_info "Service status after update:"
            cc-im status 2>/dev/null || true
        else
            log_info "Service Status:"
            cc-im status 2>/dev/null || true
            echo ""
            log_info "To start the service now, run: cc-im start"
        fi
    else
        log_warn "Service installation failed. You can still run the bot manually:"
        echo "  cd $INSTALL_DIR && bun run start"
    fi
}

if [[ ${#BASH_SOURCE[@]} -eq 0 || "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
