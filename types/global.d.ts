import BlockingQueue from './blockingQueue';
declare namespace globalThis {
    imageQueue: BlockingQueue<{ timestamp: number; sequence: number; data: Buffer}>;
  }