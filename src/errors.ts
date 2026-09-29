export function friendlyError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\bsk-[a-z0-9_-]+/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  if (/tencent.*(?:http (?:401|403)|unauthorized|invalid.*api key)/i.test(message)) {
    return "腾讯云 Token Plan 鉴权或权限校验失败，请检查套餐密钥、授权范围及账户状态";
  }
  if (/tencent.*api key is not configured/i.test(message)) {
    return "尚未配置腾讯云 Token Plan 接口密钥";
  }
  if (/tencent.*http (?:402|429)/i.test(message)) {
    return "腾讯云 Token Plan 额度不足或触发限流，请检查控制台；不会自动切换计费接口";
  }
  if (/ark http 402|ark.*insufficient/i.test(message)) {
    return "火山方舟 Coding Plan 额度不足，请检查套餐用量";
  }
  if (/deepseek.*(?:insufficient balance|http 402)/i.test(message)) {
    return "DeepSeek 账户余额不足（HTTP 402），请充值后重试";
  }
  if (/ark.*api key is not configured|火山方舟.*未配置/i.test(message)) {
    return "尚未配置火山方舟 Coding Plan 接口密钥";
  }
  if (/deepseek.*api key is not configured|DeepSeek.*未配置/i.test(message)) {
    return "尚未配置 DeepSeek 接口密钥";
  }
  if (/deepseek.*(?:http (?:401|403)|unauthorized|invalid.*api key)/i.test(message)) {
    return "DeepSeek 鉴权失败，请检查官网 接口密钥 和账户权限";
  }
  if (/ark http (?:401|403)/i.test(message)) {
    return "火山方舟鉴权失败，请检查 Coding Plan 接口密钥";
  }
  if (/unauthorized|invalid.*api key|http (?:401|403)/i.test(message)) {
    return "LLM 鉴权失败，请检查当前供应商的 接口密钥 和账户权限";
  }
  if (/insufficient balance|http 402/i.test(message)) {
    return "当前 LLM 服务余额或额度不足，请检查所选供应商账户";
  }
  return message;
}
