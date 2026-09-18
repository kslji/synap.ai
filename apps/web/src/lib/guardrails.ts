const INJECTION =
  /(ignore|disregard|forget)\s+(all|any|previous|prior|above|earlier)\s+(instructions|prompts|rules)|system prompt override|exfiltrate|reveal (your|the) (system )?prompt|you are now (dan|jailbroken)|jailbreak this/gi;
const PII_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const OPENAI_KEY = /\bsk-[A-Za-z0-9]{10,}\b/g;
const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const GITHUB_TOKEN = /\bghp_[A-Za-z0-9]{20,}\b/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;

export function sanitizeUserText(text: string): { text: string; flags: string[] } {
  const flags: string[] = [];
  let cleaned = String(text || "").trim();
  if (INJECTION.test(cleaned)) {
    flags.push("prompt_injection_pattern");
    cleaned = cleaned.replace(INJECTION, "[blocked-instruction]");
  }
  INJECTION.lastIndex = 0;
  if (PII_SSN.test(cleaned)) {
    flags.push("pii_ssn_redacted");
    cleaned = cleaned.replace(PII_SSN, "[redacted]");
  }
  PII_SSN.lastIndex = 0;
  if (OPENAI_KEY.test(cleaned)) {
    flags.push("secret_api_key_redacted");
    cleaned = cleaned.replace(OPENAI_KEY, "[redacted-key]");
  }
  OPENAI_KEY.lastIndex = 0;
  if (AWS_KEY.test(cleaned)) {
    flags.push("secret_aws_key_redacted");
    cleaned = cleaned.replace(AWS_KEY, "[redacted-key]");
  }
  AWS_KEY.lastIndex = 0;
  if (GITHUB_TOKEN.test(cleaned)) {
    flags.push("secret_github_token_redacted");
    cleaned = cleaned.replace(GITHUB_TOKEN, "[redacted-key]");
  }
  GITHUB_TOKEN.lastIndex = 0;
  if (PRIVATE_KEY.test(cleaned)) {
    flags.push("secret_private_key_redacted");
    cleaned = cleaned.replace(PRIVATE_KEY, "[redacted-private-key]");
  }
  PRIVATE_KEY.lastIndex = 0;
  return { text: cleaned, flags };
}
