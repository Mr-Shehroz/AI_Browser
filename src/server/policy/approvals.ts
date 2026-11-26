export interface ApprovalDecision { approved: boolean; acknowledgeNoBackup?: boolean }

export class ApprovalManager {
  private pending = new Map<string, (d: ApprovalDecision) => void>();

  request(actionId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => this.pending.set(actionId, resolve));
  }

  resolve(actionId: string, decision: ApprovalDecision): boolean {
    const fn = this.pending.get(actionId);
    if (!fn) return false;
    this.pending.delete(actionId);
    fn(decision);
    return true;
  }

  rejectAll(): void {
    for (const fn of this.pending.values()) fn({ approved: false });
    this.pending.clear();
  }
}