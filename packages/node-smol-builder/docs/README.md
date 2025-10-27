# node-smol-builder Documentation

Package-level documentation for the Socket custom Node.js binary builder.

## Overview

This package builds a custom Node.js v24.10.0 binary from source with Socket security patches, Brotli compression support, SEA support, and bootstrap integration.

## Contents

- **[compression-quick-start.md](./compression-quick-start.md)** - Quick start guide for macOS binary compression
- **[compression-test-results.md](./compression-test-results.md)** - Real-world compression performance benchmarks

Future package-level documentation will be added here for:
- Build process overview and configuration
- Socket patch architecture and versioning
- Cross-platform build considerations
- Upstream Node.js tracking and update process

## Sub-Package Documentation

- **wasm-bundle/** - Rust WASM compression module
  - [Cross-Platform Compression](../wasm-bundle/docs/cross-platform-compression.md) - WASM-based binary compression without UPX
  - [macOS Binary Compression](../wasm-bundle/docs/macho-compression.md) - macOS-specific Mach-O compression

## Quick Links

- **Main README**: `../README.md`
- **Build Scripts**: `../scripts/`
- **Socket Patches**: `../patches/socket/`

## Build Output

- **Location**: `build/out/Release/`
- **Files**: `node` (custom Node.js binary with Socket patches)
- **Platforms**: Currently builds for host platform only

## Upstream

- **Repository**: https://github.com/nodejs/node
- **Version**: v24.10.0
- **Socket Patches**: `../patches/socket/`
- **License**: MIT
