const { spawnSync } = require('child_process');

// Biến billing API và bí mật của app (mật khẩu đăng nhập, AUTH_SECRET, khóa/token sàn). CLI chạy job
// là agent đọc được env, nên không được thừa hưởng các biến này.
const BILLING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const SECRET_ENV = ['SYNC_USER', 'SYNC_PASS', 'AUTH_SECRET', 'TIKTOK_APP_KEY', 'TIKTOK_APP_SECRET',
  'TIKTOK_ACCESS_TOKEN', 'SHOPEE_PARTNER_KEY', 'SHOPEE_ACCESS_TOKEN'];
const SECRET_PATTERN = /(_PASS|_PASSWORD|_SECRET)$/;

function subscriptionEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (BILLING_ENV.includes(key) || SECRET_ENV.includes(key) || SECRET_PATTERN.test(key) || /(_API_KEY|_TOKEN)$/.test(key) || key === 'OFFICE_USER') delete env[key];
  }
  return env;
}

function assertSubscription(binary, provider) {
  const probe = spawnSync(binary, provider === 'claude' ? ['auth', 'status'] : ['login', 'status'],
    { env: subscriptionEnv(), encoding: 'utf8', timeout: 15000, windowsHide: true });
  let valid = false;
  if (provider === 'claude') {
    try { const auth = JSON.parse(probe.stdout); valid = auth.loggedIn && auth.authMethod === 'claude.ai' && !!auth.subscriptionType; } catch {}
  } else valid = /logged in using chatgpt/i.test(`${probe.stdout || ''}\n${probe.stderr || ''}`);
  if (probe.status !== 0 || !valid) throw new Error('Chỉ cho phép gói Claude/ChatGPT đã đăng nhập. Không dùng API trả phí; cần đăng nhập lại CLI bằng subscription.');
}

function appInstructions(repoRoot) { return `Đọc hướng dẫn dự án tại ${repoRoot}. Chỉ thực hiện công việc được giao. Không tiết lộ thông tin đăng nhập; không gọi API AI trả phí.`; }

module.exports = { subscriptionEnv, assertSubscription, appInstructions };
