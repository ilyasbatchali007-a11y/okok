import { World } from '../ecs/World';
import { PLAYER_ID } from '../config/Constants';

// Vertex Shader Source - 3D box with isometric transformation
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_quadPos;   // Unit quad vertex position [0..1]
layout(location = 1) in vec3 a_pos;       // Entity position (px, py, height)
layout(location = 2) in vec2 a_size;      // Entity size (width, depth)
layout(location = 3) in float a_faceId;   // Face identifier: 0=top, 1=left, 2=right

uniform vec2 u_resolution;
uniform float u_isoAngle;                 // Isometric rotation angle
uniform float u_isoScale;                 // Y scale for isometric projection (typically 0.5)
uniform vec2 u_cameraOffset;              // Camera offset for scrolling

out vec2 v_uv;
out float v_faceId;

void main() {
  float width = a_size.x;
  float depth = a_size.y;
  float height = a_pos.z;
  float posX = a_pos.x;
  float posY = a_pos.y;
  
  vec3 worldPos;
  vec2 uv;
  
  if (a_faceId == 0.0) {
    // TOP FACE: lies at y=height, spans width x depth in XZ plane
    worldPos = vec3(posX + a_quadPos.x * width, height, posY + a_quadPos.y * depth);
    uv = a_quadPos;
  } else if (a_faceId == 1.0) {
    // LEFT FACE: vertical face on the -X side (spans Z/depth and Y/height)
    worldPos = vec3(posX, a_quadPos.y * height, posY + a_quadPos.x * depth);
    uv = a_quadPos;
  } else {
    // RIGHT FACE: vertical face on the +Z side (spans X/width and Y/height)
    worldPos = vec3(posX + a_quadPos.x * width, a_quadPos.y * height, posY + depth);
    uv = a_quadPos;
  }
  
  // Apply isometric transformation FIRST in world space
  float c = cos(u_isoAngle);
  float s = sin(u_isoAngle);
  vec2 isoWorldPos;
  isoWorldPos.x = worldPos.x * c - worldPos.z * s;
  isoWorldPos.y = (worldPos.x * s + worldPos.z * c) * u_isoScale;
  
  // Now apply camera offset to get screen-relative position
  vec2 screenPos = isoWorldPos;
  
  // Convert to WebGL clip space [-1, 1]
  // Subtract camera offset (which is already in isometric space) to get camera-relative position
  vec2 cameraRelPos = screenPos - u_cameraOffset;
  
  // Center on screen by adding half resolution
  vec2 centeredPos = cameraRelPos + (u_resolution * 0.5);
  
  // Add height offset to Y position for 3D effect
  centeredPos.y -= worldPos.y * 0.8;
  
  // Normalize to [-1, 1] clip space
  vec2 zeroToOne = centeredPos / (u_resolution * 0.5);
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = uv;
  v_faceId = a_faceId;
}
`;

// Fragment Shader Source - supports both floor and entity colors with 3D box shading
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_faceId;
uniform sampler2D u_texture;
uniform int u_renderMode;  // 0 = floor, 1 = entity
uniform vec4 u_entityColor;
out vec4 fragColor;

void main() {
  if (u_renderMode == 1) {
    // Render as 3D box entity with different shades for each face
    vec3 baseColor = u_entityColor.rgb;
    float shade;
    
    int faceId = int(v_faceId + 0.5);  // Round to nearest integer
    
    if (faceId == 0) {
      // TOP FACE: brightest
      shade = 1.0;
    } else if (faceId == 1) {
      // LEFT FACE: medium shade
      shade = 0.7;
    } else {
      // RIGHT FACE: darkest
      shade = 0.5;
    }
    
    fragColor = vec4(baseColor * shade, u_entityColor.a);
  } else {
    // Render as green checkered floor pattern
    float gridX = mod(floor(v_uv.x * 8.0), 2.0);
    float gridY = mod(floor(v_uv.y * 8.0), 2.0);
    float checker = mod(gridX + gridY, 2.0);
    
    if (checker < 0.5) {
      fragColor = vec4(0.2, 0.6, 0.2, 1.0);  // Dark green
    } else {
      fragColor = vec4(0.3, 0.7, 0.3, 1.0);  // Light green
    }
  }
}
`;

