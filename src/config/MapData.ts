export const TILE_SIZE = 32;
export const MAP_COLS = 64;
export const MAP_ROWS = 64;
export const WORLD_WIDTH = MAP_COLS * TILE_SIZE;
export const WORLD_HEIGHT = MAP_ROWS * TILE_SIZE;

// Tile IDs: 0 = floor (passable), 1 = decoration, 2 = wall (blocking)
export const MAP_DATA = new Uint8Array(MAP_COLS * MAP_ROWS);

export function generateTestMap(): void {
  // Fill entire map with floor tiles (0 = passable floor)
  MAP_DATA.fill(0);
  
  // Add border walls
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      if (row === 0 || row === MAP_ROWS - 1 || col === 0 || col === MAP_COLS - 1) {
        MAP_DATA[row * MAP_COLS + col] = 2; // Wall
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

// New helper for continuous collision detection with floating-point positions
export function getTileAtPosition(worldX: number, worldY: number): { col: number; row: number } {
  return {
    col: Math.floor(worldX / TILE_SIZE),
    row: Math.floor(worldY / TILE_SIZE)
  };
}

export function isPositionBlocking(worldX: number, worldY: number): boolean {
  const { col, row } = getTileAtPosition(worldX, worldY);
  return isTileBlocking(col, row);
}
