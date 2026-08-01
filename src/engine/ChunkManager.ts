// SRC/engine/ChunkManager.ts
// GPU chunk management for isometric tilemap rendering
// 
// Divides the tilemap into 32x32 spatial sub-grids (chunks)
// kept resident on GPU buffers to avoid re-uploading entire tile buffers every frame.
// Uses gl.bufferSubData for partial updates and frustum culling at chunk level.

import { TILE_SIZE, MAP_COLS, MAP_ROWS } from '../config/MapData';

export const CHUNK_SIZE = 32;
export const CHUNK_WIDTH = CHUNK_SIZE;
export const CHUNK_HEIGHT = CHUNK_SIZE;

export interface IChunk {
  chunkX: number;
  chunkY: number;
  tileStartX: number;
  tileStartY: number;
  tileEndX: number;
  tileEndY: number;
  isVisible: boolean;
  needsUpdate: boolean;
  instanceCount: number;
  gpuBuffer?: WebGLBuffer;
  instanceData: Float32Array;
}

export class ChunkManager {
  private chunks: Map<string, IChunk> = new Map();
  private gl: WebGL2RenderingContext;
  private mapWidth: number;
  private mapHeight: number;
  private chunkSize: number;
  
  // Max instances per chunk (worst case: all tiles visible)
  private maxInstancesPerChunk: number;

  constructor(
    gl: WebGL2RenderingContext,
    mapWidth: number = MAP_COLS,
    mapHeight: number = MAP_ROWS,
    chunkSize: number = CHUNK_SIZE
  ) {
    this.gl = gl;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.chunkSize = chunkSize;
    this.maxInstancesPerChunk = chunkSize * chunkSize;
    
    this.initializeChunks();
  }

  /**
   * Initialize all chunks for the map
   */
  private initializeChunks(): void {
    const numChunksX = Math.ceil(this.mapWidth / this.chunkSize);
    const numChunksY = Math.ceil(this.mapHeight / this.chunkSize);

    for (let cy = 0; cy < numChunksY; cy++) {
      for (let cx = 0; cx < numChunksX; cx++) {
        const tileStartX = cx * this.chunkSize;
        const tileStartY = cy * this.chunkSize;
        const tileEndX = Math.min(tileStartX + this.chunkSize, this.mapWidth);
        const tileEndY = Math.min(tileStartY + this.chunkSize, this.mapHeight);

        const chunkKey = this.getChunkKey(cx, cy);
        
        const chunk: IChunk = {
          chunkX: cx,
          chunkY: cy,
          tileStartX,
          tileStartY,
          tileEndX,
          tileEndY,
          isVisible: false,
          needsUpdate: true,
          instanceCount: 0,
          instanceData: new Float32Array(this.maxInstancesPerChunk * 4) // x, y, sizeX, sizeY
        };

        this.chunks.set(chunkKey, chunk);
      }
    }
  }

  /**
   * Generate unique key for chunk lookup
   */
  private getChunkKey(chunkX: number, chunkY: number): string {
    return `${chunkX},${chunkY}`;
  }

  /**
   * Get chunk by coordinates
   */
  public getChunk(chunkX: number, chunkY: number): IChunk | undefined {
    return this.chunks.get(this.getChunkKey(chunkX, chunkY));
  }

  /**
   * Update chunk data from tile data
   */
  public updateChunk(
    chunk: IChunk,
    tileDataGetter: (col: number, row: number) => { tileId: number; passable: boolean } | null
  ): void {
    if (!chunk.needsUpdate) return;

    let offset = 0;
    let instanceCount = 0;

    for (let row = chunk.tileStartY; row < chunk.tileEndY; row++) {
      for (let col = chunk.tileStartX; col < chunk.tileEndX; col++) {
        const tileInfo = tileDataGetter(col, row);
        
        if (!tileInfo || tileInfo.tileId === 0) {
          continue; // Skip empty/blocked tiles
        }

        // Store instance data: x, y, sizeX, sizeY
        // Note: Actual screen positions will be calculated in shader or during render
        chunk.instanceData[offset++] = col * TILE_SIZE;
        chunk.instanceData[offset++] = row * TILE_SIZE;
        chunk.instanceData[offset++] = TILE_SIZE;
        chunk.instanceData[offset++] = TILE_SIZE;
        
        instanceCount++;
      }
    }

    chunk.instanceCount = instanceCount;
    chunk.needsUpdate = false;
  }

  /**
   * Upload chunk data to GPU buffer
   */
  public uploadChunkToGPU(chunk: IChunk): void {
    if (!chunk.gpuBuffer) {
      chunk.gpuBuffer = this.gl.createBuffer();
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, chunk.gpuBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      chunk.instanceData.byteLength,
      this.gl.DYNAMIC_DRAW
    );
    
    // Initial upload
    this.gl.bufferSubData(
      this.gl.ARRAY_BUFFER,
      0,
      chunk.instanceData.subarray(0, chunk.instanceCount * 4)
    );

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
  }

