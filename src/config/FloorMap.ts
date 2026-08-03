export interface FloorConfig {
  width: number;
  depth: number;
  texturePath: string;
  repeatX: number;
  repeatZ: number;
}

// Floor dimensions match the world size (64 tiles x 32px = 2048px)
export const ARENA_FLOOR: FloorConfig = {
  width: 2048.0,
  depth: 2048.0,
  texturePath: 'assets/textures/floor.png',
  repeatX: 64.0,
  repeatZ: 64.0,
};
