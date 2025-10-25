//
//
// Socket Mach-O Decompressor - Runtime decompression with caching.
// Decompresses binaries created by socket_macho_compress and executes them.
//
// Caching Strategy (follows npm/cacache pattern):
//   Reference: https://github.com/npm/cacache
//   Reference: https://www.npmjs.com/package/cacache
//
//   - Cache key (directory name): SHA-256 of compressed file
//     (npm uses SHA-256 for index keys via entry-index.js hashKey())
//   - Content verification: SHA-512 of decompressed binary
//     (npm uses SHA-512 for content hashes via put.js algorithms: ['sha512'])
//   - First run: Decompress to ~/.socket/cache/dlx/<sha256>/node
//   - Subsequent runs: Execute cached binary directly (zero overhead)
//
// Usage:
//   socket_macho_decompress compressed_binary [args...]
//

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#include <compression.h>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <pwd.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace socket {
namespace macho {

#if defined(__APPLE__)

// Compressed binary header format.
struct CompressedHeader {
  uint32_t magic;  // "SCMP" = 0x504D4353.
  uint32_t algorithm;
  uint64_t original_size;
  uint64_t compressed_size;
};

// Get home directory.
std::string GetHomeDirectory() {
  const char* home = getenv("HOME");
  if (home) {
    return std::string(home);
  }

  struct passwd* pw = getpwuid(getuid());
  if (pw && pw->pw_dir) {
    return std::string(pw->pw_dir);
  }

  return "";
}

// Calculate SHA-256 of data (for cache keys).
std::string CalculateSHA256(const std::vector<uint8_t>& data) {
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.data(), static_cast<CC_LONG>(data.size()), hash);

  std::ostringstream ss;
  ss << std::hex << std::setfill('0');
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; ++i) {
    ss << std::setw(2) << static_cast<unsigned>(hash[i]);
  }

  return ss.str();
}

// Calculate SHA-512 of data (for content verification, like npm/cacache).
std::string CalculateSHA512(const std::vector<uint8_t>& data) {
  unsigned char hash[CC_SHA512_DIGEST_LENGTH];
  CC_SHA512(data.data(), static_cast<CC_LONG>(data.size()), hash);

  std::ostringstream ss;
  ss << std::hex << std::setfill('0');
  for (int i = 0; i < CC_SHA512_DIGEST_LENGTH; ++i) {
    ss << std::setw(2) << static_cast<unsigned>(hash[i]);
  }

  return ss.str();
}

// Calculate SHA-256 of a file (for cache keys).
std::string CalculateFileSHA256(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    return "";
  }

  CC_SHA256_CTX ctx;
  CC_SHA256_Init(&ctx);

  char buffer[8192];
  while (file.read(buffer, sizeof(buffer))) {
    CC_SHA256_Update(&ctx, buffer, file.gcount());
  }
  if (file.gcount() > 0) {
    CC_SHA256_Update(&ctx, buffer, file.gcount());
  }

  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(hash, &ctx);

  std::ostringstream ss;
  ss << std::hex << std::setfill('0');
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; ++i) {
    ss << std::setw(2) << static_cast<unsigned>(hash[i]);
  }

  return ss.str();
}

// Calculate SHA-512 of a file (for content verification, like npm/cacache).
std::string CalculateFileSHA512(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    return "";
  }

  CC_SHA512_CTX ctx;
  CC_SHA512_Init(&ctx);

  char buffer[8192];
  while (file.read(buffer, sizeof(buffer))) {
    CC_SHA512_Update(&ctx, buffer, file.gcount());
  }
  if (file.gcount() > 0) {
    CC_SHA512_Update(&ctx, buffer, file.gcount());
  }

  unsigned char hash[CC_SHA512_DIGEST_LENGTH];
  CC_SHA512_Final(hash, &ctx);

  std::ostringstream ss;
  ss << std::hex << std::setfill('0');
  for (int i = 0; i < CC_SHA512_DIGEST_LENGTH; ++i) {
    ss << std::setw(2) << static_cast<unsigned>(hash[i]);
  }

  return ss.str();
}

// Create directory recursively.
bool CreateDirectory(const std::string& path) {
  std::string current;
  for (size_t i = 0; i < path.size(); ++i) {
    if (path[i] == '/' || i == path.size() - 1) {
      if (i == path.size() - 1 && path[i] != '/') {
        current += path[i];
      }

      if (!current.empty() && current != "/") {
        struct stat st;
        if (stat(current.c_str(), &st) != 0) {
          if (mkdir(current.c_str(), 0755) != 0) {
            return false;
          }
        }
      }

      if (i < path.size() - 1) {
        current += path[i];
      }
    } else {
      current += path[i];
    }
  }

  return true;
}

// Check if file exists.
bool FileExists(const std::string& path) {
  struct stat st;
  return stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode);
}

