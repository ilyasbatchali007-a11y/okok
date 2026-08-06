import { World } from '../ecs/World';
import { PLAYER_ID } from '../config/Constants';

// Vertex Shader Source - isometric transformation with cube extrusion
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec4 a_vertex;      // For cube: (x, y, z, faceId), For floor: (x, y, 0, 0)
layout(location = 1) in vec2 a_pos;       // Entity position (px, py)
layout(location = 2) in vec2 a_size;      // Entity size (width, height)
layout(location = 3) in float a_height;   // Cube height (z-scale)

uniform vec2 u_resolution;
uniform float u_isoAngle;                 // Isometric rotation angle
uniform float u_isoScale;                 // Y scale for isometric projection (typically 0.5)
uniform vec2 u_cameraOffset;              // Camera offset for scrolling

out float v_faceId;
out vec2 v_uv;

void main() {
  // Step A: Calculate base footprint position (unchanged isometric transform)
  vec2 worldPos = a_pos + (a_vertex.xy * a_size);
  
  // Apply camera offset to get screen-relative position
  vec2 screenPos = worldPos - u_cameraOffset;
  
  // Center on screen
  vec2 centeredPos = screenPos - (u_resolution * 0.5);
  
  // Apply isometric transformation: rotate 45° and scale Y by 0.5
  float c = cos(u_isoAngle);
  float s = sin(u_isoAngle);
  vec2 isoPos;
  isoPos.x = centeredPos.x * c - centeredPos.y * s;
  isoPos.y = (centeredPos.x * s + centeredPos.y * c) * u_isoScale;
  
  // Step B: Screen-space height extrusion
  // Clip space Y is flipped (-clipSpace.y below), so we SUBTRACT to extrude upward on screen
  float screenHeightOffset = a_vertex.z * a_height * u_isoScale;
  isoPos.y -= screenHeightOffset;
  
  // Convert to WebGL clip space [-1, 1]
  vec2 zeroToOne = isoPos / (u_resolution * 0.5);
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_faceId = a_vertex.w;
  v_uv = a_vertex.xy;
}
`;

// Fragment Shader Source - supports both floor and entity colors with per-face shading
const FS_SOURCE = `#version 300 es
precision mediump float;

in float v_faceId;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform int u_renderMode;  // 0 = floor, 1 = entity
uniform vec4 u_entityColor;
out vec4 fragColor;

