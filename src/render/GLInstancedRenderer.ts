import { World } from '../ecs/World';
import { PLAYER_ID } from '../config/Constants';

// Vertex Shader Source - Isometric box with 3 visible faces
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_quadPos; // Unit quad vertex position [0..1]
layout(location = 1) in vec2 a_pos;     // Entity position (px, py)
layout(location = 2) in vec2 a_size;    // Entity size (width, height)
layout(location = 3) in float a_face;   // Face index: 0=top, 1=left, 2=right

uniform vec2 u_resolution;
uniform float u_isoAngle;               // Isometric rotation angle
uniform float u_isoScale;               // Y scale for isometric projection (typically 0.5)
uniform vec2 u_cameraOffset;            // Camera offset for scrolling
uniform float u_zoom;                   // Zoom factor

out vec2 v_uv;
out float v_face;
out float v_lighting;

void main() {
  float width = a_size.x;
  float height = a_size.y;
  float depth = height * 0.5;  // Box depth is half the height
  
  vec2 worldPos;
  float lighting = 1.0;
  
  if (a_face < 0.5) {
    // TOP face
    worldPos = a_pos + (a_quadPos * a_size);
    worldPos.y -= depth;  // Shift top face up
    lighting = 1.0;
  } else if (a_face < 1.5) {
    // LEFT face
    worldPos = a_pos + vec2(a_quadPos.x * width, 0.0);
    worldPos.y += (1.0 - a_quadPos.y) * depth;
    lighting = 0.7;
  } else {
    // RIGHT face  
    worldPos = a_pos + vec2(width, a_quadPos.y * height);
    worldPos.x += (a_quadPos.x - 1.0) * depth;
    worldPos.y += depth;
    lighting = 0.85;
  }
  
  vec2 relPos = worldPos - u_cameraOffset;

  // Standard 2.5D Isometric projection:
  float c = cos(u_isoAngle);
  float s = sin(u_isoAngle);
  vec2 isoPos;
  isoPos.x = (relPos.x - relPos.y) * c * u_zoom;
  isoPos.y = (relPos.x + relPos.y) * s * u_isoScale * u_zoom;

  // Add viewport center offset:
  vec2 screenPos = isoPos + (u_resolution * 0.5);
  vec2 clipSpace = (screenPos / u_resolution) * 2.0 - 1.0;

  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = a_quadPos;
  v_face = a_face;
  v_lighting = lighting;
}
`;

// Fragment Shader Source - supports both floor and entity colors with lighting
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_face;
in float v_lighting;
uniform sampler2D u_texture;
uniform int u_renderMode;  // 0 = floor, 1 = entity
uniform vec4 u_entityColor;
out vec4 fragColor;

void main() {
  if (u_renderMode > 0) {
    // Render as solid red entity with lighting
    vec3 color = u_entityColor.rgb * v_lighting;
    fragColor = vec4(color, u_entityColor.a);
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
  private zoomLoc: WebGLUniformLocation | null;
  
  // Isometric view defaults
  private isoAngle: number = Math.PI / 4;  // 45 degrees
  private isoScale: number = 0.5;          // Y compression for isometric
  private cameraOffsetX: number = 0;
  private cameraOffsetY: number = 0;
  private zoom: number = 2.0;              // Zoom in on player

  constructor(gl: WebGL2RenderingContext, maxEntities: number) {
    this.gl = gl;
    // 5 floats per instance: px, py, width, height, faceIndex
    this.instanceData = new Float32Array(maxEntities * 5);

    const vs = this.createShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this.createShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    this.program = this.createProgram(vs, fs);

    this.resolutionLoc = gl.getUniformLocation(this.program, 'u_resolution');
    this.isoAngleLoc = gl.getUniformLocation(this.program, 'u_isoAngle');
    this.isoScaleLoc = gl.getUniformLocation(this.program, 'u_isoScale');
    this.cameraOffsetLoc = gl.getUniformLocation(this.program, 'u_cameraOffset');
    this.renderModeLoc = gl.getUniformLocation(this.program, 'u_renderMode');
    this.entityColorLoc = gl.getUniformLocation(this.program, 'u_entityColor');
    this.zoomLoc = gl.getUniformLocation(this.program, 'u_zoom');

    // Create & setup VAO
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(this.vao);

    // 1. Static Quad Buffer - single flat quad (6 vertices)
    // Format: x, y (unit quad [0..1])
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

    // Attribute 0: Position (x, y)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    // 2. Dynamic Instance Buffer (pos, size, face)
    const instBuffer = gl.createBuffer();
    if (!instBuffer) throw new Error('Failed to create instance buffer');
    this.instanceBuffer = instBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Attribute 1: Position (px, py)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, height)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 20, 8);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: Face index
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 20, 16);
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
      this.instanceData[offset++] = worldAny.width[id];
      this.instanceData[offset++] = worldAny.height[id];
    }

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 4));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count); // 6 vertices per quad
    gl.bindVertexArray(null);
  }
  
  /**
   * Render player entity as a 3D box with red color
   */
  public renderPlayer(world: World, width: number, height: number, texture: WebGLTexture,
                      cameraX: number = 0, cameraY: number = 0): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    if (!worldAny || !worldAny.active || !worldAny.active[PLAYER_ID]) return;
    
    const px = worldAny.px[PLAYER_ID];
    const py = worldAny.py[PLAYER_ID];
    const w = worldAny.width[PLAYER_ID];
    const h = worldAny.height[PLAYER_ID];
    
    // Pack 3 faces for the box: top(0), left(1), right(2)
    // Each face: px, py, width, height, faceIndex
    let offset = 0;
    // Top face
    this.instanceData[offset++] = px;
    this.instanceData[offset++] = py;
    this.instanceData[offset++] = w;
    this.instanceData[offset++] = h;
    this.instanceData[offset++] = 0.0;  // face = 0 (top)
    // Left face
    this.instanceData[offset++] = px;
    this.instanceData[offset++] = py;
    this.instanceData[offset++] = w;
    this.instanceData[offset++] = h;
    this.instanceData[offset++] = 1.0;  // face = 1 (left)
    // Right face
    this.instanceData[offset++] = px;
    this.instanceData[offset++] = py;
    this.instanceData[offset++] = w;
    this.instanceData[offset++] = h;
    this.instanceData[offset++] = 2.0;  // face = 2 (right)

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1f(this.zoomLoc, this.zoom);
    gl.uniform1i(this.renderModeLoc, 1);  // Entity mode
    gl.uniform4f(this.entityColorLoc, 1.0, 0.0, 0.0, 1.0);  // Red color

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 15)); // 3 faces * 5 floats

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 3); // Draw 3 instances (3 faces)
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

    // Draw single quad for the entire floor
    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1i(this.renderModeLoc, 0);  // Floor mode

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 4));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1); // Draw 1 instance (the floor)
    gl.bindVertexArray(null);
  }
}