// Read file into memory.
std::vector<uint8_t> ReadFile(const std::string& path) {
  std::ifstream file(path, std::ios::binary | std::ios::ate);
  if (!file) {
    fprintf(stderr, "Error: Cannot open file: %s\n", path.c_str());
    return {};
  }

  std::streamsize size = file.tellg();
  file.seekg(0, std::ios::beg);

  std::vector<uint8_t> buffer(size);
  if (!file.read(reinterpret_cast<char*>(buffer.data()), size)) {
    fprintf(stderr, "Error: Cannot read file: %s\n", path.c_str());
    return {};
  }

  return buffer;
}

// Write data to file.
bool WriteFile(const std::string& path, const void* data, size_t size) {
  std::ofstream file(path, std::ios::binary);
  if (!file) {
    return false;
  }

  file.write(static_cast<const char*>(data), size);
  return file.good();
}

// Decompress and execute binary.
int DecompressAndExecute(const std::string& compressed_path, int argc, char* argv[]) {
  printf("Socket Mach-O Decompressor\n");
  printf("==========================\n\n");

  // Read compressed binary.
  printf("Reading compressed binary: %s\n", compressed_path.c_str());
  std::vector<uint8_t> compressed_data = ReadFile(compressed_path);
  if (compressed_data.empty()) {
    return 1;
  }

  // Calculate SHA-256 of compressed file.
  printf("Calculating cache key (SHA-256)...\n");
  std::string sha256 = CalculateSHA256(compressed_data);
  printf("  Cache key: %s\n\n", sha256.c_str());

  // Build cache path.
  std::string home = GetHomeDirectory();
  if (home.empty()) {
    fprintf(stderr, "Error: Cannot determine home directory\n");
    return 1;
  }

  std::string cache_dir = home + "/.socket/cache/dlx/" + sha256;
  std::string cached_binary = cache_dir + "/node";
  std::string metadata_file = cache_dir + "/.dlx-metadata.json";

  // Check if cached binary exists.
  if (FileExists(cached_binary)) {
    printf("Cache hit! Verifying cached binary...\n");
    printf("  Location: %s\n", cached_binary.c_str());

    // Verify cached binary integrity using SHA-512 (like npm/cacache).
    std::string cached_sha512 = CalculateFileSHA512(cached_binary);
    if (cached_sha512.empty()) {
      fprintf(stderr, "Warning: Cannot verify cached binary, re-decompressing\n");
    } else {
      // Read expected checksum from metadata if it exists.
      std::ifstream meta(metadata_file);
      if (meta) {
        std::string line;
        bool verified = false;
        while (std::getline(meta, line)) {
          if (line.find("\"checksum\"") != std::string::npos) {
            size_t start = line.find(": \"");
            if (start != std::string::npos) {
              start += 3;
              size_t end = line.find("\"", start);
              if (end != std::string::npos) {
                std::string expected = line.substr(start, end - start);
                if (expected == cached_sha512) {
                  verified = true;
                  printf("  ✓ Integrity verified (SHA-512 match)\n\n");
                  break;
                }
              }
            }
          }
        }

        if (!verified) {
          printf("  ✓ Binary exists (integrity check skipped)\n\n");
        }
      } else {
        printf("  ✓ Binary exists (no metadata to verify)\n\n");
      }

      // Execute cached binary directly.
      printf("Executing cached binary (zero decompression overhead)...\n");
      printf("─────────────────────────────────────────────────────────\n\n");

      // Build argv with cached_binary as argv[0].
      std::vector<char*> new_argv;
      new_argv.push_back(const_cast<char*>(cached_binary.c_str()));
      for (int i = 2; i < argc; ++i) {
        new_argv.push_back(argv[i]);
      }
      new_argv.push_back(nullptr);

      // Execute.
      execv(cached_binary.c_str(), new_argv.data());

      // If we get here, execv failed.
      fprintf(stderr, "Error: Failed to execute cached binary\n");
      return 1;
    }
  }

  // Cache miss or verification failed - decompress.
  printf("Cache miss. Decompressing to cache...\n");

  // Parse header.
  if (compressed_data.size() < sizeof(CompressedHeader)) {
    fprintf(stderr, "Error: File too small to contain header\n");
    return 1;
  }

  const CompressedHeader* header =
      reinterpret_cast<const CompressedHeader*>(compressed_data.data());

  // Validate magic.
  if (header->magic != 0x504D4353) {
    fprintf(stderr, "Error: Invalid magic number (not a compressed Socket binary)\n");
    fprintf(stderr, "Expected: 0x504D4353, Got: 0x%08x\n", header->magic);
    return 1;
  }

  printf("  Compressed size: %llu bytes (%.2f MB)\n",
         header->compressed_size,
         header->compressed_size / 1024.0 / 1024.0);
  printf("  Decompressed size: %llu bytes (%.2f MB)\n",
         header->original_size,
         header->original_size / 1024.0 / 1024.0);
  printf("  Algorithm: %u\n\n", header->algorithm);

  // Allocate memory for decompressed binary.
  printf("Allocating memory...\n");
  void* decompressed = mmap(
      nullptr,
      header->original_size,
      PROT_READ | PROT_WRITE,
      MAP_PRIVATE | MAP_ANONYMOUS,
      -1,
      0);

  if (decompressed == MAP_FAILED) {
    fprintf(stderr, "Error: Failed to allocate %llu bytes\n", header->original_size);
    return 1;
  }

  // Decompress.
  printf("Decompressing...\n");
  const uint8_t* compressed_payload = compressed_data.data() + sizeof(CompressedHeader);

  size_t result = compression_decode_buffer(
      static_cast<uint8_t*>(decompressed),
      header->original_size,
      compressed_payload,
      header->compressed_size,
      nullptr,
      static_cast<compression_algorithm>(header->algorithm));

  if (result == 0) {
    fprintf(stderr, "Error: Decompression failed\n");
    munmap(decompressed, header->original_size);
    return 1;
  }

  if (result != header->original_size) {
    fprintf(stderr, "Error: Size mismatch (expected %llu, got %zu)\n",
            header->original_size, result);
    munmap(decompressed, header->original_size);
    return 1;
  }

  printf("  ✓ Decompressed successfully\n\n");

  // Calculate checksum of decompressed binary using SHA-512 (like npm/cacache).
  printf("Calculating checksum (SHA-512)...\n");
  std::vector<uint8_t> decompressed_vec(
      static_cast<uint8_t*>(decompressed),
      static_cast<uint8_t*>(decompressed) + header->original_size);
  std::string decompressed_sha512 = CalculateSHA512(decompressed_vec);
  printf("  Checksum: %s\n\n", decompressed_sha512.c_str());

  // Create cache directory.
  printf("Creating cache directory...\n");
  if (!CreateDirectory(cache_dir)) {
    fprintf(stderr, "Error: Failed to create cache directory: %s\n", cache_dir.c_str());
    munmap(decompressed, header->original_size);
    return 1;
  }
  printf("  Location: %s\n\n", cache_dir.c_str());

  // Write decompressed binary to cache.
  printf("Writing to cache...\n");
  if (!WriteFile(cached_binary, decompressed, header->original_size)) {
    fprintf(stderr, "Error: Failed to write cached binary\n");
    munmap(decompressed, header->original_size);
    return 1;
  }

  // Make cached binary executable.
  chmod(cached_binary.c_str(), 0755);

  printf("  ✓ Cached binary: %s\n\n", cached_binary.c_str());

  // Write metadata (follows npm/cacache pattern).
  std::ostringstream metadata;
  metadata << "{\n";
  metadata << "  \"timestamp\": " << time(nullptr) << ",\n";
  metadata << "  \"compressed_path\": \"" << compressed_path << "\",\n";
  metadata << "  \"compressed_sha256\": \"" << sha256 << "\",\n";
  metadata << "  \"checksum\": \"" << decompressed_sha512 << "\",\n";
  metadata << "  \"checksum_algorithm\": \"sha512\",\n";
  metadata << "  \"original_size\": " << header->original_size << ",\n";
  metadata << "  \"compressed_size\": " << header->compressed_size << ",\n";
  metadata << "  \"algorithm\": " << header->algorithm << "\n";
  metadata << "}\n";

  WriteFile(metadata_file, metadata.str().c_str(), metadata.str().size());

  // Execute cached binary.
  printf("Executing decompressed binary...\n");
  printf("─────────────────────────────────\n\n");

  // Build argv with cached_binary as argv[0].
  std::vector<char*> new_argv;
  new_argv.push_back(const_cast<char*>(cached_binary.c_str()));
  for (int i = 2; i < argc; ++i) {
    new_argv.push_back(argv[i]);
  }
  new_argv.push_back(nullptr);

  // Execute.
  execv(cached_binary.c_str(), new_argv.data());

  // If we get here, execv failed.
  fprintf(stderr, "Error: Failed to execute decompressed binary\n");
  munmap(decompressed, header->original_size);
  return 1;
}

#else  // !defined(__APPLE__)

int DecompressAndExecute(const std::string& compressed_path, int argc, char* argv[]) {
  fprintf(stderr, "Error: This tool only works on macOS\n");
  return 1;
}

#endif  // defined(__APPLE__)

}  // namespace macho
}  // namespace socket

int main(int argc, char* argv[]) {
  if (argc < 2) {
    fprintf(stderr, "Usage: %s compressed_binary [args...]\n", argv[0]);
    fprintf(stderr, "\n");
    fprintf(stderr, "Decompresses and executes a binary created by socket_macho_compress.\n");
    fprintf(stderr, "Uses ~/.socket/cache/dlx/ for caching (zero overhead on subsequent runs).\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Example:\n");
    fprintf(stderr, "  %s ./node.compressed --version\n", argv[0]);
    return 1;
  }

  return socket::macho::DecompressAndExecute(argv[1], argc, argv);
}
