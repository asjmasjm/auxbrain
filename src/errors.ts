export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ark http 402|ark.*insufficient/i.test(message)) {
    return "火山方舟 Coding Plan 额度不足，请检查套餐用量";
  }
  if (/insufficient balance|http 402/i.test(message)) {
    return "DeepSeek 账户余额不足（HTTP 402），请充值后重试";
  }
  if (/ark.*api key is not configured|火山方舟.*未配置/i.test(message)) {
    return "尚未配置火山方舟 Coding Plan API Key";
  }
  if (/deepseek.*api key is not configured|DeepSeek.*未配置/i.test(message)) {
    return "尚未配置 DeepSeek API Key";
  }
  if (/ark http (?:401|403)|unauthorized|invalid.*api key/i.test(message)) {
    return "火山方舟鉴权失败，请检查 Coding Plan API Key";
  }
  return message;
}