export class GLInstancedRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;

  private instanceData: Float32Array;
  private resolutionLoc: WebGLUniformLocation | null;
  private isoAngleLoc: WebGLUniformLocation | null;
  private isoScaleLoc: WebGLUniformLocation | null;
  private cameraOffsetLoc: WebGLUniformLocation | null;
  private renderModeLoc: WebGLUniformLocation | null;
  private entityColorLoc: WebGLUniformLocation | null;
  
  // Isometric view defaults
  private isoAngle: number = Math.PI / 4;  // 45 degrees
  private isoScale: number = 0.5;          // Y compression for isometric
  private cameraOffsetX: number = 0;
  private cameraOffsetY: number = 0;

  constructor(gl: WebGL2RenderingContext, maxEntities: number) {
    this.gl = gl;
    // For 3D box: 5 floats per instance (px, py, height, width, depth) + 1 int for faceId
    // We'll use a larger buffer to accommodate the extra data
    this.instanceData = new Float32Array(maxEntities * 6);

    const vs = this.createShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this.createShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    this.program = this.createProgram(vs, fs);

    this.resolutionLoc = gl.getUniformLocation(this.program, 'u_resolution');
    this.isoAngleLoc = gl.getUniformLocation(this.program, 'u_isoAngle');
    this.isoScaleLoc = gl.getUniformLocation(this.program, 'u_isoScale');
    this.cameraOffsetLoc = gl.getUniformLocation(this.program, 'u_cameraOffset');
    this.renderModeLoc = gl.getUniformLocation(this.program, 'u_renderMode');
    this.entityColorLoc = gl.getUniformLocation(this.program, 'u_entityColor');

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

    // 2. Dynamic Instance Buffer (pos, height, size, faceId)
    const instBuffer = gl.createBuffer();
    if (!instBuffer) throw new Error('Failed to create instance buffer');
    this.instanceBuffer = instBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Attribute 1: Position (px, py, height) - location 1
    // Stride is 6 floats * 4 bytes = 24 bytes
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, depth) - location 2
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: Face ID (int) - location 3
    // Face ID is stored as float in the buffer, read as float and converted to int in shader
    // Offset: 5 floats * 4 bytes = 20 bytes
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 20);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);
  }
  
  /**
   * Set isometric view parameters
   */
  public setIsometricView(angleRadians: number, scaleY: number): void {
    this.isoAngle = angleRadians;
    this.isoScale = scaleY;
  }
  public render(world: World, width: number, height: number, texture: WebGLTexture, 
                cameraX: number = 0, cameraY: number = 0): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    // SAFE CHECK: Return early if world or world.set is not ready
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
      this.instanceData[offset++] = worldAny.width[id];  // height (y-dimension of box)
      this.instanceData[offset++] = worldAny.height[id]; // width (x-dimension of box)
      this.instanceData[offset++] = 32;                  // depth (z-dimension/box height)
      this.instanceData[offset++] = 0.0;                 // faceId = 0 (top face only for entities in bulk render)
    }

    // Apply isometric transformation to camera offset before passing to shader
    // The shader expects camera offset in isometric space, not world space
    const c = Math.cos(this.isoAngle);
    const s = Math.sin(this.isoAngle);
    const isoCameraX = cameraX * c - cameraY * s;
    const isoCameraY = (cameraX * s + cameraY * c) * this.isoScale;

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, isoCameraX, isoCameraY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 6));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);
  }
  
  /**
   * Render player entity as a red 3D box
   */
  public renderPlayer(world: World, width: number, height: number, texture: WebGLTexture,
                      cameraX: number = 0, cameraY: number = 0): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    if (!worldAny || !worldAny.active || !worldAny.active[PLAYER_ID]) return;
    
    const px = worldAny.x[PLAYER_ID];
    const py = worldAny.y[PLAYER_ID];
    const entityWidth = worldAny.w[PLAYER_ID];
    const entityHeight = worldAny.h[PLAYER_ID];
    const boxHeight = 32;  // Fixed height for the 3D box
    
    // Instance layout: [px, py, height, width, depth, faceId]
    // Render all 3 faces of the box (top, left, right)
    let instanceCount = 0;
    
    // Top face (faceId = 0) - positioned at (px, py) with height
    this.instanceData[instanceCount++] = px;
    this.instanceData[instanceCount++] = py;
    this.instanceData[instanceCount++] = boxHeight;
    this.instanceData[instanceCount++] = entityWidth;
    this.instanceData[instanceCount++] = entityHeight;
    this.instanceData[instanceCount++] = 0.0;
    
    // Left face (faceId = 1) - same base position
    this.instanceData[instanceCount++] = px;
    this.instanceData[instanceCount++] = py;
    this.instanceData[instanceCount++] = boxHeight;
    this.instanceData[instanceCount++] = entityWidth;
    this.instanceData[instanceCount++] = entityHeight;
    this.instanceData[instanceCount++] = 1.0;
    
    // Right face (faceId = 2) - same base position
    this.instanceData[instanceCount++] = px;
    this.instanceData[instanceCount++] = py;
    this.instanceData[instanceCount++] = boxHeight;
    this.instanceData[instanceCount++] = entityWidth;
    this.instanceData[instanceCount++] = entityHeight;
    this.instanceData[instanceCount++] = 2.0;

    // Apply isometric transformation to camera offset before passing to shader
    // The shader expects camera offset in isometric space, not world space
    const c = Math.cos(this.isoAngle);
    const s = Math.sin(this.isoAngle);
    const isoCameraX = cameraX * c - cameraY * s;
    const isoCameraY = (cameraX * s + cameraY * c) * this.isoScale;

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, isoCameraX, isoCameraY);
    gl.uniform1i(this.renderModeLoc, 1);  // Entity mode
    gl.uniform4f(this.entityColorLoc, 1.0, 0.0, 0.0, 1.0);  // Red color

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, instanceCount));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.floor(instanceCount / 6));  // Draw instances
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
    floorData: { x: number; y: number; width: number; height: number } | null,
    width: number,
    height: number,
    texture: WebGLTexture,
    cameraX: number = 0,
    cameraY: number = 0
  ): void {
    const gl = this.gl;

    // Only update floor data if provided (camera moved)
    if (floorData !== null) {
      // Floor data: x, y, height(0 for floor), width, depth, faceId(0 for top)
      this.instanceData[0] = floorData.x;
      this.instanceData[1] = floorData.y;
      this.instanceData[2] = 0.0;     // height = 0 for floor
      this.instanceData[3] = floorData.width;
      this.instanceData[4] = floorData.height;
      this.instanceData[5] = 0.0;     // faceId = 0 (top face)

      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 6));
    }

    // Apply isometric transformation to camera offset before passing to shader
    // The shader expects camera offset in isometric space, not world space
    const c = Math.cos(this.isoAngle);
    const s = Math.sin(this.isoAngle);
    const isoCameraX = cameraX * c - cameraY * s;
    const isoCameraY = (cameraX * s + cameraY * c) * this.isoScale;

    // Draw single quad for the entire floor
    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, isoCameraX, isoCameraY);
    gl.uniform1i(this.renderModeLoc, 0);  // Floor mode

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1); // Draw 1 instance (the floor)
    gl.bindVertexArray(null);
  }
}
