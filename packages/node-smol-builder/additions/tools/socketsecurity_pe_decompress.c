/*
 * Socket PE Decompressor - Runtime decompression and execution for Windows
 * Decompresses binaries created by socket_pe_compress and executes them
 *
 * Usage:
 *   socket_pe_decompress.exe compressed_binary [args...]
 *
 * This tool:
 *   1. Reads the compressed binary
 *   2. Decompresses it using Windows Compression API
 *   3. Executes the decompressed binary with original arguments
 */

#ifdef _WIN32

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <windows.h>
#include <compressapi.h>

/* Compressed binary header format (must match compressor) */
struct CompressedHeader {
    uint32_t magic;          /* "SEPE" = 0x53455045 */
    uint32_t algorithm;      /* Compression algorithm ID */
    uint64_t original_size;  /* Decompressed size in bytes */
    uint64_t compressed_size;/* Compressed payload size in bytes */
};

#define MAGIC_SEPE 0x53455045  /* "SEPE" */

/* Read entire file into memory */
BYTE* read_file(const char* path, SIZE_T* size) {
    HANDLE file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Cannot open file: %s (error: %lu)\n",
                path, GetLastError());
        return NULL;
    }

    LARGE_INTEGER file_size;
    if (!GetFileSizeEx(file, &file_size)) {
        fprintf(stderr, "Error: Cannot get file size (error: %lu)\n",
                GetLastError());
        CloseHandle(file);
        return NULL;
    }

    *size = (SIZE_T)file_size.QuadPart;

    BYTE* buffer = (BYTE*)malloc(*size);
    if (!buffer) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes\n", *size);
        CloseHandle(file);
        return NULL;
    }

    DWORD bytes_read;
    if (!ReadFile(file, buffer, (DWORD)*size, &bytes_read, NULL) ||
        bytes_read != *size) {
        fprintf(stderr, "Error: Cannot read file (error: %lu)\n",
                GetLastError());
        free(buffer);
        CloseHandle(file);
        return NULL;
    }

    CloseHandle(file);
    return buffer;
}

/* Decompress data using Windows Compression API */
BYTE* decompress_data(const BYTE* input, SIZE_T input_size,
                     SIZE_T output_size, DWORD algorithm) {
    /* Create decompressor */
    DECOMPRESSOR_HANDLE decompressor = NULL;
    if (!CreateDecompressor(algorithm, NULL, &decompressor)) {
        fprintf(stderr, "Error: Cannot create decompressor (error: %lu)\n",
                GetLastError());
        return NULL;
    }

    /* Allocate output buffer */
    BYTE* output = (BYTE*)malloc(output_size);
    if (!output) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for decompression\n",
                output_size);
        CloseDecompressor(decompressor);
        return NULL;
    }

    /* Decompress */
    SIZE_T decompressed_size;
    if (!Decompress(decompressor, input, input_size, output, output_size,
                    &decompressed_size)) {
        fprintf(stderr, "Error: Decompression failed (error: %lu)\n",
                GetLastError());
        free(output);
        CloseDecompressor(decompressor);
        return NULL;
    }

    CloseDecompressor(decompressor);

    if (decompressed_size != output_size) {
        fprintf(stderr, "Error: Size mismatch (expected %zu, got %zu)\n",
                output_size, decompressed_size);
        free(output);
        return NULL;
    }

    return output;
}

