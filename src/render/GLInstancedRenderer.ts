import { World } from '../ecs/World';
import { TILE_SIZE } from '../config/MapData';

// Isometric projection constants
const ISO_ANGLE = Math.atan(0.5); // ~26.565 degrees for classic isometric
const COS_ISO = Math.cos(ISO_ANGLE);
const SIN_ISO = Math.sin(ISO_ANGLE);

// Vertex Shader Source with unified isometric transformation
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_quadPos; // Unit quad vertex position [0..1]
layout(location = 1) in vec2 a_pos;     // Entity position (px, py)
layout(location = 2) in vec2 a_size;    // Entity size (width, height)

uniform mat4 u_projection;   // Orthographic projection matrix
uniform mat4 u_isoMatrix;    // Isometric transformation matrix
uniform vec2 u_cameraOffset; // Camera scroll offset

out vec2 v_uv;

void main() {
  // Calculate world position from instance data
  vec2 worldPos = a_pos + (a_quadPos * a_size);
  
  // Apply isometric transformation in the shader (unified approach)
  // This transforms Cartesian coordinates to isometric view
  vec4 isoPos = u_isoMatrix * vec4(worldPos, 0.0, 1.0);
  
  // Apply camera offset
  vec2 screenPos = isoPos.xy - u_cameraOffset;
  
  // Apply orthographic projection to convert to clip space
  vec4 projected = u_projection * vec4(screenPos, 0.0, 1.0);
  
  gl_Position = projected;
  v_uv = a_quadPos;
}
`;

// Fragment Shader Source
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
  fragColor = texture(u_texture, v_uv);
}
`;

export class GLInstancedRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;

  private instanceData: Float32Array;
  private projectionLoc: WebGLUniformLocation | null;
  private isoMatrixLoc: WebGLUniformLocation | null;
  private cameraOffsetLoc: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext, maxEntities: number) {
    this.gl = gl;
    // 4 floats per instance: px, py, width, height
    this.instanceData = new Float32Array(maxEntities * 4);

    const vs = this.createShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this.createShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    this.program = this.createProgram(vs, fs);

    this.projectionLoc = gl.getUniformLocation(this.program, 'u_projection');
    this.isoMatrixLoc = gl.getUniformLocation(this.program, 'u_isoMatrix');
    this.cameraOffsetLoc = gl.getUniformLocation(this.program, 'u_cameraOffset');

    // Create & setup VAO
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(this.vao);

    // 1. Static Quad Vertex Buffer (4 vertices for a unit square)
    const quadVertices = new Float32Array([
      0, 0,  // Bottom-left
      1, 0,  // Bottom-right
      1, 1,  // Top-right
      0, 1,  // Top-left
    ]);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 2. Index Buffer (6 indices for 2 triangles forming a quad)
    const quadIndices = new Uint16Array([
      0, 1, 2,  // First triangle
      0, 2, 3,  // Second triangle
    ]);
    const idxBuffer = gl.createBuffer();
    if (!idxBuffer) throw new Error('Failed to create index buffer');
    this.indexBuffer = idxBuffer;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices, gl.STATIC_DRAW);

    // 3. Dynamic Instance Buffer (pos & size)
    const instBuffer = gl.createBuffer();
    if (!instBuffer) throw new Error('Failed to create instance buffer');
    this.instanceBuffer = instBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Attribute 1: Position (px, py)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, height)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  /**
   * Build orthographic projection matrix for shader uniform
   * Converts screen/isometric space to WebGL clip space [-1, 1]
   */
  private buildProjectionMatrix(width: number, height: number): Float32Array {
    // Orthographic projection matrix that maps [0, width] x [0, height] to [-1, 1] x [-1, 1]
    // With Y flipped so (0,0) is top-left in screen space
    const left = 0;
    const right = width;
    const bottom = height;
    const top = 0;
    const near = -1;
    const far = 1;

    const tx = -(right + left) / (right - left);
    const ty = -(top + bottom) / (top - bottom);
    const tz = -(far + near) / (far - near);

    const sx = 2 / (right - left);
    const sy = 2 / (top - bottom);
    const sz = -2 / (far - near);

    return new Float32Array([
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0, 0, sz, 0,
      tx, ty, tz, 1
    ]);
  }

  /**
   * Build isometric projection matrix for shader uniform
   * Transforms Cartesian world coordinates to isometric screen space
   */
  private buildIsometricMatrix(): Float32Array {
    // Classic isometric projection: rotate 45°, then scale Y by 0.5
    // This creates the 2:1 pixel ratio characteristic of isometric view
    const cos45 = Math.SQRT1_2; // ~0.707
    const sin45 = Math.SQRT1_2;
    
    // Combined rotation + scale matrix for isometric view
    // [ cos45  -sin45   0   0 ]
    // [ sin45   cos45   0   0 ] * scale(1, 0.5)
    // [ 0       0       1   0 ]
    // [ 0       0       0   1 ]
    
    return new Float32Array([
      cos45, sin45 * 0.5, 0, 0,   // Column 0: X basis (scaled Y component by 0.5)
      -sin45, cos45 * 0.5, 0, 0,  // Column 1: Y basis (scaled Y component by 0.5)
      0, 0, 1, 0,                  // Column 2: Z basis
      0, 0, 0, 1                   // Column 3: Translation
    ]);
  }

  /**
   * Set isometric transformation and camera uniforms for all render calls
   */
  private setIsoUniforms(width: number, height: number, cameraX: number, cameraY: number): void {
    const gl = this.gl;
    
    // Apply orthographic projection matrix
    const projMatrix = this.buildProjectionMatrix(width, height);
    if (this.projectionLoc) {
      gl.uniformMatrix4fv(this.projectionLoc, false, projMatrix);
    }
    
    // Apply unified isometric matrix
    const isoMatrix = this.buildIsometricMatrix();
    if (this.isoMatrixLoc) {
      gl.uniformMatrix4fv(this.isoMatrixLoc, false, isoMatrix);
    }
    
    // Apply camera offset in isometric space
    if (this.cameraOffsetLoc) {
      gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    }
  }
