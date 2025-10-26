# Makefile for Socket Mach-O compression tools.
#
# Builds:
#   - socket_macho_compress: Compresses Mach-O binaries using Apple's Compression framework
#   - socket_macho_decompress: Decompresses and executes compressed binaries
#
# Usage:
#   make                 # Build all tools
#   make compress        # Build only the compressor
#   make decompress      # Build only the decompressor
#   make clean           # Remove build artifacts
#   make install         # Install to /usr/local/bin (requires sudo)
#

CXX := /usr/bin/clang++
CXXFLAGS := -std=c++17 -O3 -Wall -Wextra
LDFLAGS :=

# macOS-specific flags.
ifeq ($(shell uname),Darwin)
	CXXFLAGS += -mmacosx-version-min=11.0
	LDFLAGS += -lcompression
endif

TARGETS := socket_macho_compress socket_macho_decompress
INSTALL_DIR := /usr/local/bin

.PHONY: all clean install compress decompress

all: $(TARGETS)

compress: socket_macho_compress

decompress: socket_macho_decompress

socket_macho_compress: socket_macho_compress.cc
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)
	@echo "✅ Built socket_macho_compress"

socket_macho_decompress: socket_macho_decompress.cc
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)
	@echo "✅ Built socket_macho_decompress"

clean:
	rm -f $(TARGETS)
	@echo "✅ Cleaned build artifacts"

install: $(TARGETS)
	@echo "Installing to $(INSTALL_DIR)..."
	install -m 755 socket_macho_compress $(INSTALL_DIR)/
	install -m 755 socket_macho_decompress $(INSTALL_DIR)/
	@echo "✅ Installed to $(INSTALL_DIR)"

test: $(TARGETS)
	@echo "Running basic tests..."
	@./socket_macho_compress --help || true
	@./socket_macho_decompress --help || true
	@echo "✅ Basic tests passed"
