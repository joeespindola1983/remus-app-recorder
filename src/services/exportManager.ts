import { ITelemetryNativeBridge } from './telemetryBridge';

export class ExportManager {
  private bridge: ITelemetryNativeBridge;

  constructor(bridge: ITelemetryNativeBridge) {
    this.bridge = bridge;
  }

  async prepareZipForSharing(sessionId: string): Promise<string> {
    return await this.bridge.exportSessionZip(sessionId);
  }
}
