# Changelog

## 0.8.4

- Rebuild the Windows Companion from the current backend source, including Ark thinking-mode forwarding and current algorithm dependencies.
- Require Companion 0.8.4 and update the in-app download link and installation instructions.
- Include build provenance and checksums with the Companion; retain API protocol 1 and local database upgrades.

## 0.8.3

- Make the plugin description comply with the Obsidian directory guidelines.
- Keep compatibility with AuxBrain Companion 0.8.2 and API protocol 1.

## 0.8.2

- Add a separately distributed, closed-source Windows x64 Companion containing the latest AuxBrain algorithms.
- Add Companion service identity and API protocol compatibility checks.
- Link to the matching Companion release when the local service is unavailable.
- Document the unsigned Beta and Microsoft Defender SmartScreen warning.
- Keep first-run database creation local to each Windows user.

## 0.8.1

- Prevent answering and knowledge-base writes from running at the same time in the UI.
- Rename the answer modes to `AuxBrain` and `LLM-Only`.
- Add a provider-support note for DeepSeek and Volcengine Coding Plan.
- Add a standard back action from API Key configuration to answer-mode settings.
- Add English descriptions to the recommended questions.
- Add release validation, version compatibility metadata, and GitHub release automation.
