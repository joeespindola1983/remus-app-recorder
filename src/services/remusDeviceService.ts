import { NativeModules, NativeEventEmitter } from 'react-native';
import { Buffer } from 'buffer';
import {
  parseRemusDeviceTelemetry,
  RemusDeviceTelemetry,
} from '../contracts/remusDeviceContract';

export type RemusConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected';

export type RemusTelemetryListener = (telemetry: RemusDeviceTelemetry) => void;
export type RemusConnectionListener = (state: RemusConnectionState) => void;
export type RemusFileTransferProgress = (
  percent: number,
  receivedBytes: number,
  totalBytes: number
) => void;

export interface RemusDownloadedFile {
  filename: string;
  data: Buffer;
}

const { RemusTelemetryModule } = NativeModules;

export class RemusDeviceService {
  private connectionState: RemusConnectionState = 'disconnected';
  private connectedDeviceName: string | null = null;
  private latestTelemetry: RemusDeviceTelemetry | null = null;
  private telemetryListeners: Set<RemusTelemetryListener> = new Set();
  private connectionListeners: Set<RemusConnectionListener> = new Set();
  private eventEmitter: NativeEventEmitter | null = null;
  private rawPacketsCount: number = 0;
  private lastRawString: string | null = null;
  private isConnecting: boolean = false;
  private readonly downloadInactivityTimeoutMs = 15_000;
  private activeDownload: {
    filename: string;
    totalBytes: number;
    data: Buffer;
    receivedMask: Uint8Array;
    receivedBytes: number;
    onProgress?: RemusFileTransferProgress;
    resolve: (result: RemusDownloadedFile) => void;
    reject: (error: Error) => void;
    timeout?: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor() {
    if (RemusTelemetryModule) {
      try {
        this.eventEmitter = new NativeEventEmitter(RemusTelemetryModule);
        this.eventEmitter.addListener(
          'onRemusDeviceTelemetry',
          (event: any) => {
            if (typeof event?.rawBase64 === 'string') {
              this.handleIncomingFileChunk(event.rawBase64);
              return;
            }
            const raw = typeof event === 'string' ? event : event?.csv;
            if (raw) {
              if (this.handleFileControlMessage(raw)) {
                return;
              }
              this.handleIncomingRawLine(raw);
            }
          }
        );
        this.eventEmitter.addListener(
          'onRemusDeviceConnectionState',
          (event: { state: RemusConnectionState; name?: string }) => {
            if (event?.state) {
              this.setConnectionState(event.state);
              if (event.name) {
                this.connectedDeviceName = event.name;
              } else if (event.state === 'disconnected') {
                this.connectedDeviceName = null;
              }
            }
          }
        );
      } catch (err) {
        console.error('[RemusDeviceService] Erro ao configurar NativeEventEmitter:', err);
      }
    }
  }

  getNativeDiagnostics() {
    return {
      moduleExists: !!RemusTelemetryModule,
      hasConnectBle: !!(
        RemusTelemetryModule &&
        typeof RemusTelemetryModule.connectRemusBle === 'function'
      ),
      methods: RemusTelemetryModule ? Object.keys(RemusTelemetryModule) : [],
      rawPacketsReceived: this.rawPacketsCount,
      lastRawData: this.lastRawString,
    };
  }

  getConnectionState(): RemusConnectionState {
    return this.connectionState;
  }

  getConnectedDeviceName(): string | null {
    return this.connectedDeviceName;
  }

  getLatestTelemetry(): RemusDeviceTelemetry | null {
    return this.latestTelemetry;
  }

  subscribe(listener: RemusTelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    if (this.latestTelemetry) {
      listener(this.latestTelemetry);
    }
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  subscribeConnection(listener: RemusConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  async ensureConnection(deviceName: string = 'REMUS-ESP32'): Promise<boolean> {
    if (
      this.connectionState === 'connected' ||
      this.connectionState === 'connecting' ||
      this.isConnecting
    ) {
      return true;
    }
    this.isConnecting = true;
    try {
      return await this.connect(deviceName);
    } finally {
      this.isConnecting = false;
    }
  }

  async connect(deviceName: string = 'REMUS-ESP32'): Promise<boolean> {
    this.setConnectionState('scanning');

    if (
      RemusTelemetryModule &&
      typeof RemusTelemetryModule.connectRemusBle === 'function'
    ) {
      try {
        await RemusTelemetryModule.connectRemusBle();
        this.connectedDeviceName = deviceName;
        this.setConnectionState('connected');
        return true;
      } catch (err) {
        console.error('[RemusDeviceService] Erro ao chamar connectRemusBle nativo:', err);
      }
    }

    // Modo simulado / fallback
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.connectedDeviceName = deviceName;
    this.setConnectionState('connected');
    return true;
  }

  disconnect(): void {
    if (
      RemusTelemetryModule &&
      typeof RemusTelemetryModule.disconnectRemusBle === 'function'
    ) {
      RemusTelemetryModule.disconnectRemusBle().catch(() => {});
    }
    this.connectedDeviceName = null;
    this.latestTelemetry = null;
    this.failActiveDownload(new Error('DISCONNECTED'));
    this.setConnectionState('disconnected');
  }

  async sendCommand(command: string): Promise<boolean> {
    if (this.connectionState !== 'connected') {
      return false;
    }
    if (
      RemusTelemetryModule &&
      typeof RemusTelemetryModule.sendRemusBleCommand === 'function'
    ) {
      try {
        await RemusTelemetryModule.sendRemusBleCommand(command);
        return true;
      } catch (err) {
        console.warn('[RemusDeviceService] Erro ao enviar comando BLE:', err);
        return false;
      }
    }
    return false;
  }

  async startWorkout(): Promise<boolean> {
    return this.sendCommand('START\n');
  }

  async stopWorkout(): Promise<boolean> {
    return this.sendCommand('STOP\n');
  }

  async downloadSessionFile(
    arg1?: string | RemusFileTransferProgress,
    arg2?: string | RemusFileTransferProgress
  ): Promise<RemusDownloadedFile> {
    let filename: string | undefined;
    let onProgress: RemusFileTransferProgress | undefined;

    if (typeof arg1 === 'function') {
      onProgress = arg1;
      if (typeof arg2 === 'string') filename = arg2;
    } else if (typeof arg1 === 'string') {
      filename = arg1;
      if (typeof arg2 === 'function') onProgress = arg2;
    } else if (typeof arg2 === 'function') {
      onProgress = arg2;
    }

    if (this.activeDownload) {
      throw new Error('DOWNLOAD_IN_PROGRESS');
    }
    if (this.connectionState !== 'connected') {
      throw new Error('NOT_CONNECTED');
    }

    return new Promise((resolve, reject) => {
      this.activeDownload = {
        filename: filename?.trim() || '',
        totalBytes: 0,
        data: Buffer.alloc(0),
        receivedMask: new Uint8Array(0),
        receivedBytes: 0,
        onProgress,
        resolve,
        reject,
      };
      this.resetDownloadInactivityTimeout();

      const command = filename?.trim() ? `GET ${filename.trim()}` : 'GET';
      this.sendCommand(command).then((accepted) => {
        if (!accepted) this.failActiveDownload(new Error('GET_NOT_ACCEPTED'));
      }).catch((error) => {
        this.failActiveDownload(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async persistDownloadedFile(recordingId: string, file: RemusDownloadedFile): Promise<string> {
    if (!RemusTelemetryModule || typeof RemusTelemetryModule.saveRemusSessionFile !== 'function') {
      throw new Error('NATIVE_FILE_PERSISTENCE_UNAVAILABLE');
    }
    return RemusTelemetryModule.saveRemusSessionFile(
      recordingId,
      file.filename,
      file.data.toString('base64')
    );
  }

  async sendAiding(latitude: number, longitude: number, altitude?: number): Promise<boolean> {
    // A phone coordinate alone is not valid u-blox AssistNow data and can make
    // GPS diagnostics misleading. Keep the API for compatibility, but do not
    // send the retired AID command to the firmware.
    void latitude;
    void longitude;
    void altitude;
    return false;
  }

  handleIncomingRawLine(csvLine: string): void {
    this.rawPacketsCount++;
    this.lastRawString = csvLine;

    const telemetry = parseRemusDeviceTelemetry(csvLine);
    if (telemetry) {
      this.latestTelemetry = telemetry;
      this.telemetryListeners.forEach((listener) => {
        try {
          listener(telemetry);
        } catch (err) {
          console.warn('[RemusDeviceService] Erro no subscriber:', err);
        }
      });
    }
  }

  private resetDownloadInactivityTimeout(): void {
    const download = this.activeDownload;
    if (!download) return;
    if (download.timeout) clearTimeout(download.timeout);
    download.timeout = setTimeout(() => {
      if (this.activeDownload === download) {
        this.activeDownload = null;
        download.reject(new Error('TIMEOUT'));
      }
    }, this.downloadInactivityTimeoutMs);
  }

  private failActiveDownload(error: Error): void {
    const download = this.activeDownload;
    if (!download) return;
    if (download.timeout) clearTimeout(download.timeout);
    this.activeDownload = null;
    download.reject(error);
  }

  private handleFileControlMessage(message: string): boolean {
    if (!this.activeDownload) return false;
    const trimmed = message.trim();

    if (trimmed.startsWith('FILE_START:')) {
      const parts = trimmed.split(':');
      const totalBytes = Number.parseInt(parts[2], 10);
      if (!Number.isFinite(totalBytes) || totalBytes < 4) {
        this.failActiveDownload(new Error('INVALID_FILE_SIZE'));
        return true;
      }
      this.activeDownload.filename = parts[1] || 'remus_session.bin';
      this.activeDownload.totalBytes = totalBytes;
      this.activeDownload.data = Buffer.alloc(totalBytes);
      this.activeDownload.receivedMask = new Uint8Array(totalBytes);
      this.activeDownload.receivedBytes = 0;
      this.resetDownloadInactivityTimeout();
      return true;
    }

    if (trimmed.startsWith('FILE_END:')) {
      const download = this.activeDownload;
      const parts = trimmed.split(':');
      const completedBytes = Number.parseInt(parts[2], 10);
      if (
        !Number.isFinite(completedBytes) ||
        completedBytes !== download.totalBytes ||
        download.receivedBytes !== download.totalBytes
      ) {
        this.failActiveDownload(new Error('INCOMPLETE_TRANSFER'));
        return true;
      }
      const magic = download.data.subarray(0, 4).toString('ascii');
      if (magic !== 'RBP1' && magic !== 'RBP2') {
        this.failActiveDownload(new Error('INVALID_RBP_HEADER'));
        return true;
      }
      const expectedCrc = parts[3]?.trim();
      if (expectedCrc) {
        const actualCrc = this.crc32(download.data).toString(16).padStart(8, '0');
        if (actualCrc.toLowerCase() !== expectedCrc.toLowerCase()) {
          this.failActiveDownload(new Error('CRC_MISMATCH'));
          return true;
        }
      }
      if (download.timeout) clearTimeout(download.timeout);
      this.activeDownload = null;
      download.resolve({ filename: download.filename, data: download.data });
      return true;
    }

    if (trimmed.startsWith('FILE_ERR:')) {
      this.failActiveDownload(new Error(trimmed.substring(9) || 'TRANSFER_FAILED'));
      return true;
    }
    return false;
  }

  private handleIncomingFileChunk(rawBase64: string): void {
    const download = this.activeDownload;
    if (!download || download.totalBytes <= 0) return;
    try {
      const frame = Buffer.from(rawBase64, 'base64');
      if (frame.length < 7 || frame[0] !== 0x20) return;
      const offset = frame.readUInt32LE(1);
      const length = frame.readUInt16LE(5);
      if (length !== frame.length - 7 || offset + length > download.totalBytes) {
        this.failActiveDownload(new Error('INVALID_CHUNK'));
        return;
      }

      frame.copy(download.data, offset, 7);
      for (let index = 0; index < length; index += 1) {
        const target = offset + index;
        if (download.receivedMask[target] === 0) {
          download.receivedMask[target] = 1;
          download.receivedBytes += 1;
        }
      }
      this.resetDownloadInactivityTimeout();
      download.onProgress?.(
        Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100)),
        download.receivedBytes,
        download.totalBytes
      );
    } catch (error) {
      this.failActiveDownload(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (~crc) >>> 0;
  }

  private setConnectionState(newState: RemusConnectionState): void {
    this.connectionState = newState;
    this.connectionListeners.forEach((listener) => {
      try {
        listener(newState);
      } catch (err) {
        console.warn('[RemusDeviceService] Erro no connection listener:', err);
      }
    });
  }
}

export const remusDeviceService = new RemusDeviceService();