void main() {
  if (u_renderMode == 1) {
    // Apply per-face shading for cube entities
    float brightness = 1.0;
    
    // Face ID encoding:
    // 0 = Top, 1 = Front-Right, 2 = Front-Left, 3 = Back-Right, 4 = Back-Left, 5 = Bottom
    if (v_faceId < 0.5) {
      // Top face - full brightness
      brightness = 1.0;
    } else if (v_faceId < 1.5) {
      // Front-Right face - medium shadow
      brightness = 0.7;
    } else if (v_faceId < 2.5) {
      // Front-Left face - dark shadow
      brightness = 0.5;
    } else if (v_faceId < 3.5) {
      // Back-Right face - medium shadow
      brightness = 0.7;
    } else if (v_faceId < 4.5) {
      // Back-Left face - dark shadow  
      brightness = 0.5;
    } else {
      // Bottom face - darkest (usually not visible)
      brightness = 0.3;
    }
    
    fragColor = u_entityColor * brightness;
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
  private floorVAO: WebGLVertexArrayObject;    // VAO for floor rendering
  private cubeVAO: WebGLVertexArrayObject;     // VAO for cube rendering
  private cubeBuffer: WebGLBuffer;             // Static cube geometry buffer
  private floorBuffer: WebGLBuffer;            // Static floor quad buffer
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
    // 5 floats per instance: px, py, width, height, cubeHeight
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

    // 1. Static Cube Buffer (24 vertices: 4 per face × 6 faces with CCW winding)
    // Each vertex: x, y, z (local [0..1]), faceId (float) packed into vec4
    // Face IDs: 0=Top, 1=Front-Right, 2=Front-Left, 3=Back-Right, 4=Back-Left, 5=Bottom
    const cubeVertices = new Float32Array([
      // Top face (faceId=0) - CCW when viewed from above
      0, 0, 1, 0,   1, 0, 1, 0,   0, 1, 1, 0,
      0, 1, 1, 0,   1, 0, 1, 0,   1, 1, 1, 0,
      
      // Front-Right face (faceId=1) - CCW when viewed from front-right
      1, 0, 0, 1,   1, 1, 0, 1,   1, 0, 1, 1,
      1, 0, 1, 1,   1, 1, 0, 1,   1, 1, 1, 1,
      
      // Front-Left face (faceId=2) - CCW when viewed from front-left
      0, 0, 0, 2,   0, 0, 1, 2,   0, 1, 0, 2,
      0, 1, 0, 2,   0, 0, 1, 2,   0, 1, 1, 2,
      
      // Back-Right face (faceId=3) - CCW when viewed from back-right
      1, 1, 0, 3,   1, 1, 1, 3,   0, 1, 0, 3,
      0, 1, 0, 3,   1, 1, 1, 3,   0, 1, 1, 3,
      
      // Back-Left face (faceId=4) - CCW when viewed from back-left
      0, 1, 0, 4,   0, 1, 1, 4,   0, 0, 0, 4,
      0, 0, 0, 4,   0, 1, 1, 4,   0, 0, 1, 4,
      
      // Bottom face (faceId=5) - CCW when viewed from below
      0, 0, 0, 5,   0, 1, 0, 5,   1, 0, 0, 5,
      1, 0, 0, 5,   0, 1, 0, 5,   1, 1, 0, 5,
    ]);
    const cubeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cubeVertices, gl.STATIC_DRAW);
    this.cubeBuffer = cubeBuffer;

    // 2. Static Floor Quad Buffer (6 vertices for a single quad)
    // Each vertex: x, y, z=0, faceId=0 packed into vec4
    const floorVertices = new Float32Array([
      // Single quad covering [0,0] to [1,1]
      0, 0, 0, 0,   1, 0, 0, 0,   0, 1, 0, 0,
      0, 1, 0, 0,   1, 0, 0, 0,   1, 1, 0, 0,
    ]);
    const floorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, floorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, floorVertices, gl.STATIC_DRAW);
    this.floorBuffer = floorBuffer;

    // 3. Dynamic Instance Buffer (pos, size, height)
    const instBuffer = gl.createBuffer();
    if (!instBuffer) throw new Error('Failed to create instance buffer');
    this.instanceBuffer = instBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Stride: 5 floats × 4 bytes = 20 bytes
    const stride = 20;

    // ============================================
    // Create FLOOR VAO
    // ============================================
    const floorVAO = gl.createVertexArray();
    if (!floorVAO) throw new Error('Failed to create floor VAO');
    this.floorVAO = floorVAO;
    gl.bindVertexArray(floorVAO);

    // Bind floor buffer for attribute 0
    gl.bindBuffer(gl.ARRAY_BUFFER, this.floorBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

    // Attribute 1: Position (px, py)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, height)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: Height (not used for floor, but set up)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);

    // ============================================
    // Create CUBE VAO
    // ============================================
    const cubeVAO = gl.createVertexArray();
    if (!cubeVAO) throw new Error('Failed to create cube VAO');
    this.cubeVAO = cubeVAO;
    gl.bindVertexArray(cubeVAO);

    // Bind cube buffer for attribute 0
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

    // Attribute 1: Position (px, py)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, height)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: Height (cube height/z-scale)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);

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
      this.instanceData[offset++] = 0.0; // cubeHeight = 0 for flat entities
    }

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 5));

    gl.bindVertexArray(this.cubeVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);
  }
  
  /**
   * Render player entity as a 3D cube with red color and per-face shading
   */
  public renderPlayer(world: World, width: number, height: number, texture: WebGLTexture,
                      cameraX: number = 0, cameraY: number = 0): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    if (!worldAny || !worldAny.active || !worldAny.active[PLAYER_ID]) return;
    
    // Pack single player entity: px, py, width, height, cubeHeight
    // Cube height is set to 32 (same as footprint) for a true cube appearance
    const cubeHeight = 32.0;
    this.instanceData[0] = worldAny.px[PLAYER_ID];
    this.instanceData[1] = worldAny.py[PLAYER_ID];
    this.instanceData[2] = worldAny.width[PLAYER_ID];
    this.instanceData[3] = worldAny.height[PLAYER_ID];
    this.instanceData[4] = cubeHeight;

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1i(this.renderModeLoc, 1);  // Entity mode
    gl.uniform4f(this.entityColorLoc, 1.0, 0.0, 0.0, 1.0);  // Red color

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 5));

    // Enable back-face culling for cube rendering
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    
    gl.bindVertexArray(this.cubeVAO);
    // Draw 24 vertices (4 per face × 6 faces) for the cube
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 24, 1);
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
      // Pack floor data: x, y, width, height, height=0
      this.instanceData[0] = floorData.x;
      this.instanceData[1] = floorData.y;
      this.instanceData[2] = floorData.width;
      this.instanceData[3] = floorData.height;
      this.instanceData[4] = 0.0; // cubeHeight = 0 for floor

      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 5));
    }

    // Disable culling for floor rendering
    gl.disable(gl.CULL_FACE);

    // Draw single quad for the entire floor
    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1i(this.renderModeLoc, 0);  // Floor mode

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindVertexArray(this.floorVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1); // Draw 1 instance (the floor)
    gl.bindVertexArray(null);
  }
}
