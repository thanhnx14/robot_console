import BlockingQueue from './blockingQueue'; // Adjust the path as necessary

export interface ImageItem {
  timestamp: number;
  sequence: number;
  data: Buffer;
}

class ImageQueueSingleton {
  private static  instance: ImageQueueSingleton;
  private imageQueue: BlockingQueue<ImageItem>;
  private constructor() {
    this.imageQueue = new BlockingQueue<ImageItem>(2);
  };

  public static getImageQueue(): BlockingQueue<ImageItem> {
      if (!ImageQueueSingleton.instance)
      {
        ImageQueueSingleton.instance = new  ImageQueueSingleton();
        Object.freeze(ImageQueueSingleton.instance);
      }
      return ImageQueueSingleton.instance.imageQueue;
  };
}

const imageQueue = () => ImageQueueSingleton.getImageQueue();

