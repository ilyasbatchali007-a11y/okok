// SRC/render/MapRenderer.ts

import { MAP_DATA, MAP_COLS, MAP_ROWS, TILE_SIZE } from '../config/MapData';

export class MapRenderer {
  private instanceBuffer: Float32Array = new Float32Array(30000);

  public getVisibleTileData(
    cameraX: number,
    cameraY: number,
    viewportWidth: number,
    viewportHeight: number
  ): { buffer: Float32Array; count: number } {
    let ptr = 0;

    // Isometric diamond dimensions (half width / half height)
    const halfWidth = TILE_SIZE / 2;
    const halfHeight = TILE_SIZE / 4; // 2:1 isometric ratio

    // Offset map origin so it centers nicely on screen
    const offsetX = viewportWidth / 2;
    const offsetY = 100; // Padding from top

    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const tileId = MAP_DATA[row * MAP_COLS + col];
        if (tileId === 0) continue;

        // 💡 2.5D ISOMETRIC TRANSFORMATION
        const isoX = (col - row) * halfWidth + offsetX - cameraX;
        const isoY = (col + row) * halfHeight + offsetY - cameraY;

        // Simple frustum culling (skip tiles outside viewport)
        if (
          isoX + TILE_SIZE < 0 ||
          isoX - TILE_SIZE > viewportWidth ||
          isoY + TILE_SIZE < 0 ||
          isoY - TILE_SIZE > viewportHeight
        ) {
          continue;
        }

        this.instanceBuffer[ptr++] = isoX;
        this.instanceBuffer[ptr++] = isoY;
        this.instanceBuffer[ptr++] = tileId;
      }
    }

    return { buffer: this.instanceBuffer, count: ptr / 3 };
  }
}