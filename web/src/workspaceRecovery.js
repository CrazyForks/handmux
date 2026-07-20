export function recoveryPromptMode(plan, {
  ignored = false,
  autoShown = false,
  liveSessionCount = 0,
} = {}) {
  if (!plan || !plan.promptEligible || ignored === true || plan.resolved || plan.pendingCount < 1) return 'none';
  if (liveSessionCount === 0 && autoShown !== true) return 'auto-dialog';
  return 'card';
}

export function recoveryReasonKey(plan) {
  return plan?.changeReason === 'boot-changed'
    ? 'workspace.bootDetected'
    : 'workspace.tmuxDetected';
}
