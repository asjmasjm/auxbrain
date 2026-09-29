# AuxBrain Version Policy

User-directed policy, 2026-09-29. Given version `0.N.P`:

- Major feature iterations: increment N, preserve P. Example: 0.19.2 -> 0.20.2.
- Small features, fixes and recompilation: preserve N, increment P. Example: 0.19.2 -> 0.19.3.
- This revised rule applies prospectively; the current tested candidate remains 0.19.2.
- Never reset the third component merely because the second component changed.
- Manifest, package, lockfile, version map, release tag, plugin ZIP and release notes
  must match the plugin version. Tags omit the display prefix `v`.
- An unchanged Companion retains its actual version. State compatibility explicitly;
  never rename an old binary to imply it was rebuilt, and do not force a backend
  upgrade when only the frontend changed.
- Update installation links and checksums for every distributed build. Public upload
  remains a separate authorized step; a local build does not imply publication.

0.19.2 requires Companion 0.13.2 for direct answer approval (API 1).
Pushing a testing branch or uploading a draft release does not authorize Publish.
