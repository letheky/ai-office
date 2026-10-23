// Keep task choices, quota cards and account commands on the same account identity.
export const isVpsExecutor = id => id === 'vps' || String(id || '').startsWith('vps:');
export const localMachines = capabilities => (capabilities.machines || []).filter(machine => !isVpsExecutor(machine.id));

export function accountsOf(capabilities, machineId) {
  if (isVpsExecutor(machineId)) {
    if (Array.isArray(capabilities.vpsAccounts)) return capabilities.vpsAccounts;
    return ['claude', 'codex'].map(provider => ({
      id: `vps:${provider}`, workerId: 'vps',
      label: `${provider === 'codex' ? 'ChatGPT' : 'Claude'} (VPS)`,
      provider, providers: [provider], online: capabilities.vpsOnline,
      usage: { [provider]: capabilities.vpsUsage?.[provider] || { status: 'unknown' } },
    }));
  }
  return (localMachines(capabilities).find(machine => machine.id === machineId)?.members || []).map(member => ({
    ...member, provider: member.provider || member.providers?.[0],
  }));
}

// A handoff targets one account, not just its provider. Keep unavailable
// accounts visible so the owner can distinguish missing quota from missing AI.
export function handoffOptions(capabilities, machineId, now = Date.now()) {
  return accountsOf(capabilities, machineId).map(account => {
    const provider = account.provider || account.providers?.[0];
    const usage = account.usage?.[provider];
    const fresh = usage?.status === 'ok' && usage.checkedAt && usage.checkedAt <= now + 60000 && now - usage.checkedAt <= 300000;
    const windows = fresh ? (usage.windows || []).filter(w => (!w.resetsAt || w.resetsAt * 1000 > now)
      && (provider === 'codex' ? w.id?.startsWith('codex:') : !['seven_day_sonnet', 'seven_day_opus'].includes(w.id))) : [];
    const left = w => Number.isFinite(w.remainingPercent) ? w.remainingPercent : 100 - w.usedPercent;
    const exhausted = windows.some(w => left(w) <= 0);
    const period = ids => {
      const w = windows.find(w => ids.includes(w.id));
      return w && Number.isFinite(left(w)) ? `${Math.round(left(w))}%` : 'chưa rõ';
    };
    const status = account.removalPending ? 'đang gỡ' : !account.online ? 'offline' : exhausted ? 'hết hạn mức'
      : `Phiên ${period(['five_hour', 'codex:primary'])} · Tuần ${period(['seven_day', 'codex:secondary'])}`;
    return { id: account.id, provider, label: `${account.label || (provider === 'codex' ? 'ChatGPT' : 'Claude')} · ${provider === 'codex' ? 'Codex' : 'Claude'} · ${status}`,
      disabled: !!account.removalPending || !account.online || exhausted };
  });
}

export function executionAccountLabel(capabilities, workerId, provider, accountId) {
  const all = [...accountsOf(capabilities, 'vps'), ...localMachines(capabilities).flatMap(machine => accountsOf(capabilities, machine.id))];
  const account = all.find(account => account.provider === provider && (accountId ? account.id === accountId : (account.workerId || account.id) === workerId));
  return account?.label || (provider === 'codex' ? 'Codex' : 'Claude');
}

// A queued follow-up can be newer than the turn currently executing.
export function conversationExecutionLabel(capabilities, job) {
  const current = job.conversationActivity || job;
  const workerId = current.executor;
  const machine = isVpsExecutor(workerId) ? 'VPS' : localMachines(capabilities)
    .find(machine => machine.id === workerId || machine.members?.some(member => member.id === workerId || member.workerId === workerId))?.name || 'Máy chưa xác định';
  const account = executionAccountLabel(capabilities, workerId, current.provider, current.selection?.accountId);
  return `AI: ${account} · Máy: ${machine}`;
}

export function accountCommandTarget(account, provider) {
  return { machineId: account.workerId || account.id, provider };
}

// Deleting one provider on a shared worker must never target the whole worker.
export function accountRemovalTarget(account) {
  return { accountId: account.id };
}

export function subscriptionPresentation(provider, usage = {}) {
  const subscription = usage.subscription || {};
  const plan = String(subscription.plan || '').toLowerCase().replace(/[_-]/g, ' ');
  const vendor = provider === 'codex' ? 'ChatGPT' : 'Claude';
  const names = provider === 'codex'
    ? { plus: 'Plus', pro: 'Pro', free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' }
    : { pro: 'Pro', max: 'Max', free: 'Free', team: 'Team', enterprise: 'Enterprise' };
  const matched = Object.keys(names).find(name => plan.split(/\s+/).includes(name));
  const planLabel = matched ? `${vendor} ${names[matched]}` : `${vendor} · Chưa đọc được tên gói`;
  const date = value => Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : null;
  const validUntil = date(subscription.validUntil);
  return {
    planLabel,
    note: subscription.note || null,
    statusLabel: subscription.status === 'expired' ? 'Gói đã hết hạn'
      : subscription.status === 'active' ? 'Gói đang hoạt động' : 'Chưa xác định trạng thái gói',
    expiryLabel: validUntil ? `Hạn gói: ${validUntil} (giờ VN)` : 'Chưa đọc được ngày hết hạn gói',
    renewalLabel: date(subscription.renewsAt) ? `Gia hạn dự kiến: ${date(subscription.renewsAt)} (giờ VN)` : null,
  };
}

export function sharedCreditAccounts(capabilities, account, creditId) {
  if (!creditId) return [];
  const identity = item => `${item.workerId || item.id}:${item.provider || item.providers?.[0]}`;
  const all = [
    ...accountsOf(capabilities, 'vps').map(item => ({ ...item, name: `VPS · ${item.label}` })),
    ...localMachines(capabilities).flatMap(machine => accountsOf(capabilities, machine.id).map(item => ({ ...item, name: `${machine.name} · ${item.label}` }))),
  ];
  return [...new Set(all.filter(item => identity(item) !== identity(account)
    && item.usage?.codex?.resetCredits?.credits?.some(credit => credit.id === creditId)).map(item => item.name))];
}
