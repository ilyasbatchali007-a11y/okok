export const TILE_SIZE = 64;
export const MAP_COLS = 32;
export const MAP_ROWS = 32;
export const WORLD_WIDTH = MAP_COLS * TILE_SIZE;
export const WORLD_HEIGHT = MAP_ROWS * TILE_SIZE;

export const MAP_DATA = new Uint8Array(MAP_COLS * MAP_ROWS);

export function generateTestMap(): void {
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const idx = row * MAP_COLS + col;
      if (row === 0 || row === MAP_ROWS - 1 || col === 0 || col === MAP_COLS - 1) {
        MAP_DATA[idx] = 2;
      } else if (row > MAP_ROWS * 0.4 && row < MAP_ROWS * 0.6) {
        MAP_DATA[idx] = 1;
      } else {
        MAP_DATA[idx] = 0;
      }
    }
  }
}

export function isTileBlocking(col: number, row: number): boolean {
  if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) {
    return true;
  }
  return MAP_DATA[row * MAP_COLS + col] === 2;
}
