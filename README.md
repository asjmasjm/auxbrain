# AuxBrain for Obsidian

AuxBrain helps researchers ask fine-grained questions about Markdown and PDF papers,
inspect supporting evidence, and build a local human-reviewed knowledge graph.

> [!IMPORTANT]
> AuxBrain is currently distributed as a public beta through GitHub and BRAT. It is
> not published in the official Obsidian Community directory. Version 0.8.2 adds a
> separately distributed Windows x64 Companion to the GitHub release. The Companion
> contains proprietary AuxBrain algorithms and is not open source.

## Requirements

- Obsidian Desktop 1.5.0 or later.
- Windows 10 or 11 x64.
- AuxBrain Companion 0.8.2 running on the same computer.
- A DeepSeek API key or Volcengine Coding Plan API key.

The current release supports the official DeepSeek API and Volcengine Coding Plan.
Support for additional LLM services is planned. API keys are sent only to the local
loopback service and are not stored in the Obsidian plugin data file.

## Beta installation

### BRAT

1. Install and enable BRAT from Obsidian's Community plugins browser.
2. Open **Settings -> BRAT -> Add beta plugin**.
3. Enter `https://github.com/asjmasjm/auxbrain`.
4. Choose `0.8.2 (Prerelease)`, install it, and enable AuxBrain. BRAT's `Latest`
   option ignores GitHub prereleases and may select 0.8.1 instead.
5. Download `AuxBrain-Companion-0.8.2-win-x64.zip` from the same release.
6. Verify its SHA-256, extract the ZIP, and run `AuxBrain-Companion.exe`.

### Manual installation

Copy these release assets into `<vault>/.obsidian/plugins/auxbrain/`:

- `main.js`
- `manifest.json`
- `styles.css`

Restart Obsidian or disable and re-enable AuxBrain after replacing the files.

Then download the matching Companion ZIP from the
[0.8.2 Beta release](https://github.com/asjmasjm/auxbrain/releases/tag/0.8.2),
verify its SHA-256, extract it, and run `AuxBrain-Companion.exe`.

## Local service

The portable Companion does not require Python or Conda. Keep its console window open
while using the plugin; close the window or press `Ctrl+C` to stop it. The default
endpoint is `http://127.0.0.1:8795`, and the service refuses non-loopback bind
addresses.

> [!WARNING]
> Companion 0.8.2 Beta is not code-signed. Microsoft Defender SmartScreen may warn
> before first launch. Download it only from the official AuxBrain GitHub release and
> compare its SHA-256 with `SHA256SUMS.txt`. Do not disable SmartScreen or antivirus
> globally. Proceed only when the source and hash match.

On Windows, the default personal database is stored at:

```text
%LOCALAPPDATA%\AuxBrain\profiles\default\auxbrain.sqlite
```

The database and schema are created or upgraded automatically on launch. Each user keeps a
separate local knowledge base containing papers, entities, reviewed relations, rejected
suggestions, question history, and model provenance.

## Privacy and network access

- The plugin connects to the configured companion-service URL, which defaults to the
  local loopback address `http://127.0.0.1:8795`.
- Questions, selected passages, document text needed for evidence retrieval, provider
  settings, and API credentials are sent to that companion service for processing.
- In LLM modes, the companion service sends the required prompt context to the selected
  DeepSeek or Volcengine service and uses the supplied API key to authenticate there.
- The companion service creates and accesses the personal SQLite knowledge base outside
  the Obsidian vault so knowledge can remain local to the user's computer.
- AuxBrain does not include client-side telemetry or advertising.

## Usage

1. Open a Markdown note or PDF paper.
2. Click the AuxBrain ribbon icon, run `向当前文档提问`, or right-click and choose the
   same command.
3. Enter a question or choose one of the bilingual recommended questions.
4. Review the answer, confidence, token usage, and processing stages.
5. Select `查看AuxBrain回答依据` to inspect the top supporting passage and navigate
   back to the source location.
6. Use thumbs-up to accept the answer and write its evidence-bound relations into the
   personal knowledge base.
7. Select `我要修正` to enter the human-in-the-loop correction workflow.

To annotate directly, select text and choose `加入 AuxBrain` from the context menu.

Answer generation and knowledge writes are mutually exclusive in this release. While
one operation is active, AuxBrain disables commands that could replace the current
document or start the other operation.

## Answer modes

- `AuxBrain`: uses the selected LLM and then applies AuxBrain evidence and confidence
  correction.
- `LLM-Only`: uses the selected LLM without AuxBrain correction or algorithm fallback.

Mode, provider, and model are configured from **回答模式**. The information button in
that dialog shows the currently supported LLM services. The API Key screen includes a
back action that returns to the answer-mode dialog.

## Development

```powershell
conda activate obsidian
npm ci
npm run validate:release
```

`npm run validate:release` type-checks and builds the plugin, then verifies the manifest,
version mapping, plugin ID, desktop requirement, and release assets.

## Release

1. Update `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` to
   the same three-part version.
2. Run `npm run validate:release`.
3. Commit and push the source to a public GitHub repository.
4. Create and push a tag matching `manifest.json` exactly, without a `v` prefix.
5. The GitHub Actions workflow creates a draft release containing `main.js`,
   `manifest.json`, and `styles.css`.
6. Build and validate the proprietary Companion outside this public repository, then
   upload its ZIP and `SHA256SUMS.txt` to the draft release.
7. Review the notes and publish the GitHub release. This Beta is currently distributed
   through GitHub and BRAT, not the official Obsidian Community directory.

## Licenses

The Obsidian plugin source in this repository is licensed under the MIT License. The
separately downloaded AuxBrain Companion is proprietary and includes its own binary
notice and third-party runtime licenses in the ZIP.
