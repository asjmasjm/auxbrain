# LLM provider usage and billing

Technical documentation updated for 0.11.2 on 2026-09-29. The provider-policy review
below is dated 2026-09-28; it has not been represented as a new legal review. This
note is not legal advice or a provider's authorization. Save/test separation, the
optional Tencent adapter and the declaration dialog are included in the 0.11.2 build.

## Providers

- **DeepSeek official API:** its [Open Platform terms](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)
  allow downstream applications. Users still need to comply with the agreement,
  content/data requirements, and account billing rules.
- **Volcengine Coding Plan:** AuxBrain has a working adapter, but the plan's scope
  for paper QA, human annotation, and unattended background organization remains
  unconfirmed. Review the [official plan documentation](https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh)
  and obtain confirmation from Volcengine support before relying on this use case.
  Do not interpret successful authentication as authorization for the workload.
- **Tencent Token Plan:** an optional adapter is available. Its [personal plan rules](https://cloud.tencent.com/document/product/1823/130060)
  explicitly prohibit custom application backends, automated scripts and non-interactive
  batch calls. AuxBrain uses a local Companion backend; do not assume it qualifies as
  an approved tool. Obtain Tencent authorization for this workflow before using the
  plan here. A declaration or user choice does not override those rules. Violations
  can lead to subscription suspension or key revocation. This is not the ordinary
  TokenHub pay-as-you-go API, and the adapters do not silently switch to it.

The foreground adapters use these distinct endpoints:

| Adapter | Endpoint |
| --- | --- |
| DeepSeek | `https://api.deepseek.com/chat/completions` |
| Volcengine Coding Plan | `https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions` |
| Tencent Token Plan | `https://api.lkeap.cloud.tencent.com/plan/v3/chat/completions` |

A missing key or unsupported provider does not cause a cross-provider fallback.
The Coding Plan adapter does not silently switch to the regular postpaid Ark API.
The `ark-code-latest` option deliberately lets the provider route within its plan;
it is not a guarantee of a fixed underlying model. A question in AuxBrain mode can
make multiple requests, and retries/new tests can also consume quota.

## Key setup

1. Choose the answer mode, provider, and model in the answer-mode dialog. Open
   **Declaration** (`声明`) for all three providers' scope, quota and privacy notes.
   Closing the declaration returns to the unchanged selection; it is not a waiver
   or a provider approval. Tencent restrictions also remain visible in its settings.
2. Open Key configuration and select **Save Key** (`保存 Key`). This only stores
   the credential through the local Companion; it does not test the model.
3. Optionally select **Test connection** (`测试连接`). This sends a short synthetic
   prompt to the selected provider and may consume quota. It sends no paper text.
4. Use the upper-left back action to return. Connection failure does not delete
   the saved key or switch providers. Unsaved replacement input disables testing
   until saved or cleared, so an old credential is not tested by mistake.

Each user supplies their own key. Never include keys in releases, screenshots,
support logs, or source control. Revoke a key that has been publicly exposed.
The UI redacts common credential patterns in formatted errors, but this is not a
guarantee that all third-party logs or arbitrary secret formats are sanitized.

Tencent keys use a separate Windows credential target, `AuxBrain/Tencent Token Plan
API Key`, or the `TENCENT_TOKEN_PLAN_API_KEY` environment variable. No existing
credential is copied or reused. The default foreground provider remains unchanged.
Tencent selection includes DeepSeek V4 Flash/Pro, GLM 5.2/5.3/5.3 Flash, Kimi K2.7
Code/K3, MiniMax M2.7/M3, Hy4 preview, Hy3 and Auto. Hy3 requires the corresponding
Hy plan. Model availability depends on the user's subscription and current official
catalog; no subscription is purchased automatically. Auto (`tc-code-latest`) is
provider-side routing, not a fixed underlying model.

Tencent JSON extraction uses prompt-level JSON output for multi-model compatibility.
Streaming and usage parsing have offline test coverage; live model compatibility has
not been established by these tests. Unsupported model parameters or account-specific
restrictions fail visibly, without another provider or a paid-endpoint retry.

## Foreground versus background

The selected foreground provider receives the relevant question and paper context.
A local database does not imply that all processing stays offline.

The backend's default dossier worker creates excerpt candidates offline.
The separate **`--dossier-llm`** switch enables DeepSeek Flash background organization
and evidence auditing, sending bounded question/answer/evidence context to DeepSeek.
It is **not controlled by the foreground provider dropdown** and requires separate
user permission. Updating to 0.11.2 does not enable it automatically.

## Remaining confirmation

Ask Volcengine whether a local Obsidian research plugin may use the personal Coding
Plan for interactive paper QA, evidence extraction/HIL, and optional unattended
knowledge organization. Ask about each workload, permitted clients, and applicable
limits. Until clarified, do not assume the plan covers them or migrate to a paid
endpoint without the user's approval.
