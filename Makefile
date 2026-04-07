.PHONY: help install install-system uninstall start stop restart status logs dev test check

# Default target
help:
	@echo "CC-IM - Telegram Bridge for Claude"
	@echo ""
	@echo "Deployment Commands:"
	@echo "  make install         - Install as user service (Linux/macOS)"
	@echo "  make install-system  - Install as system service (requires sudo)"
	@echo "  make uninstall       - Remove the service"
	@echo ""
	@echo "Service Control:"
	@echo "  make start           - Start the service"
	@echo "  make stop            - Stop the service"
	@echo "  make restart         - Restart the service"
	@echo "  make status          - Check service status"
	@echo "  make logs            - View service logs (follow)"
	@echo ""
	@echo "Development:"
	@echo "  make dev             - Run in development mode (with auto-reload)"
	@echo "  make test            - Run tests"
	@echo "  make check           - Run typecheck and lint"
	@echo ""
	@echo "Setup:"
	@echo "  make setup           - Install dependencies and setup"
	@echo ""

# Detect OS
UNAME_S := $(shell uname -s)

# Install service (user level)
install:
	@echo "Installing CC-IM service..."
	@bash deploy/install-service.sh --user

# Install service (system level)
install-system:
	@echo "Installing CC-IM system service..."
	@sudo bash deploy/install-service.sh --system

# Uninstall service
uninstall:
	@echo "Uninstalling CC-IM service..."
	@if [ "$(UNAME_S)" = "Linux" ]; then \
		if [ -f "$(HOME)/.config/systemd/user/cc-im.service" ]; then \
			bash deploy/install-service.sh --uninstall; \
		else \
			sudo bash deploy/install-service.sh --uninstall; \
		fi \
	elif [ "$(UNAME_S)" = "Darwin" ]; then \
		if [ -f "$(HOME)/Library/LaunchAgents/com.cc-im.app.plist" ]; then \
			bash deploy/install-service.sh --uninstall; \
		else \
			sudo bash deploy/install-service.sh --uninstall; \
		fi \
	fi

# Start service
start:
	@if [ "$(UNAME_S)" = "Linux" ]; then \
		if [ -f "$(HOME)/.config/systemd/user/cc-im.service" ]; then \
			systemctl --user start cc-im; \
			echo "Started user service"; \
		elif systemctl list-unit-files | grep -q "^cc-im.service"; then \
			sudo systemctl start cc-im; \
			echo "Started system service"; \
		else \
			echo "Service not installed. Run: make install"; \
			exit 1; \
		fi \
	elif [ "$(UNAME_S)" = "Darwin" ]; then \
		if [ -f "$(HOME)/Library/LaunchAgents/com.cc-im.app.plist" ]; then \
			launchctl start com.cc-im.app; \
			echo "Started user service"; \
		elif [ -f "/Library/LaunchDaemons/com.cc-im.app.plist" ]; then \
			sudo launchctl start com.cc-im.app; \
			echo "Started system service"; \
		else \
			echo "Service not installed. Run: make install"; \
			exit 1; \
		fi \
	fi

# Stop service
stop:
	@if [ "$(UNAME_S)" = "Linux" ]; then \
		if [ -f "$(HOME)/.config/systemd/user/cc-im.service" ]; then \
			systemctl --user stop cc-im; \
			echo "Stopped user service"; \
		elif systemctl list-unit-files | grep -q "^cc-im.service"; then \
			sudo systemctl stop cc-im; \
			echo "Stopped system service"; \
		else \
			echo "Service not installed"; \
			exit 1; \
		fi \
	elif [ "$(UNAME_S)" = "Darwin" ]; then \
		if [ -f "$(HOME)/Library/LaunchAgents/com.cc-im.app.plist" ]; then \
			launchctl stop com.cc-im.app; \
			echo "Stopped user service"; \
		elif [ -f "/Library/LaunchDaemons/com.cc-im.app.plist" ]; then \
			sudo launchctl stop com.cc-im.app; \
			echo "Stopped system service"; \
		else \
			echo "Service not installed"; \
			exit 1; \
		fi \
	fi

# Restart service
restart: stop start

# Check status
status:
	@if [ "$(UNAME_S)" = "Linux" ]; then \
		if [ -f "$(HOME)/.config/systemd/user/cc-im.service" ]; then \
			systemctl --user status cc-im --no-pager; \
		elif systemctl list-unit-files | grep -q "^cc-im.service"; then \
			sudo systemctl status cc-im --no-pager; \
		else \
			echo "Service not installed. Run: make install"; \
			exit 1; \
		fi \
	elif [ "$(UNAME_S)" = "Darwin" ]; then \
		if [ -f "$(HOME)/Library/LaunchAgents/com.cc-im.app.plist" ]; then \
			launchctl print "gui/$(UID)/com.cc-im.app" 2>/dev/null || echo "Service not running"; \
		elif [ -f "/Library/LaunchDaemons/com.cc-im.app.plist" ]; then \
			sudo launchctl print system/com.cc-im.app 2>/dev/null || echo "Service not running"; \
		else \
			echo "Service not installed. Run: make install"; \
			exit 1; \
		fi \
	fi

# View logs
logs:
	@if [ -f "logs/app.log" ]; then \
		tail -f logs/app.log; \
	else \
		echo "No logs found. Make sure the service is running."; \
		exit 1; \
	fi

# Development
setup:
	@echo "Setting up CC-IM..."
	@bun install
	@if [ ! -f ".env" ]; then \
		cp .env.example .env; \
		echo ".env created. Please edit it with your configuration."; \
	fi
	@mkdir -p logs

dev:
	@bun --watch src/main.ts

test:
	@bun test

check:
	@bun run typecheck && bun run lint && bun run fmt:check
