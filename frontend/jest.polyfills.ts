// Polyfills for MSW v2 in jest-environment-jsdom.
// Must run before any test module is imported (loaded via `setupFiles`).

const { TextDecoder, TextEncoder } = require("util");
const { ReadableStream, WritableStream, TransformStream } = require("stream/web");
const { MessageChannel, MessagePort } = require("worker_threads");

Object.assign(global, {
  TextDecoder,
  TextEncoder,
  ReadableStream,
  WritableStream,
  TransformStream,
  MessageChannel,
  MessagePort,
});

// BroadcastChannel stub (not provided by jest-environment-jsdom)
if (typeof global.BroadcastChannel === "undefined") {
  (global as any).BroadcastChannel = class BroadcastChannel {
    name: string;
    onmessage: null = null;
    onmessageerror: null = null;
    constructor(name: string) { this.name = name; }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
  };
}

// Use undici for a full Fetch API with proper ReadableStream bodies
const { fetch, Headers, Request, Response } = require("undici");
Object.assign(global, { fetch, Headers, Request, Response });
