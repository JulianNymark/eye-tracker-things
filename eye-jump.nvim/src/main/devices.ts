import { getDeviceList } from 'usb';
import { TOBII_VID, TOBII_PIDS } from '../../vendor/tobiifree/src/webusb';
import type { DeviceInfo } from '../shared/model';

export function classifyDevice(vendorId: number, productId: number): DeviceInfo['mode'] {
  if (vendorId === TOBII_VID && productId === 0x0102) return 'bootloader';
  if (vendorId === TOBII_VID && TOBII_PIDS.some(id => id === productId)) return 'runtime';
  return 'unsupported';
}

/** Descriptors only: no opening, claiming, reset, DFU, or firmware writes. */
export function probeDevices(): DeviceInfo[] {
  return getDeviceList().filter(d => d.deviceDescriptor.idVendor === TOBII_VID).map(d => {
    const { idVendor: vendorId, idProduct: productId } = d.deviceDescriptor;
    return { vendorId, productId, mode: classifyDevice(vendorId, productId) };
  });
}

export function requireRuntime(devices: readonly DeviceInfo[]): void {
  if (devices.some(d => d.mode === 'runtime')) return;
  if (devices.some(d => d.mode === 'bootloader')) {
    throw new Error('Tobii detected in bootloader mode (2104:0102). Runtime firmware is not running. Use the official Windows setup first, then reconnect and probe again. This app will not flash firmware.');
  }
  throw new Error('No supported runtime Tobii detected. Check the cable, hub power, and macOS accessory permission.');
}
