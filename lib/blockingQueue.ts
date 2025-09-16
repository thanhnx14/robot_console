class BlockingQueue<T> {
  private queue: T[] = [];
  private maxSize: number;
  private waiting: Array<(value: T | null) => void> = [];
  private objectMap = new WeakMap();

  constructor(maxSize: number) {
    console.log('constructor BlockingQueue');
    this.maxSize = maxSize;
    this.objectMap.set(this.queue, Date.now());
  }

  async enqueue(item: T) {
    if (this.queue.length >= this.maxSize) {
      // If the queue is full, replace the oldest item with the new one
      this.queue.shift();
      // console.log('Queue full, removing the oldest item');
    }
    // console.log('enqueue stored:', this.objectMap.get(this.queue));
    this.queue.push(item);
    // console.log('Item enqueued', item);
    this.notify();
  }

  async dequeue(): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      if (this.queue.length === 0) {
        // console.log('Queue empty, waiting for item');
        // console.log('dequeue stored:', this.objectMap.get(this.queue));
        this.waiting.push(resolve);
      } else {
        const item = this.queue.shift() || null;
        // console.log('Item dequeued', item);
        resolve(item);
      }
    });
  }

  getSize(): number {
    return this.queue.length;
  }

  private notify() {
    // console.log('Notify called, waiting length:', this.waiting.length);
    while (this.waiting.length > 0 && this.queue.length > 0) {
      
      const item = this.queue.shift() || null;
      this.waiting.forEach((waiter, index , obj) => {
        if (waiter) {
          // console.log('Resolving a waiting promise');
          waiter(item);
        }
        
      });
      this.queue = [];
    }
  }
}

export default BlockingQueue;
