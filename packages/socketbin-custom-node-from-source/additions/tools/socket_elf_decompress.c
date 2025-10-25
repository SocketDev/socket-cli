/*
 * Socket ELF Decompressor - Runtime decompression and execution for Linux
 * Decompresses binaries created by socket_elf_compress and executes them
 *
 * Usage:
 *   socket_elf_decompress compressed_binary [args...]
 *
 * This tool:
 *   1. Reads the compressed binary
 *   2. Decompresses it using liblzma
 *   3. Executes the decompressed binary with original arguments
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <lzma.h>

/* Compressed binary header format (must match compressor) */
struct CompressedHeader {
    uint32_t magic;          /* "SELF" = 0x53454C46 */
    uint32_t algorithm;      /* Compression algorithm ID */
    uint64_t original_size;  /* Decompressed size in bytes */
    uint64_t compressed_size;/* Compressed payload size in bytes */
};

#define MAGIC_SELF 0x53454C46  /* "SELF" */
#define ALGO_LZMA  1
#define ALGO_ZSTD  2
#define ALGO_LZ4   3

/* Read entire file into memory */
uint8_t* read_file(const char* path, size_t* size) {
    FILE* file = fopen(path, "rb");
    if (!file) {
        fprintf(stderr, "Error: Cannot open file: %s\n", path);
        return NULL;
    }

    fseek(file, 0, SEEK_END);
    *size = ftell(file);
    fseek(file, 0, SEEK_SET);

    uint8_t* buffer = malloc(*size);
    if (!buffer) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes\n", *size);
        fclose(file);
        return NULL;
    }

    if (fread(buffer, 1, *size, file) != *size) {
        fprintf(stderr, "Error: Cannot read file: %s\n", path);
        free(buffer);
        fclose(file);
        return NULL;
    }

    fclose(file);
    return buffer;
}

/* Decompress LZMA data */
uint8_t* decompress_lzma(const uint8_t* input, size_t input_size,
                         size_t output_size) {
    /* Allocate output buffer */
    uint8_t* output = malloc(output_size);
    if (!output) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for decompression\n",
                output_size);
        return NULL;
    }

    /* Decompress */
    size_t in_pos = 0;
    size_t out_pos = 0;
    uint64_t memlimit = UINT64_MAX;

    lzma_ret ret = lzma_stream_buffer_decode(
        &memlimit,
        0,
        NULL,
        input,
        &in_pos,
        input_size,
        output,
        &out_pos,
        output_size
    );

    if (ret != LZMA_OK) {
        fprintf(stderr, "Error: LZMA decompression failed (code: %d)\n", ret);
        free(output);
        return NULL;
    }

    if (out_pos != output_size) {
        fprintf(stderr, "Error: Size mismatch (expected %zu, got %zu)\n",
                output_size, out_pos);
        free(output);
        return NULL;
    }

    return output;
}

/* Decompress and execute binary */
int decompress_and_execute(const char* compressed_path, int argc, char* argv[]) {
    printf("Socket ELF Decompressor\n");
    printf("=======================\n\n");

    /* Read compressed binary */
    printf("Reading compressed binary: %s\n", compressed_path);
    size_t file_size;
    uint8_t* file_data = read_file(compressed_path, &file_size);
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
    if (header->magic != MAGIC_SELF) {
        fprintf(stderr, "Error: Invalid magic number (not a compressed Socket binary)\n");
        fprintf(stderr, "Expected: 0x%08x, Got: 0x%08x\n", MAGIC_SELF, header->magic);
        free(file_data);
        return 1;
    }

    printf("  Compressed size: %lu bytes (%.2f MB)\n",
           header->compressed_size,
           header->compressed_size / 1024.0 / 1024.0);
    printf("  Decompressed size: %lu bytes (%.2f MB)\n",
           header->original_size,
           header->original_size / 1024.0 / 1024.0);
    printf("  Algorithm: %u\n", header->algorithm);
    printf("\n");

    /* Decompress */
    printf("Decompressing...\n");
    const uint8_t* compressed_payload = file_data + sizeof(struct CompressedHeader);

    uint8_t* decompressed = NULL;
    if (header->algorithm == ALGO_LZMA) {
        decompressed = decompress_lzma(
            compressed_payload,
            header->compressed_size,
            header->original_size
        );
    } else {
        fprintf(stderr, "Error: Unsupported algorithm: %u\n", header->algorithm);
        free(file_data);
        return 1;
    }

    if (!decompressed) {
        free(file_data);
        return 1;
    }

    printf("  ✅ Decompressed successfully\n\n");

    /* Write decompressed binary to temporary file */
    printf("Writing temporary executable...\n");

    char temp_path[] = "/tmp/socket_decompress_XXXXXX";
    int temp_fd = mkstemp(temp_path);
    if (temp_fd == -1) {
        fprintf(stderr, "Error: Failed to create temporary file\n");
        free(file_data);
        free(decompressed);
        return 1;
    }

    ssize_t written = write(temp_fd, decompressed, header->original_size);
    close(temp_fd);

    if (written != (ssize_t)header->original_size) {
        fprintf(stderr, "Error: Failed to write temporary file\n");
        unlink(temp_path);
        free(file_data);
        free(decompressed);
        return 1;
    }

    /* Make temporary file executable */
    chmod(temp_path, 0755);

    printf("  Temporary file: %s\n\n", temp_path);

    /* Execute decompressed binary */
    printf("Executing decompressed binary...\n");
    printf("─────────────────────────────────\n\n");

    /* Build new argv with temp_path as argv[0] */
    char** new_argv = malloc((argc) * sizeof(char*));
    new_argv[0] = temp_path;
    for (int i = 2; i < argc; i++) {
        new_argv[i - 1] = argv[i];
    }
    new_argv[argc - 1] = NULL;

    /* Execute */
    execv(temp_path, new_argv);

    /* If we get here, execv failed */
    fprintf(stderr, "Error: Failed to execute decompressed binary\n");
    unlink(temp_path);
    free(file_data);
    free(decompressed);
    free(new_argv);
    return 1;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s compressed_binary [args...]\n", argv[0]);
        fprintf(stderr, "\n");
        fprintf(stderr, "Decompresses and executes a binary created by socket_elf_compress.\n");
        fprintf(stderr, "\n");
        fprintf(stderr, "Example:\n");
        fprintf(stderr, "  %s ./node.compressed --version\n", argv[0]);
        return 1;
    }

    return decompress_and_execute(argv[1], argc, argv);
}
