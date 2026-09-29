# AuxBrain

当前界面为中文版。参见 [0.19.2 中文使用说明](docs/0.19.2/README.md)。此版本仅准备测试分支和草稿 Release，不执行 Publish；草稿不通过 BRAT 自动分发。

Ask fine-grained questions about PDF and Markdown papers, inspect original evidence,
and progressively build a local, human-reviewed paper knowledge base.

**Plugin 0.19.2 Beta targets Windows 10/11 x64 and Obsidian Desktop 1.5.0+.** Distribution
is through GitHub/BRAT, not the official Community directory. Install both the plugin
and Windows Companion 0.13.2 for the full feature set, including cross-segment source
locations, cross-paper search and recorded usage. The original 0.11.2 binary does
not provide these updates. The plugin is MIT-licensed; the separately
distributed algorithm binary is proprietary. No Python or Conda is required.

## Download and Install

Use the [0.19.2 release page](https://github.com/asjmasjm/auxbrain/releases/tag/0.19.2)
once published. The release assets, not GitHub's automatic source-code archive, are
the installable distribution:

- `main.js`, `manifest.json`, `styles.css`: plugin files.
- `AuxBrain-Plugin-0.19.2.zip`: the same files in an `auxbrain` folder.
- `AuxBrain-Companion-0.13.2-win-x64.zip`: updated Windows runtime; BRAT does not install it.
- `AuxBrain-0.19.2-docs.zip`: this update and existing workflow documentation.
- `SHA256SUMS.txt`: checksums for the release assets.

For BRAT, add `https://github.com/asjmasjm/auxbrain`, select release `0.19.2`, and
enable AuxBrain. For manual installation, place the three plugin files in
`<vault>/.obsidian/plugins/auxbrain/`. Extract and run the Companion separately.
Keep it running while using the plugin. **BRAT does not update the Companion.**

> Companion is an unsigned Beta. SmartScreen may warn. Check the release source and
> SHA-256 before deciding whether to run it; do not globally disable security tools.

## Upgrade

1. Wait for question and knowledge-write tasks to finish.
2. Update the plugin to 0.19.2.
3. Stop the idle Companion, back up the profile, install Companion 0.13.2, and
   restart with the original profile or `--db` path. Do not run both on port 8795.
4. In Settings > Community plugins, disable then enable
   AuxBrain. Closing its sidebar alone does not reload plugin code.

The plugin requires Companion 0.11.2 or later with API protocol 1. The packaged
database schema is 3. First launch creates or migrates the local database; never
delete the database to resolve a version mismatch.

Default endpoint: `http://127.0.0.1:8795`. Non-loopback service binds are refused.
Default database: `%LOCALAPPDATA%\AuxBrain\profiles\default\auxbrain.sqlite`.
`build-info.json` records the executable hash and backend source fingerprint.

## Read, Ask, Verify

1. Open a text-based PDF or Markdown file. On an unloaded document, right-click
   **为当前文档载入AuxBrain**, use the ribbon icon, or run **向当前文档提问**.
   Right-sidebar blank/outline areas and the file's native context menu also provide
   entry. Sidebar focus at startup resolves the most recent reader. Once the current
   paper is loaded and visible, the redundant load action is hidden. A hidden loaded
   panel instead offers **打开当前文档的 AuxBrain**, preserving the existing answer.
2. First use prompts for model setup. **回答模式** opens mode/provider/model settings.
   **保存密钥** stores the key locally without a model request; **测试连接** is a
   separate, explicit request which can consume quota.
3. Enter a question or select a Chinese recommendation, then submit. Personal
   question history is separate from recommendations and includes counts/times.
4. Inspect the answer, confidence and token usage. Estimates are not final billing.
5. Select **查看AuxBrain回答依据**. Evidence defaults to TOP-1; adjust TOP-N here,
   then navigate to the original source and check the surrounding context.
6. If the answer is correct, select **同意并入库** once. The displayed answer and
   cited source evidence become human-confirmed knowledge, without rewriting or
   automatically approving newly inferred graph relations. **我要修正** opens the
   existing answer for editing; parse and inspect the proposed relations before
   confirming. Returning without submission does not save or rate the answer.
   **查看AuxBrain回答依据** only expands evidence; it does not write knowledge.

Questions and foreground knowledge writes are mutually exclusive in the UI. While a
task runs, switching papers is deferred; its result remains attached to its source.
Scanned PDFs need an existing text layer/OCR. No visual table/image ingestion is promised.

## Modes and Progress

- **AuxBrain**: hierarchical evidence selection, LLM synthesis and evidence checks;
  a question can make several model requests.
- **仅 LLM**: LLM answering without the AuxBrain correction stage.

The selection stage is labeled **AuxBrain+LLM协同**. Its per-round timing details
are hidden; the stage's elapsed time, activity indicator and overall elapsed time
remain visible. Backend telemetry is unchanged. These timings do not expose model
reasoning or promise lower latency. Tokens accumulate when available; live values
can be estimates.

## Progressive Paper Cards

**查看数据库** opens a paper-card library, with a legacy graph entry retained.
Each paper offers basic metadata, structured knowledge and question contributions.
The eight knowledge sections cover background, related work, improvements, method,
experiment setup, results, ablations and limitations/future work.

Questions gradually contribute candidate knowledge and source evidence. Candidate
status is not human approval. The system can reuse confirmed knowledge from the
same paper version; retracted or outdated records are excluded. Disclosure counts
measure recorded section coverage, not a scientific completeness score. The
**档案关联提问** count is not necessarily the entire historical question count.

Cards now show **已提问 n 次，m 条知识待入库确认** using dossier-linked counts.
In a paper detail, **查看本篇论文知识图谱** shows only that work's confirmed entity
relations. The library list separately offers **查看全部论文知识图谱**. A paper
without entity relations stays empty, even if it already has narrative knowledge.

In a paper, **查看原文依据** opens an available source passage. **关联本地原文**
is shown for items needing source-location association. File/text checks must pass
before a location is persisted. Changed source text or ambiguous repeated matches
must not be treated as a successful highlight. Basic metadata only shows recorded
fields; author affiliations and publication timelines are not silently fabricated.

Source binding now shows progress, a persistent result and a notification. Success
requires a readback of the clicked evidence's unique location, including later
knowledge pages. Missing, ambiguous or changed sources are not reported as success.
**重新核对结果** only reads the latest state and never repeats the binding write.
**跳转已关联原文** remains subject to local snapshot verification.
Companion 0.13.2 also locates quotes spanning adjacent saved segments. Cross-page
PDF evidence opens the first page and shows the page range; only a unique available
first-page passage is highlighted, not the entire multi-page quote.

Literal excerpts are labeled **待整理的原文** (or **保存的原文** for existing records),
not summaries or conclusions. Only a short source preview appears until expanded.
**写下我的理解** opens the source and one empty interpretation field directly.
**保存修正** stores the interpretation locally as a pending-review replacement,
preserving source and history. It does not automatically approve it.
An actual claim is labeled **知识结论**. **核对结论** offers **同意并入库** or
**我要修正** at the top. Agreement saves explicit human approval in one click;
there is no second confirmation page. Check the wording, relation direction and conditions.
Raw excerpts no longer offer confirmation as a conclusion. Existing records are
not migrated or silently modified. No extra cloud model calls are introduced.

**提问贡献** shows the question, time and concise changes grouped by section, not
full English source paragraphs in buttons. Open the section to inspect its knowledge
and evidence. The interpretation form no longer asks for JSON; empty conditions are
hidden, and existing structured conditions are shown as read-only Chinese fields.
Free-text corrections invalidate the old relation fields rather than displaying an
unverified old edge beside new wording. Other conditions and original evidence remain.
Saving/confirming a narrative knowledge item does not itself create entity graph edges.
Directly approved answers are labeled **用户认可的回答** and need no second card
confirmation or interpretation. The save action becomes **已同意入库** and the next
action **查看知识** opens its paper. Derived candidates remain separately reviewed.

Structured relations are shown as subject, a Chinese-labeled directional edge, and
object on cards and in review. Expanding answer evidence also reads relations linked
to that exact saved question, across contribution pages. It does not extract new
relations or use shared keywords as proof. Text-only knowledge is explicitly labeled;
backend structured extraction is still required for such answers.

Direct approval requires Companion 0.13.2 with `answer_approval_version=1`; old
services disable this action without falling back to the legacy auto-relation
promotion endpoint. Uncertain requests retry with the same operation key. No model
request is made by direct approval. Missing cited evidence or changed paper versions
are not reported as successful approval.

## Providers, Privacy and Costs

**跨论文知识检索** is a submit-only local search over confirmed paper knowledge,
with source evidence, scope and backend pagination totals. Shared terms never become
new entity relations. Paper details include a collapsed **用量** region; recorded
tokens are not a complete bill, missing usage is not zero cost, and reuse counts
are not money saved. Unsupported services disable the respective feature until
updated. Background `reused_build` completion displays **已复用整理结果** without
changing existing retry/new-question request keys.

The adapters offer DeepSeek's official API, Volcengine Coding Plan and an optional
Tencent Token Plan integration. Available options are not authorization to use a
subscription for this workload. Read the in-app **声明** and
[provider usage notes](PROVIDER-USAGE.md), including Tencent restrictions and the
unconfirmed Coding Plan scope, before selecting a service.

Keys are kept by the local credential service, not in plugin `data.json`. Questions
and required paper context are sent to the selected cloud model. A local database
does not mean LLM processing is offline. Connection tests can consume quota.
There is no silent switch to another provider or pay-as-you-go endpoint.

The default background dossier worker extracts candidates locally. The separate
`--dossier-llm` option enables DeepSeek background organization/auditing and needs
separate permission; it does not follow the foreground provider dropdown. This
release does not enable it automatically. Never publish keys, personal DBs or private
paper/history screenshots. No telemetry or advertising is included.

## Documentation and Development

Read the [0.19.2 contribution and confirmation update](docs/0.19.2/README.md) and
[0.15.2 knowledge search and usage update](docs/0.15.2/README.md). The
[0.11.2 workflow guide](docs/0.11.2/00-文档导航.md) still covers evidence/card usage,
version verification, provider notes and troubleshooting. Old-version screenshots
are not presented as new-version captures. Tests with fake models are not live-provider
certification. See [CHANGELOG](CHANGELOG.md) for changes.

```powershell
conda activate obsidian
npm ci
npm test
npm run validate:release
```

Follow [VERSIONING.md](VERSIONING.md): major feature iterations increment the second
component; small features, fixes and recompilation increment the third. Release tags match the manifest
exactly (`0.19.2`, no `v` prefix). The GitHub workflow
builds a draft with the three plugin assets; the validated Companion, guide and
checksums are attached separately. Publishing the Beta does not submit it to the
official Community directory. Backend source and user data stay outside this repo.
