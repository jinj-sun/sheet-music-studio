import { Buffer } from 'node:buffer';
// Node TextEncoder returns Node-realm typed arrays. Use the same constructor in
// jsdom so fflate's binary-vs-directory instanceof check matches a real browser.
globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
