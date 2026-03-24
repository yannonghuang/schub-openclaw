// types/vis-network.d.ts
declare module "vis-network" {
  export class Network {
    constructor(container: HTMLElement, data: any, options?: any);
    setData(data: any): void;
  }

  export class DataSet<T = any> {
    constructor(items?: T[]);
    add(item: T | T[]): void;
    get(id: any): T;
    get(): T[];
  }
}
