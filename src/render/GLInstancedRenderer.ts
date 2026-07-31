import { World } from '../ecs/World';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/Constants';

// Vertex Shader Source for Instanced Entities (unchanged)
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_quadPos; // Unit quad vertex position [0..1]
layout(location = 1) in vec2 a_pos;     // Entity position (px, py)
layout(location = 2) in vec2 a_size;    // Entity size (width, height)

uniform vec2 u_resolution;

out vec2 v_uv;

void main() {
  vec2 worldPos = a_pos + (a_quadPos * a_size);
  // Convert screen coordinates [0, res] to WebGL clip space [-1, 1]
  vec2 zeroToOne = worldPos / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;

  // Flip Y axis so 0,0 is top-left
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = a_quadPos;
}
`;

// Fragment Shader Source for Instanced Entities (unchanged)
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
  fragColor = texture(u_texture, v_uv);
}
`;

// Vertex Shader for Floor Quad (3D, center-origin, X-Z plane)
const FLOOR_VS_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_position;

uniform mat4 u_modelViewProjection;

void main() {
  gl_Position = u_modelViewProjection * vec4(a_position, 1.0);
}
`;

// Fragment Shader for Floor Quad (solid debug color - green)
const FLOOR_FS_SOURCE = `#version 300 es
precision mediump float;

out vec4 fragColor;

void main() {
  fragColor = vec4(0.0, 1.0, 0.0, 1.0); // Solid green debug color
}
`;

export class GLInstancedRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;

  private instanceData: Float32Array;
  private resolutionLoc: WebGLUniformLocation | null;

  // Floor Quad specific resources
  private floorProgram: WebGLProgram;
  private floorVAO: WebGLVertexArrayObject;
  private floorIndexBuffer: WebGLBuffer;
  private mvpLoc: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext, maxEntities: number) {
    this.gl = gl;
    // 4 floats per instance: px, py, width, height
    this.instanceData = new Float32Array(maxEntities * 4);

    const vs = this.createShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this.createShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    this.program = this.createProgram(vs, fs);

    this.resolutionLoc = gl.getUniformLocation(this.program, 'u_resolution');

    // Create & setup VAO
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(this.vao);

    // 1. Static Quad Buffer (unit rectangle)
    const quadVertices = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 2. Dynamic Instance Buffer (pos & size)
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

    // === Floor Quad Setup (3D, center-origin, X-Z plane) ===
    const floorVs = this.createShader(gl.VERTEX_SHADER, FLOOR_VS_SOURCE);
    const floorFs = this.createShader(gl.FRAGMENT_SHADER, FLOOR_FS_SOURCE);
    this.floorProgram = this.createProgram(floorVs, floorFs);
    this.mvpLoc = gl.getUniformLocation(this.floorProgram, 'u_modelViewProjection');

    // Create Floor VAO
    const floorVAO = gl.createVertexArray();
    if (!floorVAO) throw new Error('Failed to create floor VAO');
    this.floorVAO = floorVAO;
    gl.bindVertexArray(this.floorVAO);

    // Define center-origin vertices for the quad on X-Z plane (Y=0)
    // V0 (Near-Left  / -X, +Z): [-width/2, 0,  depth/2]
    // V1 (Near-Right / +X, +Z): [ width/2, 0,  depth/2]
    // V2 (Far-Left   / -X, -Z): [-width/2, 0, -depth/2]
    // V3 (Far-Right  / +X, -Z): [ width/2, 0, -depth/2]
    const floorWidth = WORLD_WIDTH;
    const floorDepth = WORLD_HEIGHT;
    const halfW = floorWidth / 2;
    const halfD = floorDepth / 2;

    const floorVertices = new Float32Array([
      -halfW, 0,  halfD,  // V0: Near-Left
       halfW, 0,  halfD,  // V1: Near-Right
      -halfW, 0, -halfD,  // V2: Far-Left
       halfW, 0, -halfD,  // V3: Far-Right
    ]);

    const floorVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, floorVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, floorVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Define true Counter-Clockwise (CCW) indices when looking down from +Y
    // Triangle 1: [0, 2, 1]
    // Triangle 2: [1, 2, 3]
    const floorIndices = new Uint16Array([
      0, 2, 1,  // Triangle 1
      1, 2, 3,  // Triangle 2
    ]);

    const floorIndexBuffer = gl.createBuffer();
    if (!floorIndexBuffer) throw new Error('Failed to create floor index buffer');
    this.floorIndexBuffer = floorIndexBuffer;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.floorIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, floorIndices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
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
    gl.uniform2f(this.resolutionLoc, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 4));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
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
    texture: WebGLTexture
  ): void {
    const gl = this.gl;

    // Use the floor quad program (3D, center-origin)
    gl.useProgram(this.floorProgram);

    // Build orthographic projection matrix for X-Z plane centered at (0,0,0)
    // We want to map world coordinates [0..width] x [0..height] to clip space [-1..1]
    // The quad is centered at origin with vertices from -width/2 to +width/2 and -height/2 to +height/2
    // Ortho matrix: maps [left, right] x [bottom, top] x [near, far] to [-1, 1]
    const left = 0;
    const right = width;
    const bottom = 0;
    const top = height;
    const near = -1.0;
    const far = 1.0;

    const lr = 1.0 / (left - right);
    const bt = 1.0 / (bottom - top);
    const nf = 1.0 / (near - far);

    // Row-major orthographic projection matrix
    const mvp = new Float32Array([
      2 * lr, 0, 0, 0,
      0, 2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
    ]);

    gl.uniformMatrix4fv(this.mvpLoc, false, mvp);

    // Bind floor VAO and draw using indexed triangles
    gl.bindVertexArray(this.floorVAO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  public renderTiles(
  tileBuffer: Float32Array, 
  count: number, 
  tileSize: number, 
  width: number, 
  height: number, 
  texture: WebGLTexture
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

  // 2. Draw using WebGL
  gl.useProgram(this.program);
  gl.uniform2f(this.resolutionLoc, width, height);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);

  gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 4));

  gl.bindVertexArray(this.vao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  gl.bindVertexArray(null);
}
}
