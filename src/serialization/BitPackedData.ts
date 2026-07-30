// SRC/serialization/BitPackedData.ts
// Bit-packed tile data storage using Uint32Array
// 
// Layout (32 bits per tile):
// [31:24] Animation Frame (8 bits)
// [23:16] Collision/Passable Flags (8 bits)
// [15:14] Rotation (2 bits)
// [13:10] Elevation Height (4 bits)
// [9:0]   Tile ID (10 bits)

export const TILE_ID_BITS = 10;
export const TILE_ID_MASK = 0x3FF; // 10 bits: 0-1023

export const ELEVATION_BITS = 4;
export const ELEVATION_MASK = 0xF; // 4 bits: 0-15

export const ROTATION_BITS = 2;
export const ROTATION_MASK = 0x3; // 2 bits: 0-3

export const COLLISION_BITS = 8;
export const COLLISION_MASK = 0xFF; // 8 bits: 0-255

export const ANIMATION_BITS = 8;
export const ANIMATION_MASK = 0xFF; // 8 bits: 0-255

// Bit shift positions
export const TILE_ID_SHIFT = 0;
export const ELEVATION_SHIFT = TILE_ID_BITS;
export const ROTATION_SHIFT = TILE_ID_BITS + ELEVATION_BITS;
export const COLLISION_SHIFT = TILE_ID_BITS + ELEVATION_BITS + ROTATION_BITS;
export const ANIMATION_SHIFT = TILE_ID_BITS + ELEVATION_BITS + ROTATION_BITS + COLLISION_BITS;

// Collision flags
export const COLLISION_FLAG_NORTH = 0x01;
export const COLLISION_FLAG_EAST = 0x02;
export const COLLISION_FLAG_SOUTH = 0x04;
export const COLLISION_FLAG_WEST = 0x08;
export const COLLISION_FLAG_PASSABLE = 0x10;
export const COLLISION_FLAG_CLIMBABLE = 0x20;
export const COLLISION_FLAG_WATER = 0x40;
export const COLLISION_FLAG_SOLID = 0x80;

export class BitPackedData {
  private data: Uint32Array;
  public readonly width: number;
  public readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint32Array(width * height);
  }

  /**
   * Pack tile data into a single 32-bit integer
   */
  public setTile(
    col: number,
    row: number,
    tileId: number,
    elevation: number = 0,
    rotation: number = 0,
    collisionFlags: number = 0,
    animationFrame: number = 0
  ): void {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return;
    }

    const idx = row * this.width + col;

    // Clamp values to their bit ranges
    const packedTileId = tileId & TILE_ID_MASK;
    const packedElevation = elevation & ELEVATION_MASK;
    const packedRotation = rotation & ROTATION_MASK;
    const packedCollision = collisionFlags & COLLISION_MASK;
    const packedAnimation = animationFrame & ANIMATION_MASK;

    // Pack all fields into a single 32-bit integer
    this.data[idx] =
      (packedAnimation << ANIMATION_SHIFT) |
      (packedCollision << COLLISION_SHIFT) |
      (packedRotation << ROTATION_SHIFT) |
      (packedElevation << ELEVATION_SHIFT) |
      (packedTileId << TILE_ID_SHIFT);
  }

  /**
   * Get tile ID from packed data
   */
  public getTileId(col: number, row: number): number {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0;
    }
    const idx = row * this.width + col;
    return (this.data[idx] >>> TILE_ID_SHIFT) & TILE_ID_MASK;
  }

  /**
   * Get elevation from packed data
   */
  public getElevation(col: number, row: number): number {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0;
    }
    const idx = row * this.width + col;
    return (this.data[idx] >>> ELEVATION_SHIFT) & ELEVATION_MASK;
  }

  /**
   * Get rotation from packed data
   */
  public getRotation(col: number, row: number): number {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0;
    }
    const idx = row * this.width + col;
    return (this.data[idx] >>> ROTATION_SHIFT) & ROTATION_MASK;
  }

  /**
   * Get collision flags from packed data
   */
  public getCollisionFlags(col: number, row: number): number {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0;
    }
    const idx = row * this.width + col;
    return (this.data[idx] >>> COLLISION_SHIFT) & COLLISION_MASK;
  }

  /**
   * Get animation frame from packed data
   */
  public getAnimationFrame(col: number, row: number): number {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0;
    }
    const idx = row * this.width + col;
    return (this.data[idx] >>> ANIMATION_SHIFT) & ANIMATION_MASK;
  }

  /**
   * Check if tile is passable
   */
  public isPassable(col: number, row: number): boolean {
    const flags = this.getCollisionFlags(col, row);
    return (flags & COLLISION_FLAG_SOLID) === 0 && (flags & COLLISION_FLAG_PASSABLE) !== 0;
  }

  /**
   * Check if tile is solid (blocking)
   */
  public isSolid(col: number, row: number): boolean {
    const flags = this.getCollisionFlags(col, row);
    return (flags & COLLISION_FLAG_SOLID) !== 0;
  }

  /**
   * Update animation frame
   */
  public setAnimationFrame(col: number, row: number, frame: number): void {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return;
    }
    const idx = row * this.width + col;
    const current = this.data[idx];
    const packedFrame = frame & ANIMATION_MASK;
    this.data[idx] = (current & ~(ANIMATION_MASK << ANIMATION_SHIFT)) | (packedFrame << ANIMATION_SHIFT);
  }

  /**
   * Get raw packed value for direct access
   */
  public getPackedValue(col: number, row: number): number {
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0;
    }
    return this.data[row * this.width + col];
  }

  /**
   * Get the underlying Uint32Array for GPU upload
   */
  public getData(): Uint32Array {
    return this.data;
  }

  /**
   * Serialize to ArrayBuffer
   */
  public serialize(): ArrayBuffer {
    return this.data.buffer.slice(0, this.data.byteLength) as ArrayBuffer;
  }

  /**
   * Deserialize from ArrayBuffer
   */
  public deserialize(buffer: ArrayBuffer): void {
    if (buffer.byteLength !== this.data.byteLength) {
      throw new Error('Buffer size mismatch');
    }
    this.data.set(new Uint32Array(buffer));
  }

  /**
   * Clear all tile data
   */
  public clear(): void {
    this.data.fill(0);
  }
}

/**
 * Create a BitPackedData instance from legacy Uint8Array
 */
export function migrateFromUint8Array(legacyData: Uint8Array, width: number, height: number): BitPackedData {
  const packed = new BitPackedData(width, height);
  
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      const legacyValue = legacyData[idx] || 0;
      
      // Migrate: legacy value becomes tileId, default passable for non-zero
      const collisionFlags = legacyValue !== 0 ? COLLISION_FLAG_PASSABLE : 0;
      packed.setTile(col, row, legacyValue, 0, 0, collisionFlags, 0);
    }
  }
  
  return packed;
}
