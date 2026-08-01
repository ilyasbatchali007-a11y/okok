import { World } from '../ecs/World';
import { PLAYER_ID } from '../config/Constants';

// Vertex Shader Source - simplified isometric transformation for 3D box
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_quadPos;   // Unit quad vertex position [0..1]
layout(location = 1) in vec2 a_pos;       // Entity position (px, py)
layout(location = 2) in vec2 a_size;      // Entity size (width, height)
layout(location = 3) in vec4 a_faceData;  // faceType, yOffset, xOffset, zOffset

uniform vec2 u_resolution;
uniform float u_isoAngle;                 // Isometric rotation angle
uniform float u_isoScale;                 // Y scale for isometric projection (typically 0.5)
uniform vec2 u_cameraOffset;              // Camera offset for scrolling

out vec2 v_uv;
out float v_faceType;

void main() {
  // Apply face-specific offsets
  float faceType = a_faceData.x;
  float yOffset = a_faceData.y;
  float xOffset = a_faceData.z;
  float zOffset = a_faceData.w;
  
  // Calculate world position from instance data with offsets
  vec2 worldPos = a_pos + (a_quadPos * a_size) + vec2(xOffset, yOffset);
  
  // Apply camera offset to get screen-relative position
  vec2 screenPos = worldPos - u_cameraOffset;
  
  // Center on screen - player should be at center
  vec2 centeredPos = screenPos;
  
  // Apply isometric transformation: rotate 45° and scale Y by 0.5
  float c = cos(u_isoAngle);
  float s = sin(u_isoAngle);
  vec2 isoPos;
  isoPos.x = centeredPos.x * c - centeredPos.y * s;
  isoPos.y = (centeredPos.x * s + centeredPos.y * c) * u_isoScale - zOffset;
  
  // Convert to WebGL clip space [-1, 1]
  vec2 zeroToOne = isoPos / (u_resolution * 0.5);
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = a_quadPos;
  v_faceType = faceType;
}
`;

// Fragment Shader Source - supports both floor and entity colors
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_faceType;
uniform sampler2D u_texture;
uniform int u_renderMode;  // 0 = floor, 1 = entity (3D box)
uniform vec4 u_entityColor;
out vec4 fragColor;

void main() {
  if (u_renderMode == 1) {
    // Render as 3D box with shading based on face type
    vec3 baseColor = vec3(1.0, 0.0, 0.0); // Red base color
    
    // Apply simple shading for different faces to give 3D appearance
    if (v_faceType < 0.5) {
      // Top face - full brightness
      fragColor = vec4(baseColor, 1.0);
    } else if (v_faceType < 1.5) {
      // Front face - slightly darker
      fragColor = vec4(baseColor * 0.7, 1.0);
    } else {
      // Side face - darker
      fragColor = vec4(baseColor * 0.5, 1.0);
    }
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
    // 6 floats per instance: px, py, width, height, faceType, yOffset (xOffset, zOffset are derived)
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

    // 2. Dynamic Instance Buffer (pos, size, faceData)
    const instBuffer = gl.createBuffer();
    if (!instBuffer) throw new Error('Failed to create instance buffer');
    this.instanceBuffer = instBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Attribute 1: Position (px, py) - 2 floats
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, height) - 2 floats
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 8);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: Face data (faceType, yOffset, xOffset, zOffset) - 4 floats as vec4
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 24, 16);
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
  
  /**
   * Render player as a 3D box with camera following the player centered on screen
   */
  public renderPlayer(world: World, width: number, height: number, texture: WebGLTexture,
                      cameraX: number = 0, cameraY: number = 0): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    if (!worldAny || !worldAny.active || !worldAny.active[PLAYER_ID]) return;
    
    const boxWidth = worldAny.width[PLAYER_ID] || 32;
    const boxHeight = worldAny.height[PLAYER_ID] || 32;
    const boxDepth = 24; // Height of the 3D box
    
    // Calculate player position relative to camera (player should be at center)
    const playerX = worldAny.x[PLAYER_ID];
    const playerY = worldAny.y[PLAYER_ID];
    
    // For centered camera: camera offset is player position minus half screen
    // But we want player AT center, so we use player position directly
    // The shader will handle centering by NOT subtracting resolution/2
    
    // We need to render 3 faces of the cube for isometric view:
    // Top face, front-right face, front-left face
    // Each face is a separate instance with different faceData
    // Instance data layout: px, py, width, height, faceType, yOffset, xOffset, zOffset
    // But we only have 6 floats total, so we pack: px, py, width, height, faceType, yOffset
    // and compute xOffset/zOffset in shader based on face type
    
    let offset = 0;
    
    // Top face (faceType = 0, yOffset = boxDepth)
    this.instanceData[offset++] = playerX;
    this.instanceData[offset++] = playerY;
    this.instanceData[offset++] = boxWidth;
    this.instanceData[offset++] = boxHeight;
    this.instanceData[offset++] = 0.0; // faceType = top
    this.instanceData[offset++] = boxDepth; // yOffset = top face height
    
    // Front face (faceType = 1, yOffset = 0)
    this.instanceData[offset++] = playerX;
    this.instanceData[offset++] = playerY;
    this.instanceData[offset++] = boxWidth;
    this.instanceData[offset++] = boxDepth; // height = depth of box
    this.instanceData[offset++] = 1.0; // faceType = front
    this.instanceData[offset++] = 0.0; // yOffset = bottom
    
    // Side face (faceType = 2, yOffset = 0)
    this.instanceData[offset++] = playerX;
    this.instanceData[offset++] = playerY;
    this.instanceData[offset++] = boxDepth; // width = depth for side
    this.instanceData[offset++] = boxHeight;
    this.instanceData[offset++] = 2.0; // faceType = side
    this.instanceData[offset++] = 0.0; // yOffset = bottom

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1i(this.renderModeLoc, 1);  // Entity mode (3D box)
    gl.uniform4f(this.entityColorLoc, 1.0, 0.0, 0.0, 1.0);  // Red color

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 18)); // 3 instances * 6 floats

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 3); // Draw 3 faces
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
