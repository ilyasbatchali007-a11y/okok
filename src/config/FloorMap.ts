export interface FloorConfig {
  width: number;
  depth: number;
  texturePath: string;
  repeatX: number;
  repeatZ: number;
}

export const ARENA_FLOOR: FloorConfig = {
  width: 32.0,
  depth: 32.0,
  texturePath: 'assets/textures/floor.png',
  repeatX: 8.0,
  repeatZ: 8.0,
};
