# Preparing a separate public HW1 repository

The public source is selected by an explicit, reviewable
[`scripts/public-export-files.txt`](scripts/public-export-files.txt) allowlist.
No whole-directory copy is used. The export includes the application, the
synthetic sample and its generator, the optional `sample-data/` test PLYs with
their attribution, dependency locks, checks, and public documentation.

From the source repository root:

```bash
python3 scripts/export_public.py --dry-run
python3 scripts/export_public.py --output ../hw1-public-export
python3 scripts/export_public.py --scan ../hw1-public-export
```

The destination must not exist and must be outside the source repository. The
exporter does not overwrite files, initialize a repository, publish, or push.
Dry run prints SHA-256 checksums for the selected files. Both copying and scanning
reject user-specific paths, internal hostnames, email addresses, common secret
patterns, unexpected large files, and symlinks. A pattern scan is a useful check,
not proof that every possible sensitive string has been detected: review the
allowlist and resulting files before publication.

Only allowlisted files are copied. Private administration documents, Git
history, logs, screenshots, databases, environments, caches, and generated build
output are excluded. The source repository and its private documents remain
intact. An eventual public repository should start with **fresh public history**
from this export, separately from the original repository.

## Point-cloud data in the export

The **application bundle contains only Spectrum Garden**, the synthetic sample
under `frontend/public/data/`. In addition, `sample-data/` ships two attributed
Open3D PLY files — `EaglePointCloud.ply` and `fragment.ply` — as **optional
manual test data**. They are not part of the frontend build and are never served
by the app; see [`sample-data/README.md`](sample-data/README.md) and the
[Open3D MIT License](sample-data/LICENSE).

No local PLY opened through the application is ever part of this export: those
bytes stay in the browser and never reach the backend or the repository.

## Large-file policy

Every file must be small text, except for an explicit, reviewed exception list
in `scripts/export_public.py` (`LARGE_PUBLIC_FILES`). Each exception is **pinned
to an exact SHA-256**, and a mismatch fails the export immediately. Only the two
`sample-data/` PLY files are pinned today. Because they are binary, the UTF-8
and secret-pattern scan does not apply to them; the checksum is what fixes their
contents. Any other file above 1,000,000 bytes is still rejected, so an
unreviewed large file cannot slip in.

After exporting, follow the clean-environment commands in `README.md` to install
dependencies and verify the app. Browser tests create their own temporary DB.
