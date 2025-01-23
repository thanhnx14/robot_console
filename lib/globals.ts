import BlockingQueue from './blockingQueue';

declare namespace globalThis {
   let imageQueue: BlockingQueue<{ timestamp: number; sequence: number; data: Buffer}>;
  }

// Ensure the global variable is initialized only once
if (!globalThis.imageQueue) {
    globalThis.imageQueue = new BlockingQueue<{ timestamp: number; sequence: number; data: Buffer }>(2);
}

export default globalThis.imageQueue;
