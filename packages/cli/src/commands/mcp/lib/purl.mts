import { PackageURL } from "@socketregistry/packageurl-js-stable";

/**
 * Build a PURL using packageurl-js for correct encoding across all ecosystems.
 * Handles namespace/name splitting per ecosystem (npm scoped @scope/name, maven
 * groupId:artifactId, golang module/path).
 */
export function buildPurl(ecosystem: string, depname: string, version: string): string {
  const type = ecosystem.toLowerCase();
  let namespace: string | undefined;
  let name: string;

  if (type === "npm" && depname.startsWith("@") && depname.includes("/")) {
    const slash = depname.indexOf("/");
    namespace = depname.slice(0, slash);
    name = depname.slice(slash + 1);
  } else if (type === "maven" && (depname.includes(":") || depname.includes("/"))) {
    const sep = depname.includes(":") ? ":" : "/";
    const idx = depname.indexOf(sep);
    namespace = depname.slice(0, idx);
    name = depname.slice(idx + 1);
  } else if (type === "golang" && depname.includes("/")) {
    const lastSlash = depname.lastIndexOf("/");
    namespace = depname.slice(0, lastSlash);
    name = depname.slice(lastSlash + 1);
  } else {
    name = depname;
  }

  const purlVersion =
    version === "unknown" || version === "1.0.0" || !version ? undefined : version;
  const purl = new PackageURL(type, namespace, name, purlVersion, undefined, undefined);
  return purl.toString();
}
