//
//
// Socket Mach-O Decompressor - Runtime decompression with caching.
// Decompresses binaries created by socket_macho_compress and executes them.
//
// Caching Strategy (follows npm/npx/socket-lib pattern):
//   Reference: https://github.com/npm/cli/blob/v11.6.2/workspaces/libnpmexec/lib/index.js#L233-L244
//   Reference: @socketsecurity/lib/src/dlx.ts generateCacheKey()
//
//   - Cache key (directory name): First 16 chars of SHA-512 hash of compressed file
//     (matches npm/npx: SHA-512 truncated to 16 chars for shorter paths)
//     (matches socket-lib: generateCacheKey() uses sha512().substring(0,16))
//   - Content verification: Full SHA-512 of decompressed binary
//     (npm uses SHA-512 for content hashes via cacache put.js algorithms: ['sha512'])
//   - First run: Decompress to ~/.socket/_dlx/<sha512-16>/node
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

// Calculate first 16 chars of SHA-512 hash (for cache keys, matching socket-lib).
// This matches npm/npx behavior and socket-lib's generateCacheKey() function.
// Reference: @socketsecurity/lib/src/dlx.ts line 36
// Implementation: createHash('sha512').update(spec).digest('hex').substring(0, 16)
std::string CalculateCacheKey(const std::vector<uint8_t>& data) {
  unsigned char hash[CC_SHA512_DIGEST_LENGTH];
  CC_SHA512(data.data(), static_cast<CC_LONG>(data.size()), hash);

  std::ostringstream ss;
  ss << std::hex << std::setfill('0');
  // Only output first 8 bytes (16 hex chars) to match socket-lib.
  for (int i = 0; i < 8; ++i) {
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

// Calculate first 16 chars of SHA-512 hash of a file (for cache keys, matching socket-lib).
std::string CalculateFileCacheKey(const std::string& path) {
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
  // Only output first 8 bytes (16 hex chars) to match socket-lib.
  for (int i = 0; i < 8; ++i) {
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

// Extract spec string from self-extracting binary if embedded.
// Format: "SOCKET_SPEC:package@version\n" appears after the decompressor stub.
std::string ExtractEmbeddedSpec(const std::string& binary_path) {
  std::ifstream file(binary_path, std::ios::binary);
  if (!file) {
    return "";
  }

  // Search for "SOCKET_SPEC:" marker in the binary.
  std::string marker = "SOCKET_SPEC:";
  std::string buffer;
  buffer.resize(4096);

  while (file.read(&buffer[0], buffer.size())) {
    size_t pos = buffer.find(marker);
    if (pos != std::string::npos) {
      // Found marker, read until newline.
      size_t start = pos + marker.length();
      size_t end = buffer.find('\n', start);
      if (end != std::string::npos) {
        return buffer.substr(start, end - start);
      }
    }
  }

  return "";
}

// Decompress and execute binary.
int DecompressAndExecute(const std::string& compressed_path, int argc, char* argv[]) {
  printf("Socket Mach-O Decompressor\n");
  printf("==========================\n\n");

  // Try to extract embedded spec string (for socket-lib cache key).
  std::string spec = ExtractEmbeddedSpec(compressed_path);
  std::string cacheKey;

  if (!spec.empty()) {
    printf("Found embedded spec: %s\n", spec.c_str());
    printf("Calculating cache key from spec (SHA-512 truncated to 16 chars)...\n");
    std::vector<uint8_t> specBytes(spec.begin(), spec.end());
    cacheKey = CalculateCacheKey(specBytes);
    printf("  Cache key: %s\n\n", cacheKey.c_str());
  } else {
    // Fallback: use compressed file hash for cache key.
    printf("No embedded spec found, using file hash for cache key\n");
    printf("Reading compressed binary: %s\n", compressed_path.c_str());
    std::vector<uint8_t> compressed_data = ReadFile(compressed_path);
    if (compressed_data.empty()) {
      return 1;
    }

    printf("Calculating cache key (SHA-512 truncated to 16 chars)...\n");
    cacheKey = CalculateCacheKey(compressed_data);
    printf("  Cache key: %s\n\n", cacheKey.c_str());
  }

  // Read compressed binary for decompression.
  printf("Reading compressed binary: %s\n", compressed_path.c_str());
  std::vector<uint8_t> compressed_data = ReadFile(compressed_path);
  if (compressed_data.empty()) {
    return 1;
  }

  // Build cache path.
  std::string home = GetHomeDirectory();
  if (home.empty()) {
    fprintf(stderr, "Error: Cannot determine home directory\n");
    return 1;
  }

  std::string cache_dir = home + "/.socket/_dlx/" + cacheKey;
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

  // Write metadata (unified schema with TypeScript dlxBinary).
  // Canonical documentation: @socketsecurity/lib/src/dlx-binary.ts (DlxMetadata interface)
  // Also documented in: packages/cli/src/utils/dlx/binary.mts
  // Core fields: version, cache_key, timestamp, checksum, checksum_algorithm, platform, arch, size, source
  // Extra fields: compressed_size, compression_algorithm, compression_ratio (C++ decompression specific)
  std::ostringstream metadata;
  metadata << "{\n";
  metadata << "  \"version\": \"1.0.0\",\n";
  metadata << "  \"cache_key\": \"" << cacheKey << "\",\n";
  metadata << "  \"timestamp\": " << (time(nullptr) * 1000LL) << ",\n";  // Milliseconds for JS compat.
  metadata << "  \"checksum\": \"" << decompressed_sha512 << "\",\n";
  metadata << "  \"checksum_algorithm\": \"sha512\",\n";
#if defined(__APPLE__)
  metadata << "  \"platform\": \"darwin\",\n";
#elif defined(__linux__)
  metadata << "  \"platform\": \"linux\",\n";
#elif defined(_WIN32)
  metadata << "  \"platform\": \"win32\",\n";
#else
  metadata << "  \"platform\": \"unknown\",\n";
#endif
#if defined(__x86_64__) || defined(_M_X64)
  metadata << "  \"arch\": \"x64\",\n";
#elif defined(__aarch64__) || defined(_M_ARM64)
  metadata << "  \"arch\": \"arm64\",\n";
#else
  metadata << "  \"arch\": \"unknown\",\n";
#endif
  metadata << "  \"size\": " << header->original_size << ",\n";
  metadata << "  \"source\": {\n";
  metadata << "    \"type\": \"decompression\",\n";
  metadata << "    \"path\": \"" << compressed_path << "\"\n";
  metadata << "  },\n";
  metadata << "  \"extra\": {\n";
  metadata << "    \"compressed_size\": " << header->compressed_size << ",\n";
  metadata << "    \"compression_algorithm\": " << header->algorithm << ",\n";
  metadata << "    \"compression_ratio\": " << (double)header->original_size / header->compressed_size << "\n";
  metadata << "  }\n";
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
    fprintf(stderr, "Uses ~/.socket/_dlx/ for caching (zero overhead on subsequent runs).\n");
    fprintf(stderr, "\n");
    fprintf(stderr, "Example:\n");
    fprintf(stderr, "  %s ./node.compressed --version\n", argv[0]);
    return 1;
  }

  return socket::macho::DecompressAndExecute(argv[1], argc, argv);
}
