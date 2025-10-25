# Makefile for Socket Mach-O compression tools
CXX := /usr/bin/clang++
CXXFLAGS := -std=c++17 -O3 -Wall -Wextra -mmacosx-version-min=11.0
LDFLAGS := -lcompression

all: socket_macho_compress socket_macho_decompress

socket_macho_compress: socket_macho_compress.cc
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)
	@echo "✅ Built socket_macho_compress"

socket_macho_decompress: socket_macho_decompress.cc
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDFLAGS)
	@echo "✅ Built socket_macho_decompress"

clean:
	rm -f socket_macho_compress socket_macho_decompress
	@echo "✅ Cleaned"

.PHONY: all clean
