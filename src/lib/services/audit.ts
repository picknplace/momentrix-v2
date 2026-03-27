import { execute } from '@/lib/db';

export async function writeAuditLog(
  userId: string,
  actionType: string,
  targetSheet?: string,
  targetId?: string,
  beforeData?: unknown,
  afterData?: unknown,
  sessionId?: string,
  result?: string,
  detail?: string
) {
  try {
    const logId = `AL-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    await execute(
      `INSERT INTO audit_log (log_id, user_id, action_type, target_sheet, target_id, before_data, after_data, session_id, result, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      logId,
      userId,
      actionType,
      targetSheet || '',
      targetId || '',
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
      sessionId || '',
      result || 'success',
      detail || ''
    );
  } catch (e) {
    console.error('Audit log error:', e);
  }
}