  /**
   * Partial update of chunk GPU buffer (only changed instances)
   */
  public updateChunkGPU(chunk: IChunk, startInstance: number, count: number): void {
    if (!chunk.gpuBuffer) return;

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, chunk.gpuBuffer);
    this.gl.bufferSubData(
      this.gl.ARRAY_BUFFER,
      startInstance * 16, // 4 floats * 4 bytes
      chunk.instanceData.subarray(startInstance * 4, (startInstance + count) * 4)
    );
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
  }

  /**
   * Frustum culling: determine which chunks are visible from camera position
   */
  public cullVisibleChunks(
    cameraX: number,
    cameraY: number,
    viewportWidth: number,
    viewportHeight: number
  ): IChunk[] {
    const visibleChunks: IChunk[] = [];

    // Calculate visible tile range from camera position with 1-chunk padding border
    // This prevents visual pop-in during fast panning/zooming by keeping extra chunks active
    const padding = TILE_SIZE * 2 + CHUNK_SIZE; // Extra padding for isometric projection + 1 chunk border
    const minTileX = Math.floor((cameraX - padding) / TILE_SIZE);
    const minTileY = Math.floor((cameraY - padding) / TILE_SIZE);
    const maxTileX = Math.ceil((cameraX + viewportWidth + padding) / TILE_SIZE);
    const maxTileY = Math.ceil((cameraY + viewportHeight + padding) / TILE_SIZE);

    // Convert to chunk coordinates
    const minChunkX = Math.max(0, Math.floor(minTileX / this.chunkSize));
    const minChunkY = Math.max(0, Math.floor(minTileY / this.chunkSize));
    const maxChunkX = Math.min(
      Math.ceil(this.mapWidth / this.chunkSize) - 1,
      Math.floor(maxTileX / this.chunkSize)
    );
    const maxChunkY = Math.min(
      Math.ceil(this.mapHeight / this.chunkSize) - 1,
      Math.floor(maxTileY / this.chunkSize)
    );

    // Mark visible chunks
    for (let cy = minChunkY; cy <= maxChunkY; cy++) {
      for (let cx = minChunkX; cx <= maxChunkX; cx++) {
        const chunk = this.getChunk(cx, cy);
        if (chunk) {
          chunk.isVisible = true;
          visibleChunks.push(chunk);
        }
      }
    }

    // Mark non-visible chunks
    for (const chunk of this.chunks.values()) {
      if (!visibleChunks.includes(chunk)) {
        chunk.isVisible = false;
      }
    }

    return visibleChunks;
  }

  /**
   * Get all visible chunks for rendering
   */
  public getVisibleChunks(): IChunk[] {
    const visible: IChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.isVisible) {
        visible.push(chunk);
      }
    }
    return visible;
  }

  /**
   * Mark a specific tile region as needing update (for dynamic terrain)
   */
  public markTileRangeDirty(minCol: number, minRow: number, maxCol: number, maxRow: number): void {
    const minChunkX = Math.floor(minCol / this.chunkSize);
    const minChunkY = Math.floor(minRow / this.chunkSize);
    const maxChunkX = Math.floor(maxCol / this.chunkSize);
    const maxChunkY = Math.floor(maxRow / this.chunkSize);

    for (let cy = minChunkY; cy <= maxChunkY; cy++) {
      for (let cx = minChunkX; cx <= maxChunkX; cx++) {
        const chunk = this.getChunk(cx, cy);
        if (chunk) {
          chunk.needsUpdate = true;
        }
      }
    }
  }

  /**
   * Mark single tile as dirty
   */
  public markTileDirty(col: number, row: number): void {
    const chunkX = Math.floor(col / this.chunkSize);
    const chunkY = Math.floor(row / this.chunkSize);
    const chunk = this.getChunk(chunkX, chunkY);
    if (chunk) {
      chunk.needsUpdate = true;
    }
  }

  /**
   * Get statistics for debugging/profiling
   */
  public getStats(): {
    totalChunks: number;
    visibleChunks: number;
    totalInstances: number;
    visibleInstances: number;
  } {
    let visibleChunks = 0;
    let totalInstances = 0;
    let visibleInstances = 0;

    for (const chunk of this.chunks.values()) {
      totalInstances += chunk.instanceCount;
      if (chunk.isVisible) {
        visibleChunks++;
        visibleInstances += chunk.instanceCount;
      }
    }

    return {
      totalChunks: this.chunks.size,
      visibleChunks,
      totalInstances,
      visibleInstances
    };
  }

  /**
   * Cleanup GPU resources
   */
  public dispose(): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.gpuBuffer) {
        this.gl.deleteBuffer(chunk.gpuBuffer);
        chunk.gpuBuffer = undefined;
      }
    }
    this.chunks.clear();
  }
}

/**
 * Helper to calculate how many chunks fit in viewport
 */
export function calculateVisibleChunkCount(
  viewportWidth: number,
  viewportHeight: number,
  chunkSize: number = CHUNK_SIZE,
  tileSize: number = TILE_SIZE
): number {
  const tilesWide = Math.ceil(viewportWidth / tileSize);
  const tilesHigh = Math.ceil(viewportHeight / tileSize);
  const chunksWide = Math.ceil(tilesWide / chunkSize) + 2; // +2 for padding
  const chunksHigh = Math.ceil(tilesHigh / chunkSize) + 2;
  
  return chunksWide * chunksHigh;
}
