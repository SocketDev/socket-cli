/**
 * @fileoverview Re-export yoga-layout-prebuilt as yoga-layout.
 *
 * This allows Ink to import 'yoga-layout' while we provide the synchronous
 * prebuilt version that avoids top-level await issues in CommonJS builds.
 */

export { default } from 'yoga-layout-prebuilt'
export * from 'yoga-layout-prebuilt'
