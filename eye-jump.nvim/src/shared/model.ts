import type { DisplayArea } from '../../vendor/tobiifree/src/protocol';
import type { TrackedGazeSample } from './gaze';

export type Point = { x: number; y: number };
/** Rectangle relative to the recorded display; values may extend past its edges. */
export type GazeViewport = { x: number; y: number; width: number; height: number };
export type DeviceInfo = { vendorId: number; productId: number; mode: 'runtime' | 'bootloader' | 'unsupported' };
export type TrackerStatus = {
  state: 'disconnected' | 'connecting' | 'disconnecting' | 'connected' | 'demo' | 'error';
  message: string;
  calibrated: boolean;
};
export type DisplayInfo = {
  id: string;
  name: string;
  width: number;
  height: number;
  scaleFactor: number;
  x?: number;
  y?: number;
  rotation?: number;
};
export type GazeRecord = {
  /** Host monotonic receipt time relative to the capture start marker. */
  tMs: number;
  point: Point | null;
  raw: TrackedGazeSample;
};
export type LiveGaze = { point: Point | null; unfilteredPoint?: Point | null; receivedAtMs: number };
export type Geometry = { widthMm: number; heightMm: number; bottomMm: number; depthMm: number };
export type PanelEstimate = { widthMm: number; heightMm: number; source: string };
export type TrackerAlignment = { left: number; right: number };
export type SavedCalibration = { display: DisplayInfo; geometry: Geometry; savedAt: string };
export type Microphone = { deviceId: string; label: string };
export type RecordingConsent = { screen: boolean; microphone: boolean; eyeTracking: boolean; camera: boolean };
export type RecordingSynchronization = { method: 'monotonic-recorder-start'; screenStartMs?: number; cameraStartMs?: number; uncertaintyMs: number };
export type RecordingProcessing = { state: 'processing' | 'ready' | 'error'; progress: number | null; error?: string; diagnosticFile?: string };
export type RecordingFolder = { path: string; token: string; error: string | null; defaultPath?: string };
export type DesktopTrailStatus = { enabled: boolean; visible: boolean; displayId: string | null };
export type DesktopTrailFrame = { samples: Array<{ tMs: number; point: Point | null }>; timeMs: number; fadeMs: number; demo: boolean };
export type DesktopTrailBridge = { ready(): Promise<DesktopTrailFrame>; onFrame(listener: (frame: DesktopTrailFrame) => void): () => void };
export type SessionManifest = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  source: 'tobii' | 'demo';
  status: 'recording' | 'complete' | 'interrupted';
  display: DisplayInfo;
  displayArea: DisplayArea | null;
  mimeType: string;
  timing: 'host-monotonic-receipt/mediarecorder-start-ipc';
  synchronization?: RecordingSynchronization;
  durationMs: number;
  sampleCount: number;
  calibrationApplied: boolean;
  /** Measured native gaze-overlay content bounds relative to the recorded display. */
  gazeViewport?: GazeViewport;
  /** Missing on older screen-only recordings. */
  audio?: { source: 'microphone'; label: string } | null;
  consent?: RecordingConsent;
  camera?: { label: string; mimeType: string } | null;
  title?: string;
  sizeBytes?: number;
  thumbnailUrl?: string;
  thumbnailVersion?: number;
  /** Snapshot-only: a derivative could not be generated; raw media is untouched. */
  thumbnailError?: string;
  processing?: RecordingProcessing;
};
export type Snapshot = {
  tracker: TrackerStatus;
  displays: DisplayInfo[];
  sessions: SessionManifest[];
  screenPermission: string;
  recording: boolean;
  savedCalibration: SavedCalibration | null;
  hasSavedCalibration: boolean;
  appliedGeometry: Geometry | null;
  calibratedDisplayId: string | null;
  folder: RecordingFolder;
  desktopTrail: DesktopTrailStatus;
};
export type Playback = { manifest: SessionManifest; gaze: GazeRecord[]; videoUrl: string; cameraUrl?: string; processedUrl?: string; processedTimelineStartMs?: number; processedStale?: boolean };

export type Commands = {
  snapshot: { args: undefined; result: Snapshot };
  probe: { args: undefined; result: DeviceInfo[] };
  connect: { args: { demo: boolean }; result: TrackerStatus };
  disconnect: { args: undefined; result: void };
  geometry: { args: Geometry; result: void };
  panelEstimate: { args: { displayId: string }; result: PanelEstimate | null };
  positionStart: { args: { displayId: string; geometry: Geometry }; result: TrackerAlignment | null };
  positionClose: { args: undefined; result: void };
  calibrationStart: { args: { displayId: string; geometry?: Geometry; points: 5 | 9 }; result: GazeViewport };
  calibrationPoint: { args: Point; result: void };
  calibrationFinish: { args: undefined; result: { remembered: boolean } };
  calibrationCancel: { args: undefined; result: void };
  captureSelect: { args: { displayId: string; geometry?: Geometry; folderToken: string; microphoneId?: string; cameraId?: string; consent: RecordingConsent }; result: void };
  captureCancel: { args: undefined; result: void };
  recordingStart: { args: { displayId: string; mimeType: string; folderToken: string; microphone?: Microphone; camera?: Microphone & { mimeType: string }; consent: RecordingConsent }; result: SessionManifest };
  recordingClock: { args: { id: string }; result: { elapsedMs: number } };
  recordingTiming: { args: { id: string; synchronization: RecordingSynchronization }; result: void };
  recordingChunk: { args: { id: string; bytes: Uint8Array; kind?: 'screen' | 'camera' }; result: void };
  recordingStop: { args: { id: string; interrupted: boolean }; result: SessionManifest };
  playback: { args: { id: string; folderToken: string }; result: Playback };
  playbackClose: { args: undefined; result: void };
  folderChoose: { args: undefined; result: boolean };
  folderDefault: { args: undefined; result: void };
  folderOpen: { args: undefined; result: void };
  recordingReveal: { args: { id: string; folderToken: string }; result: void };
  recordingRename: { args: { id: string; folderToken: string; title: string }; result: void };
  recordingThumbnail: { args: { id: string; folderToken: string; bytes: Uint8Array; version?: number }; result: void };
  recordingThumbnailGenerate: { args: { id: string; folderToken: string }; result: void };
  recordingProcess: { args: { id: string; folderToken: string }; result: void };
  recordingTrash: { args: { id: string; folderToken: string }; result: boolean };
  desktopTrailSet: { args: { enabled: boolean; displayId?: string; geometry?: Geometry; fadeMs?: number }; result: void };
  desktopTrailFade: { args: { fadeMs: number }; result: void };
  desktopTrailSmooth: { args: { smooth: boolean }; result: void };
};
export type Command = keyof Commands;
export type Bridge = {
  invoke<K extends Command>(command: K, args: Commands[K]['args']): Promise<Commands[K]['result']>;
  onGaze(listener: (sample: LiveGaze) => void): () => void;
};
