import { NativeModules, NativeEventEmitter } from 'react-native';
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

  constructor() {
    if (RemusTelemetryModule) {
      try {
        this.eventEmitter = new NativeEventEmitter(RemusTelemetryModule);
        this.eventEmitter.addListener(
          'onRemusDeviceTelemetry',
          (event: any) => {
            const raw = typeof event === 'string' ? event : event?.csv;
            if (raw) {
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
