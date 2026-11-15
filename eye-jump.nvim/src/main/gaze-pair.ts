import type { GazeSample, RawGazeColumn } from '../../vendor/tobiifree/src/protocol';
import type { TrackedGazeSample } from '../shared/gaze';

/** The SDK emits curated gaze before raw columns for the same frame, synchronously. */
export class GazePair {
  private pending: TrackedGazeSample | null = null;
  constructor(private emit: (sample: TrackedGazeSample) => void) {}

  gaze(sample: GazeSample): void {
    this.flush();
    const pending = structuredClone(sample);
    this.pending = pending;
    queueMicrotask(() => { if (this.pending === pending) this.flush(); });
  }

  columns(columns: RawGazeColumn[]): void {
    if (!this.pending) return;
    const validity = columns.find(column => column.colId === 0x21 && column.kind === 'u32');
    if (validity) this.pending.gaze_2d_unfiltered_valid = validity.v0 === 1;
    this.flush();
  }

  flush(): void {
    const sample = this.pending;
    this.pending = null;
    if (sample) this.emit(sample);
  }
}
