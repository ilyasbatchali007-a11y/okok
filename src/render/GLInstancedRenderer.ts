import { World } from '../ecs/World';
import { PLAYER_ID } from '../config/Constants';

// Vertex Shader Source - renders 3D isometric box with proper positioning
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_quadPos; // Unit quad vertex position [0..1]
layout(location = 1) in vec2 a_pos;     // Entity position (px, py) - TOP-LEFT corner
layout(location = 2) in vec2 a_size;    // Entity size (width, height)
layout(location = 3) in float a_face;   // Face index for 3D box (0=top, 1=left, 2=right)

uniform vec2 u_resolution;
uniform float u_isoAngle;               // Isometric rotation angle
uniform float u_isoScale;               // Y scale for isometric projection (typically 0.5)
uniform vec2 u_cameraOffset;            // Camera offset for scrolling
uniform float u_boxHeight;              // Height of 3D box extrusion

out vec2 v_uv;
out float v_face;
out float v_light;

void main() {
  vec2 basePos = a_pos;
  vec2 size = a_size;
  vec2 uv = a_quadPos;
  float face = floor(a_face + 0.5); // Round to nearest integer face index
  
  // Calculate world position based on which face we're rendering
  vec2 worldPos;
  
  if (face == 0) {
    // Top face - use entity position as-is (top-left corner)
    worldPos = basePos + (uv * size);
  } else if (face == 1) {
    // Left face - offset down by box height from top edge
    worldPos = basePos + vec2(0.0, size.y) + vec2(0.0, -u_boxHeight) + (uv * size);
  } else {
    // Right face - offset right by box height from right edge
    worldPos = basePos + vec2(size.x, 0.0) + vec2(u_boxHeight, 0.0) + (uv * size);
  }
  
  // Apply camera offset
  vec2 screenPos = worldPos - u_cameraOffset;
  
  // Apply isometric transformation
  float c = cos(u_isoAngle);
  float s = sin(u_isoAngle);
  vec2 isoPos;
  isoPos.x = screenPos.x * c - screenPos.y * s;
  isoPos.y = (screenPos.x * s + screenPos.y * c) * u_isoScale;
  
  // Convert to clip space
  vec2 zeroToOne = isoPos / (u_resolution * 0.5);
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = uv;
  v_face = face;
  
  // Lighting based on face
  if (face == 0) {
    v_light = 1.0;      // Top face - brightest
  } else if (face == 1) {
    v_light = 0.65;     // Left face - darkest
  } else {
    v_light = 0.85;     // Right face - medium
  }
}
`;

// Fragment Shader Source - supports both floor and entity colors with 3D box lighting
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_face;
in float v_light;
uniform sampler2D u_texture;
uniform int u_renderMode;  // 0 = floor, 1 = entity
uniform vec4 u_entityColor;
out vec4 fragColor;

void main() {
  if (u_renderMode == 1) {
    // Render as solid red entity with face-based lighting for 3D effect
    vec3 color = u_entityColor.rgb * v_light;
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
  private boxHeightLoc: WebGLUniformLocation | null;

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
  private boxHeight: number = 16;          // Height of 3D boxes

  constructor(gl: WebGL2RenderingContext, maxEntities: number) {
    this.gl = gl;
    // 5 floats per instance: px, py, width, height, face
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
    this.boxHeightLoc = gl.getUniformLocation(this.program, 'u_boxHeight');

    // Create & setup VAO
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(this.vao);

    // 1. Static Quad Buffer - 3D box vertices (top, left, right faces)
    // Each face is a unit quad with 6 vertices (2 triangles), plus face index
    // Format: x, y, faceIndex
    const boxVertices = new Float32Array([
      // Top face (face = 0)
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 1, 0,
      1, 0, 0,
      1, 1, 0,
      
      // Left face (face = 1)
      0, 0, 1,
      1, 0, 1,
      0, 1, 1,
      0, 1, 1,
      1, 0, 1,
      1, 1, 1,
      
      // Right face (face = 2)
      0, 0, 2,
      1, 0, 2,
      0, 1, 2,
      0, 1, 2,
      1, 0, 2,
      1, 1, 2,
    ]);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, boxVertices, gl.STATIC_DRAW);

    // Attribute 0: Position (x, y)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    
    // Attribute 3: Face index (stored in vertex data)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 12, 8);

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
  }
  
  /**
   * Set isometric view parameters
   */
  public setIsometricView(angleRadians: number, scaleY: number, boxHeight: number = 16): void {
    this.isoAngle = angleRadians;
    this.isoScale = scaleY;
    this.boxHeight = boxHeight;
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
      this.instanceData[offset++] = 0; // face index (0 for generic entities)
    }

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1f(this.boxHeightLoc, this.boxHeight);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 5));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, count); // 18 vertices per box (3 faces * 6 verts)
    gl.bindVertexArray(null);
  }
  
  /**
   * Render player entity with red color as a 3D box
   */
  public renderPlayer(world: World, width: number, height: number, texture: WebGLTexture,
                      cameraX: number = 0, cameraY: number = 0): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    if (!worldAny || !worldAny.active || !worldAny.active[PLAYER_ID]) return;
    
    // Pack single player entity - face index 0 (will draw all 3 faces via instancing)
    this.instanceData[0] = worldAny.px[PLAYER_ID];
    this.instanceData[1] = worldAny.py[PLAYER_ID];
    this.instanceData[2] = worldAny.width[PLAYER_ID];
    this.instanceData[3] = worldAny.height[PLAYER_ID];
    this.instanceData[4] = 0; // face index (0 = top, vertex shader handles all 3 faces)

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1f(this.boxHeightLoc, this.boxHeight);
    gl.uniform1i(this.renderModeLoc, 1);  // Entity mode
    gl.uniform4f(this.entityColorLoc, 1.0, 0.0, 0.0, 1.0);  // Red color

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 5));

    gl.bindVertexArray(this.vao);
    // Draw 3 faces (top, left, right) - 6 vertices per face = 18 total
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, 1);
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
