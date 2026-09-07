import { telemetryBridge } from './telemetryBridge';

export interface SyncCheckResult {
  requiredSessionIds: string[];
  existingSessionIds: string[];
  error?: string;
}

export interface SyncReport {
  syncedCount: number;
  skippedCount: number;
  errors: Array<{ sessionId: string; error: string }>;
}

export interface SyncServiceOptions {
  baseUrl?: string;
  bridge?: { exportSessionZip: (id: string) => Promise<string> };
  fetchFn?: typeof fetch;
}

export class SyncService {
  private baseUrl: string;
  private bridge: { exportSessionZip: (id: string) => Promise<string> };
  private fetchFn: typeof fetch;

  constructor(options: SyncServiceOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://remus-app-recorder-backend.onrender.com').replace(/\/+$/, '');
    this.bridge = options.bridge || telemetryBridge;
    this.fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (null as any));
  }

  async checkSync(sessionIds: string[], deviceId?: string): Promise<SyncCheckResult> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/sessions/sync-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          deviceId: deviceId || 'mobile-app',
          sessionIds
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        requiredSessionIds: data.requiredSessionIds || [],
        existingSessionIds: data.existingSessionIds || []
      };
    } catch (e: any) {
      return {
        requiredSessionIds: [],
        existingSessionIds: [],
        error: e.message || 'Unknown network error'
      };
    }
  }

  async uploadSession(sessionId: string, zipPath: string): Promise<boolean> {
    const FormDataConstructor = globalThis.FormData || (global as any).FormData;
    const formData = new FormDataConstructor();

    // In React Native, file objects have { uri, name, type }
    const filePayload = {
      uri: zipPath.startsWith('file://') ? zipPath : `file://${zipPath}`,
      name: `remus-session-${sessionId.slice(0, 8)}.zip`,
      type: 'application/zip'
    };

    formData.append('file', filePayload as any);
    formData.append('sessionId', sessionId);

    const response = await this.fetchFn(`${this.baseUrl}/api/sessions/upload`, {
      method: 'POST',
      body: formData as any
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    return true;
  }

  async syncSessions(input: Array<{ id: string; sampleCount?: number; contextCompleteness?: string }>): Promise<SyncReport> {
    // This backend deduplicates by recording ID, not context revision. Upload only
    // finalized packages so a draft cannot prevent later context from reaching it.
    const sessions = input.filter(s => s.contextCompleteness === 'complete');
    if (!sessions.length) return {syncedCount: 0, skippedCount: input.length, errors: []};
    const sessionIds = sessions.map(s => s.id);
    const checkResult = await this.checkSync(sessionIds);

    if (checkResult.error) {
      return {
        syncedCount: 0,
        skippedCount: 0,
        errors: [{ sessionId: 'all', error: checkResult.error }]
      };
    }

    const requiredSet = new Set(checkResult.requiredSessionIds);
    let syncedCount = 0;
    let skippedCount = input.length - sessions.length;
    const errors: Array<{ sessionId: string; error: string }> = [];

    for (const session of sessions) {
      if (!requiredSet.has(session.id)) {
        skippedCount++;
        continue;
      }

      try {
        const zipPath = await this.bridge.exportSessionZip(session.id);
        await this.uploadSession(session.id, zipPath);
        syncedCount++;
      } catch (e: any) {
        errors.push({
          sessionId: session.id,
          error: e.message || 'Upload error'
        });
      }
    }

    return {
      syncedCount,
      skippedCount,
      errors
    };
  }
}

export const syncService = new SyncService();
