export class SparseSet {
  public dense: Uint32Array;
  public sparse: Uint32Array;
  public count: number = 0;

  constructor(maxEntities: number) {
    this.dense = new Uint32Array(maxEntities);
    this.sparse = new Uint32Array(maxEntities);
  }

  public has(id: number): boolean {
    const idx = this.sparse[id];
    return idx < this.count && this.dense[idx] === id;
  }

  public add(id: number): void {
    if (this.has(id)) return;
    this.sparse[id] = this.count;
    this.dense[this.count] = id;
    this.count++;
  }

  public remove(id: number): number {
    if (!this.has(id)) return -1;

    const idx = this.sparse[id];
    const lastIdx = this.count - 1;
    const movedEntityId = this.dense[lastIdx];

    this.dense[idx] = movedEntityId;
    this.sparse[movedEntityId] = idx;

    this.count--;

    return idx === lastIdx ? -1 : movedEntityId;
  }
}