public render(world: World, width: number, height: number, texture: WebGLTexture): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    // 💡 SAFE CHECK: Return early if world or world.set is not ready
    if (!worldAny || !worldAny.set) return;
    
    const count = worldAny.set.count;
    if (!count || count === 0) return;

    // Pack entity transform data into contiguous array
    const dense = worldAny.set.dense;
    if (!dense) return;

    let offset = 0;
    for (let i = 0; i < count; i++) {
      const id = dense[i];
      this.instanceData[offset++] = worldAny.px[id];
      this.instanceData[offset++] = worldAny.py[id];
      this.instanceData[offset++] = worldAny.width[id];
      this.instanceData[offset++] = worldAny.height[id];
    }

    gl.useProgram(this.program);

    // Apply unified isometric transformation with projection matrix to ALL entities
    this.setIsoUniforms(width, height, 0, 0); // Camera offset can be passed from main loop

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 4));

    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, count);
    gl.bindVertexArray(null);
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${info}`);
    }
    return shader;
  }

  private createProgram(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error('Failed to create WebGL program');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Program link failed: ${info}`);
    }
    return prog;
  }

  public renderFloor(
    floorData: { x: number; y: number; width: number; height: number },
    width: number,
    height: number,
    texture: WebGLTexture,
    cameraX: number = 0,
    cameraY: number = 0
  ): void {
    const gl = this.gl;

    // Pack floor data: x, y, width, height
    this.instanceData[0] = floorData.x;
    this.instanceData[1] = floorData.y;
    this.instanceData[2] = floorData.width;
    this.instanceData[3] = floorData.height;

    // Draw single quad for the entire floor with isometric transform
    gl.useProgram(this.program);

    // Apply unified isometric transformation to floor (same as entities)
    this.setIsoUniforms(width, height, cameraX, cameraY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 4));

    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, 1); // Draw 1 instance (the floor)
    gl.bindVertexArray(null);
  }

  public renderTiles(
  tileBuffer: Float32Array, 
  count: number, 
  tileSize: number, 
  width: number, 
  height: number, 
  texture: WebGLTexture,
  cameraX: number = 0,
  cameraY: number = 0
): void {
  if (count === 0) return;

  const gl = this.gl;

  // 1. Pack map tile data into standard [x, y, sizeX, sizeY] format
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const tileX = tileBuffer[i * 3 + 0];
    const tileY = tileBuffer[i * 3 + 1];
    // tileBuffer[i * 3 + 2] is tileId (used later for texture atlas UVs)

    this.instanceData[offset++] = tileX;
    this.instanceData[offset++] = tileY;
    this.instanceData[offset++] = tileSize; // Width
    this.instanceData[offset++] = tileSize; // Height
  }

  // 2. Draw using WebGL with unified isometric transformation
  gl.useProgram(this.program);

  // Apply unified isometric transformation to tiles (same as floor and entities)
  this.setIsoUniforms(width, height, cameraX, cameraY);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);

  gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 4));

  gl.bindVertexArray(this.vao);
  gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, count);
  gl.bindVertexArray(null);
}
}
