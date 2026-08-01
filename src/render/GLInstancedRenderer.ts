import { World } from '../ecs/World';
import { PLAYER_ID } from '../config/Constants';

// Vertex Shader Source - 3D box with orbit camera support
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_quadPos; // Unit cube vertex position [0..1] with Z for height
layout(location = 1) in vec3 a_pos;     // Entity position (px, py, pz/height_offset)
layout(location = 2) in vec3 a_size;    // Entity size (width, height, depth)

uniform vec2 u_resolution;
uniform float u_isoAngle;               // Isometric rotation angle
uniform float u_isoScale;               // Y scale for isometric projection (typically 0.5)
uniform vec2 u_cameraOffset;            // Camera offset for scrolling
uniform float u_cameraOrbit;            // Camera orbit angle around player
uniform float u_cameraDistance;         // Distance from player for orbit
uniform float u_cameraHeight;           // Camera height offset

out vec3 v_uv;

void main() {
  // Calculate world position from instance data (including height)
  vec3 worldPos = a_pos + (a_quadPos * a_size);
  
  // Apply camera offset to get screen-relative position
  vec2 screenPos = worldPos.xy - u_cameraOffset;
  
  // Apply orbit rotation around the player center
  vec2 centeredPos = screenPos - (u_resolution * 0.5);
  
  // Orbit rotation
  float c_orbit = cos(u_cameraOrbit);
  float s_orbit = sin(u_cameraOrbit);
  vec2 orbitPos;
  orbitPos.x = centeredPos.x * c_orbit - centeredPos.y * s_orbit;
  orbitPos.y = centeredPos.x * s_orbit + centeredPos.y * c_orbit;
  
  // Apply isometric transformation: rotate 45° and scale Y by 0.5
  float c = cos(u_isoAngle);
  float s = sin(u_isoAngle);
  vec2 isoPos;
  isoPos.x = orbitPos.x * c - orbitPos.y * s;
  isoPos.y = (orbitPos.x * s + orbitPos.y * c) * u_isoScale;
  
  // Add height component (Z) to create 3D box effect
  float heightOffset = a_quadPos.z * a_size.z * u_isoScale * 0.5;
  isoPos.y -= heightOffset;
  
  // Convert to WebGL clip space [-1, 1]
  vec2 zeroToOne = isoPos / (u_resolution * 0.5);
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = a_quadPos;
}
`;

// Fragment Shader Source - supports both floor and entity colors with simple lighting
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec3 v_uv;
uniform sampler2D u_texture;
uniform int u_renderMode;  // 0 = floor, 1 = entity
uniform vec4 u_entityColor;
out vec4 fragColor;

void main() {
  if (u_renderMode == 1) {
    // Render as solid red entity with simple shading based on face
    vec3 normal;
    // Determine which face we're on based on UV coordinates
    if (v_uv.z < 0.01) {
      // Bottom face - darker
      normal = vec3(0.0, -1.0, 0.0);
    } else if (v_uv.z > 0.99) {
      // Top face - brighter
      normal = vec3(0.0, 1.0, 0.0);
    } else if (v_uv.x < 0.01) {
      normal = vec3(-1.0, 0.0, 0.0);
    } else if (v_uv.x > 0.99) {
      normal = vec3(1.0, 0.0, 0.0);
    } else if (v_uv.y < 0.01) {
      normal = vec3(0.0, -1.0, 0.0);
    } else {
      normal = vec3(0.0, 0.0, 1.0);
    }
    
    // Simple directional light from top-right
    vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
    float diffuse = max(dot(normal, lightDir), 0.3);
    
    fragColor = vec4(u_entityColor.rgb * diffuse, u_entityColor.a);
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
  private cameraOrbitLoc: WebGLUniformLocation | null;
  private cameraDistanceLoc: WebGLUniformLocation | null;
  private cameraHeightLoc: WebGLUniformLocation | null;
  
  // Isometric view defaults
  private isoAngle: number = Math.PI / 4;  // 45 degrees
  private isoScale: number = 0.5;          // Y compression for isometric
  private cameraOffsetX: number = 0;
  private cameraOffsetY: number = 0;
  private cameraOrbit: number = 0;         // Orbit angle around player
  private cameraDistance: number = 100;    // Distance from player
  private cameraHeight: number = 50;       // Camera height offset

  constructor(gl: WebGL2RenderingContext, maxEntities: number) {
    this.gl = gl;
    // 6 floats per instance: px, py, pz, width, height, depth
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
    this.cameraOrbitLoc = gl.getUniformLocation(this.program, 'u_cameraOrbit');
    this.cameraDistanceLoc = gl.getUniformLocation(this.program, 'u_cameraDistance');
    this.cameraHeightLoc = gl.getUniformLocation(this.program, 'u_cameraHeight');

    // Create & setup VAO
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(this.vao);

    // 1. Static Cube Buffer (unit cube vertices with Z for height)
    const cubeVertices = new Float32Array([
      // Bottom face (z=0)
      0, 0, 0,   1, 0, 0,   0, 1, 0,
      0, 1, 0,   1, 0, 0,   1, 1, 0,
      // Top face (z=1)
      0, 0, 1,   1, 0, 1,   0, 1, 1,
      0, 1, 1,   1, 0, 1,   1, 1, 1,
      // Front face (y=0)
      0, 0, 0,   1, 0, 0,   0, 0, 1,
      0, 0, 1,   1, 0, 0,   1, 0, 1,
      // Back face (y=1)
      0, 1, 0,   1, 1, 0,   0, 1, 1,
      0, 1, 1,   1, 1, 0,   1, 1, 1,
      // Left face (x=0)
      0, 0, 0,   0, 1, 0,   0, 0, 1,
      0, 0, 1,   0, 1, 0,   0, 1, 1,
      // Right face (x=1)
      1, 0, 0,   1, 1, 0,   1, 0, 1,
      1, 0, 1,   1, 1, 0,   1, 1, 1,
    ]);
    const cubeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cubeVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // 2. Dynamic Instance Buffer (pos & size)
    const instBuffer = gl.createBuffer();
    if (!instBuffer) throw new Error('Failed to create instance buffer');
    this.instanceBuffer = instBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Attribute 1: Position (px, py, pz)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, height, depth)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(2, 1);

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
   * Set camera orbit parameters for revolving around player
   */
  public setCameraOrbit(orbitAngle: number, distance: number, height: number): void {
    this.cameraOrbit = orbitAngle;
    this.cameraDistance = distance;
    this.cameraHeight = height;
  }
  
  /**
   * Get current camera orbit angle
   */
  public getCameraOrbit(): number {
    return this.cameraOrbit;
  }
  
  /**
   * Update camera orbit angle (for animation)
   */
  public updateCameraOrbit(deltaTime: number): void {
    // Slowly rotate camera around player (30 degrees per second)
    this.cameraOrbit += deltaTime * (Math.PI / 6);
    if (this.cameraOrbit > Math.PI * 2) {
      this.cameraOrbit -= Math.PI * 2;
    }
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
      this.instanceData[offset++] = 0;  // Z position (height offset)
      this.instanceData[offset++] = worldAny.width[id];
      this.instanceData[offset++] = worldAny.height[id];
      this.instanceData[offset++] = worldAny.depth ? worldAny.depth[id] : worldAny.height[id];  // Use height as depth if no depth
    }

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1f(this.cameraOrbitLoc, this.cameraOrbit);
    gl.uniform1f(this.cameraDistanceLoc, this.cameraDistance);
    gl.uniform1f(this.cameraHeightLoc, this.cameraHeight);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 6));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);  // 36 vertices for full cube (6 faces x 2 triangles x 3 vertices)
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
    
    // Pack single player entity as a 3D box
    const playerWidth = worldAny.width[PLAYER_ID];
    const playerHeight = worldAny.height[PLAYER_ID];
    const playerDepth = playerHeight;  // Make it a cube
    
    this.instanceData[0] = worldAny.px[PLAYER_ID];
    this.instanceData[1] = worldAny.py[PLAYER_ID];
    this.instanceData[2] = 0;  // Z position (on ground)
    this.instanceData[3] = playerWidth;
    this.instanceData[4] = playerHeight;
    this.instanceData[5] = playerDepth;

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1f(this.cameraOrbitLoc, this.cameraOrbit);
    gl.uniform1f(this.cameraDistanceLoc, this.cameraDistance);
    gl.uniform1f(this.cameraHeightLoc, this.cameraHeight);
    gl.uniform1i(this.renderModeLoc, 1);  // Entity mode
    gl.uniform4f(this.entityColorLoc, 1.0, 0.0, 0.0, 1.0);  // Red color

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 6));

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);  // Draw all 36 vertices for the cube
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