/* Decompress and execute binary */
int decompress_and_execute(const char* compressed_path, int argc, char* argv[]) {
    printf("Socket PE Decompressor\n");
    printf("======================\n\n");

    /* Read compressed binary */
    printf("Reading compressed binary: %s\n", compressed_path);
    SIZE_T file_size;
    BYTE* file_data = read_file(compressed_path, &file_size);
    if (!file_data) {
        return 1;
    }

    /* Parse header */
    if (file_size < sizeof(struct CompressedHeader)) {
        fprintf(stderr, "Error: File too small to contain header\n");
        free(file_data);
        return 1;
    }

    struct CompressedHeader* header = (struct CompressedHeader*)file_data;

    /* Validate magic */
    if (header->magic != MAGIC_SEPE) {
        fprintf(stderr, "Error: Invalid magic number (not a compressed Socket binary)\n");
        fprintf(stderr, "Expected: 0x%08x, Got: 0x%08x\n", MAGIC_SEPE, header->magic);
        free(file_data);
        return 1;
    }

    printf("  Compressed size: %llu bytes (%.2f MB)\n",
           header->compressed_size,
           header->compressed_size / 1024.0 / 1024.0);
    printf("  Decompressed size: %llu bytes (%.2f MB)\n",
           header->original_size,
           header->original_size / 1024.0 / 1024.0);
    printf("  Algorithm: %u\n", header->algorithm);
    printf("\n");

    /* Decompress */
    printf("Decompressing...\n");
    const BYTE* compressed_payload = file_data + sizeof(struct CompressedHeader);

    BYTE* decompressed = decompress_data(
        compressed_payload,
        (SIZE_T)header->compressed_size,
        (SIZE_T)header->original_size,
        header->algorithm
    );

    if (!decompressed) {
        free(file_data);
        return 1;
    }

    printf("  Success! Decompressed successfully\n\n");

    /* Write decompressed binary to temporary file */
    printf("Writing temporary executable...\n");

    /* Create temp file */
    char temp_dir[MAX_PATH];
    char temp_path[MAX_PATH];

    if (!GetTempPathA(MAX_PATH, temp_dir)) {
        fprintf(stderr, "Error: Cannot get temp directory (error: %lu)\n",
                GetLastError());
        free(file_data);
        free(decompressed);
        return 1;
    }

    if (!GetTempFileNameA(temp_dir, "socket_", 0, temp_path)) {
        fprintf(stderr, "Error: Cannot create temp file name (error: %lu)\n",
                GetLastError());
        free(file_data);
        free(decompressed);
        return 1;
    }

    /* Add .exe extension */
    strcat_s(temp_path, MAX_PATH, ".exe");

    /* Write decompressed binary */
    HANDLE file = CreateFileA(temp_path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Cannot create temp file: %s (error: %lu)\n",
                temp_path, GetLastError());
        free(file_data);
        free(decompressed);
        return 1;
    }

    DWORD bytes_written;
    BOOL write_success = WriteFile(file, decompressed, (DWORD)header->original_size,
                                   &bytes_written, NULL);
    CloseHandle(file);

    if (!write_success || bytes_written != header->original_size) {
        fprintf(stderr, "Error: Cannot write temp file (error: %lu)\n",
                GetLastError());
        DeleteFileA(temp_path);
        free(file_data);
        free(decompressed);
        return 1;
    }

    printf("  Temporary file: %s\n\n", temp_path);

    /* Execute decompressed binary */
    printf("Executing decompressed binary...\n");
    printf("-------------------------------------\n\n");

    /* Build command line */
    char cmdline[32768];
    cmdline[0] = '\0';

    /* Add executable path */
    strcat_s(cmdline, sizeof(cmdline), "\"");
    strcat_s(cmdline, sizeof(cmdline), temp_path);
    strcat_s(cmdline, sizeof(cmdline), "\"");

    /* Add arguments */
    for (int i = 2; i < argc; i++) {
        strcat_s(cmdline, sizeof(cmdline), " ");
        strcat_s(cmdline, sizeof(cmdline), argv[i]);
    }

    /* Execute */
    STARTUPINFOA si = { sizeof(si) };
    PROCESS_INFORMATION pi;

    if (!CreateProcessA(temp_path, cmdline, NULL, NULL, FALSE, 0,
                        NULL, NULL, &si, &pi)) {
        fprintf(stderr, "Error: Failed to execute (error: %lu)\n",
                GetLastError());
        DeleteFileA(temp_path);
        free(file_data);
        free(decompressed);
        return 1;
    }

    /* Wait for process to complete */
    WaitForSingleObject(pi.hProcess, INFINITE);

    /* Get exit code */
    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    /* Clean up */
    DeleteFileA(temp_path);
    free(file_data);
    free(decompressed);

    return (int)exit_code;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s compressed_binary [args...]\n", argv[0]);
        fprintf(stderr, "\n");
        fprintf(stderr, "Decompresses and executes a binary created by socket_pe_compress.\n");
        fprintf(stderr, "\n");
        fprintf(stderr, "Example:\n");
        fprintf(stderr, "  %s node.compressed --version\n", argv[0]);
        return 1;
    }

    return decompress_and_execute(argv[1], argc, argv);
}

#else  /* !_WIN32 */

#include <stdio.h>

int main() {
    fprintf(stderr, "Error: This tool only works on Windows\n");
    return 1;
}

#endif  /* _WIN32 */
