# Personal database

The website code remains static on GitHub. Personal content is cached durably in the browser and can be saved as the same package locally or in Google Drive:

```text
selected folder/                 # picker starts in Documents
├── database.json                # all personal content records
├── assets/                      # content-hashed binary attachments
├── cloud-config.json            # public OAuth configuration only
└── README.md                    # portable package guide
```

Subjects and subdirectories are logical records inside JSON, rather than additional physical folders. Website logos and public archive files in the repository are separate from this personal package. Complete ZIP/folder backups include all cached personal content, including cloud-selected entries. Tool project state remains in its existing stores; the retained Unified Vault modules cover those stores, but its homepage interface is currently planned.

## JSON contract

`format: "vital-pancakes-database"`, `schemaVersion: 1`, `datasetId` and a monotonic `revision` identify the dataset. Tables are keyed by stable IDs:

| Field | Contents |
| --- | --- |
| `folders` | ID, title, parent ID, inherited storage preference, optional role and legacy section metadata |
| `entries` | ID, parent directory, type, title, ordered content blocks, structured type-specific data, storage preference |
| `assets` | ID, `assets/` path, filename, MIME type, size and SHA-256 hash |
| `links` | ID, source ID, target ID and relationship |
| `tombstones` | Deleted record identity, table and last storage preference, for sync |
| `settings` | Portable dataset preferences; default storage is local |
| `migrations` | Completed legacy migrations; original browser records are retained |

Entries support mixed articles, text, images, documents, notecards, decks, glossary definitions, saved graph views and interactable references. Existing recipe/study/algorithm/etc. fields remain in `data`. Editor folder paths are mirrored into the canonical hierarchy, and locally uploaded study media is included in `assets/` with stable references. Blocks support Markdown, raw LaTeX, asset references, links, card/definition references, editable diagram source and optional interactable embeds. Embeds load only after selection and may be blocked by the destination website. Diagram source is preserved as editable text; rendered diagrams can be attached as images.

Cards live once under Studies & Projects → Notecards. Decks and articles reference card IDs. Review history belongs to the original card. Definitions live under Library → Glossary. Graph views save their center and depth; neighborhoods are rebuilt from hierarchy and references, capped at 120 displayed nodes and configurable from 0–6 connections deep.

## Storage and migration

`local`, `cloud`, `both` or `inherit` is a preference, not evidence of a completed save. Browser cache remains available while editing, including cloud-selected records. Local folder saves are explicit. Drive sync can be manual or explicitly enabled for automatic syncing of current and future cloud-selected content while the site is open. Folder permission is device-local and may require renewal. Unsupported browsers use ZIP import/export. No website can silently write to Documents.

The canonical browser database is IndexedDB `vital-pancakes-database`: `state` stores JSON, `assets` stores immutable bytes by hash, and `device` stores folder permissions, sync bases, receipts and recovery copies. Device metadata is excluded from portable packages and Vault capture. Imports retain the prior dataset and its immutable assets; Storage & backup can restore a recovery copy. The original workspace and subject practice caches are retained for compatibility. Existing glossary entries migrate without deleting their original storage.

Writes compare revisions within a transaction. A stale tab receives an error instead of overwriting newer data. ZIP/folder imports validate hierarchy, references, URLs and attachment hashes. Folder saves reject a divergent existing manifest. Keep independent file backups: clearing browser storage removes both the active cache and browser recovery copies.

## Google Drive setup

The hosted website is configured with the public web client from Google Cloud project `vital-pancakes`, using authorized JavaScript origin `https://amaynes.github.io` and only the `drive.file` scope. The Drive API is enabled. The OAuth app remains **External / Testing** with the owner's approved account on the test-user list; it is not publicly launched. New users must be added in Google Auth Platform → Audience until production readiness and any required verification are complete. End-to-end sign-in and sync still require user consent and verification; configuration alone does not back up content.

For a separately hosted copy:

1. Enable Drive API in a Google Cloud project. Create a web OAuth client and add the deployed website origin (and your localhost origin for development).
2. Set its public `clientId` in the repository's `cloud-config.json`. Keep the limited `drive.file` scope. Tokens, passwords, client secrets and refresh tokens never belong in this file.
3. Use the small **Sign in with Google** link on the home page, or Library → Storage & backup, to open the existing connection controls and sync selected content. The home-page link is navigation, not an automatic authorization or upload. A dedicated package folder is created for the dataset. Another device can import that accessible folder using its ID, then connect it for subsequent syncs.

Tokens expire and remain in memory by default. **Remember this browser** optionally stores the short-lived access token in `sessionStorage` (not localStorage, IndexedDB, a portable package, or Git). This survives reloads and navigation in the same tab, not indefinitely; browser session restoration can restore tab storage until expiry. Same-origin scripts can read it, so only use remembering in your own trusted browser profile. No refresh token or client secret is stored. The account preference is saved in device metadata; reconnecting remains a user gesture when authorization expires or no tab token exists. There is no hidden popup or automatic extension of Google's expiry.

The first verified Drive connection atomically binds the browser library to Google's stable Drive permission ID, obtained from `about.get` using the existing `drive.file` scope. Every sync/import rechecks the Google identity before package IO. Another account is rejected; a separate browser profile is required for another person's library. Disconnect/Forget abort requests, invalidate restored sessions across tabs, and disable automatic sync. Forget also removes the remember preference. Neither action erases or hides the local library, recovery copies, Google files, or the account safety binding. This is browser-profile separation, not physical-device identification, fingerprinting, encryption, or a multi-user login system. Clearing all site storage also clears the binding and unsynced data, so export first. An existing unbound library is assigned to the first account connected after this update.

Automatic sync is off by default. Enable it in Library → Storage & backup after connecting. The shared navigation shell listens for committed database changes (debounced), online/visibility events, and checks about once a minute while a page is open. Network errors back off up to five minutes; conflicts pause until explicitly resolved and manually synced. No service worker performs private data transfers. Safe cross-tab automatic synchronization requires Web Locks; unsupported browsers can still manually sync. Stored receipts—not the remember flag—determine synced badges. The feature covers the canonical personal database, not separate tool stores. A secure per-user backend would be needed for seamless long-lived website sessions; that infrastructure is not part of this static implementation.

Only local/cloud/both preferences selecting cloud are uploaded. Structural ancestors are retained with unnecessary metadata stripped; local-only cross-references stop sync rather than silently publishing their content. Assets upload before the manifest. Three-way merge handles independent changes; concurrent edits/deletions stop and preserve both copies for explicit resolution. ETag-conditional manifest updates reject concurrent remote writes. A synced badge is based on the last completed upload and matching content.

AI file commands expose `drive.remember`, `drive.auto-sync.enable`, `drive.auto-sync.disable`, `drive.disconnect`, and `drive.forget` alongside `drive.sync`. Each needs its own one-action UI grant and protocol permissions. Preview does no IO. Granting enable authorizes ongoing transfer of cloud-selected content; it is not presented as a one-upload grant. Google consent/reconnection remains human-controlled. Context exposes only connection/settings booleans, never account identity or credentials.

Google setup follows the [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) and [web OAuth client configuration](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).

The Drive implementation uses the v2 metadata ETag for conditional writes. Live OAuth/Drive behavior still needs verification with a configured project and account. Sync never changes sharing permissions. SharedVP publication, private share-link authorization, public discovery and native app-store distribution remain future work.
