import java.io.BufferedInputStream;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.Properties;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;

/**
 * Walks a Java archive and every archive nested in it, writing what it finds as records for
 * generate-archive-facts.mts, which decides what they mean.
 *
 * <p>Records, one per line, tab-separated, fields escaped like records.mts ({@code \\ \t \n \r}).
 * An archive path is the chain of entry names from the scanned archive, joined by {@code !/};
 * the scanned archive itself is the empty path.
 *
 * <pre>
 *   archive     path
 *   pom         archivePath  entry  groupId  artifactId  version   (absent keys are empty)
 *   malformed   archivePath  entry  detail
 *   unreadable  archivePath  detail
 * </pre>
 */
public final class ArchiveLoader {
  private final Set<String> archiveExtensions;
  private final Writer out;

  private ArchiveLoader(Set<String> archiveExtensions, Writer out) {
    this.archiveExtensions = archiveExtensions;
    this.out = out;
  }

  public static void main(String[] args) throws IOException {
    if (args.length != 3) {
      System.err.println("Usage: java -jar archive-loader.jar <archive> <recordsFile> <ext,ext,...>");
      System.exit(64);
    }
    Set<String> extensions = new HashSet<>(Arrays.asList(args[2].split(",")));
    ZipFile zip;
    try {
      zip = new ZipFile(new File(args[0]));
    } catch (ZipException e) {
      // generate-archive-facts.mts reports this exit as "not a zip archive".
      System.err.println(e.getMessage());
      System.exit(2);
      return;
    }
    try (ZipFile root = zip;
        Writer out =
            new BufferedWriter(
                new OutputStreamWriter(new FileOutputStream(args[1]), StandardCharsets.UTF_8))) {
      ArchiveLoader loader = new ArchiveLoader(extensions, out);
      Enumeration<? extends ZipEntry> entries = root.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (!entry.isDirectory() && loader.wants(entry.getName())) {
          try (InputStream in = root.getInputStream(entry)) {
            loader.visit("", entry.getName(), in);
          }
        }
      }
    }
  }

  // The same escaping as SocketSupport.escapeField in the Maven extension.
  private static String escape(String s) {
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
  }

  // ZipInputStream reads a non-zip as an empty archive. A zip starts with a local file header, or
  // when empty with its (zip64) end of central directory record (APPNOTE.TXT 4.3.6).
  private static boolean startsLikeZip(BufferedInputStream in) throws IOException {
    byte[] signature = new byte[4];
    in.mark(signature.length);
    int read = 0;
    while (read < signature.length) {
      int n = in.read(signature, read, signature.length - read);
      if (n < 0) {
        break;
      }
      read += n;
    }
    in.reset();
    return read == signature.length
        && signature[0] == 'P'
        && signature[1] == 'K'
        && ((signature[2] == 3 && signature[3] == 4)
            || (signature[2] == 5 && signature[3] == 6)
            || (signature[2] == 6 && signature[3] == 6));
  }

  // maven-archiver writes META-INF/maven/<groupId>/<artifactId>/pom.properties.
  private static boolean isPomProperties(String entryName) {
    String[] segments = entryName.split("/", -1);
    return segments.length == 5
        && segments[0].equals("META-INF")
        && segments[1].equals("maven")
        && segments[4].equals("pom.properties");
  }

  private boolean isArchive(String entryName) {
    int dot = entryName.lastIndexOf('.');
    return dot > entryName.lastIndexOf('/')
        && archiveExtensions.contains(entryName.substring(dot + 1));
  }

  private boolean wants(String entryName) {
    return isPomProperties(entryName) || isArchive(entryName);
  }

  private void record(String... fields) throws IOException {
    for (int i = 0; i < fields.length; i++) {
      if (i > 0) {
        out.write('\t');
      }
      out.write(escape(fields[i]));
    }
    out.write('\n');
  }

  // `in` is positioned at the entry's data and is not closed here.
  private void visit(String archivePath, String entryName, InputStream in) throws IOException {
    if (isPomProperties(entryName)) {
      Properties properties = new Properties();
      try {
        properties.load(in);
      } catch (IllegalArgumentException | IOException e) {
        record("malformed", archivePath, entryName, String.valueOf(e.getMessage()));
        return;
      }
      record(
          "pom",
          archivePath,
          entryName,
          properties.getProperty("groupId", ""),
          properties.getProperty("artifactId", ""),
          properties.getProperty("version", ""));
    } else if (isArchive(entryName)) {
      String nestedPath = archivePath.isEmpty() ? entryName : archivePath + "!/" + entryName;
      record("archive", nestedPath);
      BufferedInputStream buffered = new BufferedInputStream(in);
      if (!startsLikeZip(buffered)) {
        record("unreadable", nestedPath, "not a zip archive");
        return;
      }
      // Not closed: closing a ZipInputStream closes the stream it reads from.
      ZipInputStream nested = new ZipInputStream(buffered, StandardCharsets.UTF_8);
      try {
        ZipEntry entry;
        while ((entry = nested.getNextEntry()) != null) {
          if (!entry.isDirectory()) {
            visit(nestedPath, entry.getName(), nested);
          }
        }
      } catch (IOException | IllegalArgumentException e) {
        record("unreadable", nestedPath, String.valueOf(e));
      }
    }
  }
}
