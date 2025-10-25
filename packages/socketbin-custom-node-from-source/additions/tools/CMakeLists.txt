# CMake build system for Socket compression tools (cross-platform)
#
# Supports:
#   - macOS: Mach-O compression with Apple Compression framework
#   - Linux: ELF compression with liblzma
#   - Windows: PE compression with Windows Compression API
#
# Usage:
#   mkdir build && cd build
#   cmake ..
#   cmake --build .
#

cmake_minimum_required(VERSION 3.15)
project(socket-compression-tools VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

# Platform detection
if(APPLE)
    message(STATUS "Building for macOS (Mach-O)")
    set(PLATFORM "macos")
elseif(UNIX)
    message(STATUS "Building for Linux (ELF)")
    set(PLATFORM "linux")
elseif(WIN32)
    message(STATUS "Building for Windows (PE)")
    set(PLATFORM "windows")
endif()

# macOS tools
if(APPLE)
    add_executable(socket_macho_compress socket_macho_compress.cc)
    target_link_libraries(socket_macho_compress "-framework Compression")
    target_compile_options(socket_macho_compress PRIVATE -O3 -Wall -Wextra)

    add_executable(socket_macho_decompress socket_macho_decompress.cc)
    target_link_libraries(socket_macho_decompress "-framework Compression")
    target_compile_options(socket_macho_decompress PRIVATE -O3 -Wall -Wextra)

    install(TARGETS socket_macho_compress socket_macho_decompress
            RUNTIME DESTINATION bin)
endif()

# Linux tools
if(UNIX AND NOT APPLE)
    find_package(LibLZMA REQUIRED)

    add_executable(socket_elf_compress socket_elf_compress.c)
    target_link_libraries(socket_elf_compress ${LIBLZMA_LIBRARIES})
    target_include_directories(socket_elf_compress PRIVATE ${LIBLZMA_INCLUDE_DIRS})
    target_compile_options(socket_elf_compress PRIVATE -O3 -Wall -Wextra)

    add_executable(socket_elf_decompress socket_elf_decompress.c)
    target_link_libraries(socket_elf_decompress ${LIBLZMA_LIBRARIES})
    target_include_directories(socket_elf_decompress PRIVATE ${LIBLZMA_INCLUDE_DIRS})
    target_compile_options(socket_elf_decompress PRIVATE -O3 -Wall -Wextra)

    install(TARGETS socket_elf_compress socket_elf_decompress
            RUNTIME DESTINATION bin)
endif()

# Windows tools
if(WIN32)
    add_executable(socket_pe_compress socket_pe_compress.c)
    target_link_libraries(socket_pe_compress Cabinet)
    target_compile_options(socket_pe_compress PRIVATE /O2 /W4)

    add_executable(socket_pe_decompress socket_pe_decompress.c)
    target_link_libraries(socket_pe_decompress Cabinet)
    target_compile_options(socket_pe_decompress PRIVATE /O2 /W4)

    install(TARGETS socket_pe_compress socket_pe_decompress
            RUNTIME DESTINATION bin)
endif()

# Testing
enable_testing()

if(APPLE)
    add_test(NAME test_macho_compress
             COMMAND socket_macho_compress)
    set_tests_properties(test_macho_compress PROPERTIES
                         WILL_FAIL TRUE)  # Should fail without arguments
endif()

if(UNIX AND NOT APPLE)
    add_test(NAME test_elf_compress
             COMMAND socket_elf_compress)
    set_tests_properties(test_elf_compress PROPERTIES
                         WILL_FAIL TRUE)  # Should fail without arguments
endif()

if(WIN32)
    add_test(NAME test_pe_compress
             COMMAND socket_pe_compress)
    set_tests_properties(test_pe_compress PROPERTIES
                         WILL_FAIL TRUE)  # Should fail without arguments
endif()

# Summary
message(STATUS "")
message(STATUS "Socket Compression Tools Configuration:")
message(STATUS "  Platform: ${PLATFORM}")
message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  C Compiler: ${CMAKE_C_COMPILER}")
if(APPLE)
    message(STATUS "  Tools: socket_macho_compress, socket_macho_decompress")
elseif(UNIX)
    message(STATUS "  Tools: socket_elf_compress, socket_elf_decompress")
    message(STATUS "  LZMA: ${LIBLZMA_LIBRARIES}")
elseif(WIN32)
    message(STATUS "  Tools: socket_pe_compress, socket_pe_decompress")
endif()
message(STATUS "")
