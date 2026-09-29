# Changelog

## 0.19.2

- 统一中文版审核控件字号、关系和条件标签；推荐问题、密钥设置和用量菜单改为中文，保留原文与专有名词。
- 核对结论页顶部显示“同意并入库”“我要修正”；同意只提交一次，保存成功后禁用重复操作。
- 在论文卡片和核对页展示已有结构化实体关系；回答依据中读取本次提问关联的关系，不混入其他提问。
- 修改文字结论后使旧关系字段失效，保留其他条件与原文；不将文字确认伪装成实体关系提炼。
- 继承 0.18.2 的回答直接认可流程，需要本地服务 0.13.2；本轮没有修改算法或数据库结构。

## 0.18.2

- Add one-click "认可并入库" for the displayed answer and its original evidence, without an interpretation form or second approval in the paper card.
- Keep a single answer action row when evidence expands. Replace the ambiguous negative rating with "我要修正", prefill the answer and retain all cited sources; cancel returns to the answer without writing.
- Successful approval disables repeated writes and opens the corresponding paper through "查看知识". Preserve operation identity on uncertain retries and block conflicting correction until the outcome is reconciled.
- Require Companion 0.13.2's answer-approval capability; never fall back to the legacy endpoint that automatically approved newly extracted relations.
- Mark directly approved answers explicitly in cards, preserve derived candidates as unreviewed, and hide internal approval identifiers from conditions.

## 0.17.2

- Replace long contribution/source text in buttons with section-level change summaries and distinct item counts; retain the underlying knowledge and evidence.
- Remove the JSON conditions editor from the interpretation form. Preserve structured scope unchanged, hide empty conditions and display nonempty ones as read-only named fields.
- Distinguish saving pending knowledge from explicit confirmation using "保存为待确认知识", "确认入库" and "确认并入库". Keep the existing two-step backend contract, revision checks, duplicate-submit guard and recovery behavior.
- Frontend-only update; no database migration, automatic confirmation, entity extraction or paid model call added. Companion remains 0.12.2 for the full feature set.

## 0.16.2

- Show linked question counts and knowledge awaiting confirmation together on paper cards and details; keep unknown counts distinct from zero.
- Load the selected paper's graph through its work-scoped facts endpoint. Prevent stale requests and same-title papers from mixing relations; an empty paper never falls back to the entire library.
- Support verified evidence spanning adjacent source segments, including PDF page ranges and Markdown line ranges, with Companion 0.12.2. Cross-page navigation opens the first page and reports highlighting limits.
- Companion 0.12.2 includes the knowledge-search and usage endpoints introduced in plugin 0.15.2. It preserves the personal database and does not enable paid background organization.

## 0.15.2

- Add submit-only, read-only cross-paper confirmed-knowledge search, grouped by work, with backend totals, scope and evidence navigation. Preserve results when returning from a paper card.
- Add a collapsed, lazy-loaded paper usage panel. Display recorded tokens by stage and organization reuse counts, never billing totals or monetary savings; distinguish missing tracking and incomplete usage.
- Show reused_build receipts as "已复用整理结果" only when organization completes. Keep request-key retry/new-question semantics unchanged.
- Handle unsupported endpoint responses with disabled feature controls and upgrade/recheck actions, including older /knowledge dispatchers returning 400 Unknown work_id.
- Existing card, review, source-binding and algorithm workflows are unchanged. New endpoints require a Companion build containing the economics/discovery extension; the original 0.11.2 binary does not provide them.

## 0.14.2

- Show persistent source-binding results plus an Obsidian notice after each completed attempt.
- Verify the clicked evidence after saving, including later knowledge pages; do not mistake request acceptance for a unique source location.
- Distinguish success, missing/ambiguous/changed source, write errors and readback failures; offer source navigation or read-only result rechecking.
- Preserve duplicate-write protection and workflow locks. Companion 0.11.2, schema, algorithm and provider behavior are unchanged.

## 0.13.2

- Separate literal source excerpts from knowledge conclusions, with compact previews and a single expandable source.
- Open excerpt interpretation directly with one empty field; preserve source, revision checks, history and separate human confirmation.
- Replace ambiguous review actions with explicit interpretation, correction and conclusion-confirmation labels.
- Rename the selection progress stage to AuxBrain+LLM协同 and hide per-round child timings in the frontend.
- Keep Companion 0.11.2, database schema and model-call behavior unchanged.

## 0.12.2

- Restore cold-start document lookup when focus is in a sidebar, using the most recent reader.
- Add AuxBrain entry points to native file menus and right-sidebar blank/outline areas.
- Keep hidden or collapsed loaded panels reachable without reloading the current answer.
- Handle SVG and pop-out-window context targets, and capture the clicked reader's selection.
- Consume the context event only after a menu is displayed; preserve native input and unrelated menus.
- Record the user-directed version rule in VERSIONING.md. Keep Companion 0.11.2 unchanged.

## 0.11.2

- Consolidate the local 0.9.1 follow-up work into a coordinated plugin/Companion Beta.
- Include the current v17 paragraph-budget selector and request-local timing diagnostics from the backend.
- Add progressive paper cards, basic metadata, eight knowledge sections and question contributions; retain the legacy graph.
- Separate literal excerpts from knowledge claims, collapse long text, remove duplicate evidence display and make review/distillation actions explicit. Keep replacement claims pending until separately confirmed.
- Integrate schema-3 evidence locations, explicit local-source association, version checks, review receipts and same-paper confirmed memory.
- Add the unloaded-document context action and clearer original-evidence entry points.
- Show real per-round selector wait, first-content, receive and local-check timing; use an honest combined stage for non-streaming calls.
- Include the optional Tencent adapter and provider declaration; separate key saving from quota-consuming connection tests.
- Require Companion 0.11.2, rebuild the Windows binary, and refresh installation, workflow, privacy, troubleshooting and release-verification documentation.
- Keep Windows Beta unsigned; no paid live-model results are implied by offline regression tests.

## 0.9.1

- Use the shared document QA service and v16 hierarchical evidence selection in AuxBrain mode. Keep LLM-Only on its independent path.
- Index the current document temporarily, preserve PDF/Markdown evidence locations, and keep question history separate from confirmed knowledge.
- Show evidence selection as its own processing stage and account for selector and answer token usage.
- Require Companion 0.9.1 and actually compare its semantic version, rather than only checking that a version field exists.
- Distribute an updated Windows x64 Companion with build provenance. Existing knowledge remains in the user's local database.


## 0.8.5

- Prompt for provider, model, and API Key setup when first opening AuxBrain without a configured key. Keep a setup action available after dismissal.
- Follow the active Markdown or PDF document, refresh its title and question history, and clear answers and evidence belonging to the previous paper.
- Defer document switches while answering or writing knowledge; discard stale document reads and history responses.
- Preserve the chosen provider and model when entering API Key setup and returning to answer-mode settings.
- Add workflow regression tests. Continue using Companion 0.8.4; this release changes only the plugin.

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
