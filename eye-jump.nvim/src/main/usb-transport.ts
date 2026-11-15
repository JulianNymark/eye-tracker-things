import { getDeviceList, WebUSBDevice, usb } from 'usb';
import type { InEndpoint } from 'usb';
import { WebUsbTransport } from '../../vendor/tobiifree/src/webusb';
import type { Transport } from '../../vendor/tobiifree/src/transport';
import { classifyDevice, probeDevices, requireRuntime } from './devices';

/** Keep upstream framing/session commands; make Node's bulk reads cancellable. */
export class CancellableUsbTransport implements Transport {
  private stop = new AbortController();
  private pump: Promise<void> | null = null;
  private closing: Promise<void> | null = null;

  constructor(private transport: Transport, private endpoint: Pick<InEndpoint, 'makeTransfer'>, readonly identity: string | null = null) {}

  async send(bytes: Uint8Array): Promise<void> {
    if (this.stop.signal.aborted) throw new Error('USB transport is closed.');
    await this.transport.send(bytes);
  }

  recv(signal: AbortSignal, onChunk: (chunk: Uint8Array) => void): Promise<void> {
    if (this.pump) throw new Error('USB receive pump already started.');
    const combined = AbortSignal.any([signal, this.stop.signal]);
    this.pump = this.receive(combined, onChunk);
    return this.pump;
  }

  private async receive(signal: AbortSignal, onChunk: (chunk: Uint8Array) => void): Promise<void> {
    while (!signal.aborted) {
      try {
        const chunk = await this.read(signal);
        if (!signal.aborted && chunk.byteLength) onChunk(chunk);
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    }
  }

  private read(signal: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      // Unlike WebUSB.transferIn, node-usb's public Transfer API exposes cancel.
      // A finite timeout also bounds shutdown if native cancellation fails.
      const transfer = this.endpoint.makeTransfer(1000, (error, buffer, actual) => {
        signal.removeEventListener('abort', cancel);
        if (error && error.errno !== usb.LIBUSB_TRANSFER_TIMED_OUT) reject(error);
        else resolve(buffer.subarray(0, actual));
      });
      const cancel = (): void => {
        try { transfer.cancel(); } catch { /* Wait for completion/timeout before releasing USB. */ }
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        transfer.submit(Buffer.alloc(16384)); // Same read size as the pinned SDK.
        if (signal.aborted) cancel();
      } catch (error) {
        signal.removeEventListener('abort', cancel);
        reject(error);
      }
    });
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    this.stop.abort();
    await this.pump?.catch(() => undefined);
    await this.transport.close();
  }
}

export async function openRuntimeTransport(): Promise<CancellableUsbTransport> {
  requireRuntime(probeDevices());
  const native = getDeviceList().find(device => classifyDevice(device.deviceDescriptor.idVendor, device.deviceDescriptor.idProduct) === 'runtime');
  if (!native) throw new Error('Runtime tracker disappeared before opening USB.');
  const device = await WebUSBDevice.createInstance(native);
  let transport: WebUsbTransport | null = null;
  try {
    transport = await WebUsbTransport.fromDevice(device);
    const endpoint = native.interface(0).endpoint(0x83);
    if (!endpoint || endpoint.direction !== 'in') throw new Error('Tracker bulk IN endpoint is unavailable.');
    const serial = device.serialNumber?.trim();
    const identity = serial ? `${device.vendorId}:${device.productId}:${serial}` : null;
    return new CancellableUsbTransport(transport, endpoint as InEndpoint, identity);
  } catch (error) {
    if (transport) await transport.close();
    else await device.close().catch(() => undefined);
    throw error;
  }
}
