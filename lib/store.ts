type Store = {
    [key: string]: string;
  };
  
  const store: Store = {};
  
  export const getStore = () => store;
  