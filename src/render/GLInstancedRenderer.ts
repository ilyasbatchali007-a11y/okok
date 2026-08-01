import { World } from '../ecs/World';
import { PLAYER_ID } from '../config/Constants';

// Vertex Shader Source - 3D cube with isometric view and camera rotation
const VS_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_cubePos;    // Cube vertex position [-0.5..0.5]
layout(location = 1) in vec3 a_pos;        // Entity position (px, py, pz)
layout(location = 2) in vec3 a_size;       // Entity size (width, height, depth)
layout(location = 3) in vec3 a_normal;     // Normal for lighting

uniform vec2 u_resolution;
uniform float u_isoAngle;                  // Isometric rotation angle
uniform float u_isoScale;                  // Y scale for isometric projection
uniform vec2 u_cameraOffset;               // Camera offset for scrolling
uniform float u_cameraRotation;            // Camera rotation angle around player
uniform float u_cameraTilt;                // Camera tilt angle

out vec2 v_uv;
out vec3 v_normal;
out vec3 v_worldPos;

void main() {
  // Calculate world position from instance data
  vec3 worldPos = a_pos + (a_cubePos * a_size);
  v_worldPos = worldPos;
  
  // Apply camera rotation around the player (entity center)
  float camCos = cos(u_cameraRotation);
  float camSin = sin(u_cameraRotation);
  
  // Rotate around Z axis (top-down revolution)
  vec3 centeredPos = worldPos - a_pos;
  vec3 rotatedPos;
  rotatedPos.x = centeredPos.x * camCos - centeredPos.y * camSin;
  rotatedPos.y = centeredPos.x * camSin + centeredPos.y * camCos;
  rotatedPos.z = centeredPos.z;
  
  // Add back the entity position
  vec3 finalWorldPos = rotatedPos + a_pos;
  
  // Apply camera offset to get screen-relative position
  vec2 screenPos = finalWorldPos.xy - u_cameraOffset;
  
  // Center on screen
  vec2 centeredScreenPos = screenPos - (u_resolution * 0.5);
  
  // Apply isometric transformation
  float c = cos(u_isoAngle);
  float s = sin(u_isoAngle);
  vec2 isoPos;
  isoPos.x = centeredScreenPos.x * c - centeredScreenPos.y * s;
  isoPos.y = (centeredScreenPos.x * s + centeredScreenPos.y * c) * u_isoScale;
  
  // Add height component (Z affects Y screen position)
  isoPos.y -= finalWorldPos.z * 0.5;
  
  // Convert to WebGL clip space [-1, 1]
  vec2 zeroToOne = isoPos / (u_resolution * 0.5);
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = a_cubePos.xy + 0.5;
  v_normal = a_normal;
}
`;

// Fragment Shader Source - supports 3D box with face shading
const FS_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;
in vec3 v_normal;
in vec3 v_worldPos;
uniform sampler2D u_texture;
uniform int u_renderMode;  // 0 = floor, 1 = entity
uniform vec4 u_entityColor;
uniform vec3 u_lightDir;   // Light direction for shading
out vec4 fragColor;

void main() {
  if (u_renderMode == 1) {
    // Calculate simple directional lighting
    vec3 normal = normalize(v_normal);
    vec3 lightDir = normalize(u_lightDir);
    float diffuse = max(dot(normal, lightDir), 0.3);
    
    // Apply lighting to entity color
    vec3 litColor = u_entityColor.rgb * diffuse;
    fragColor = vec4(litColor, u_entityColor.a);
  } else {
    // Render as green checkered floor pattern
    float gridX = mod(floor(v_uv.x * 8.0), 2.0);
    float gridY = mod(floor(v_uv.y * 8.0), 2.0);
    float checker = mod(gridX + gridY, 2.0);
    
    if (checker < 0.5) {
      fragColor = vec4(0.2, 0.6, 0.2, 1.0);
    } else {
      fragColor = vec4(0.3, 0.7, 0.3, 1.0);
    }
  }
}
`;

export class GLInstancedRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private cubeVertexBuffer: WebGLBuffer;

  private instanceData: Float32Array;
  private resolutionLoc: WebGLUniformLocation | null;
  private isoAngleLoc: WebGLUniformLocation | null;
  private isoScaleLoc: WebGLUniformLocation | null;
  private cameraOffsetLoc: WebGLUniformLocation | null;
  private renderModeLoc: WebGLUniformLocation | null;
  private entityColorLoc: WebGLUniformLocation | null;
  private lightDirLoc: WebGLUniformLocation | null;
  private cameraRotationLoc: WebGLUniformLocation | null;
  
  // Isometric view defaults
  private isoAngle: number = Math.PI / 4;  // 45 degrees
  private isoScale: number = 0.5;          // Y compression for isometric
  private cameraOffsetX: number = 0;
  private cameraOffsetY: number = 0;
  private cameraRotation: number = 0;      // Camera rotation angle around player

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
    this.lightDirLoc = gl.getUniformLocation(this.program, 'u_lightDir');
    this.cameraRotationLoc = gl.getUniformLocation(this.program, 'u_cameraRotation');

    // Create & setup VAO
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(this.vao);

    // 1. Static Cube Buffer (centered unit cube with normals)
    // Each vertex: position (x,y,z) + normal (nx,ny,nz) = 6 floats
    // Cube has 8 corners, but we need 36 vertices (6 faces * 2 triangles * 3 vertices)
    const cubeVerts = this.createCubeVertices();
    const cubeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cubeVerts, gl.STATIC_DRAW);
    this.cubeVertexBuffer = cubeBuffer;

    // Attribute 0: Cube position (vec3)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);

    // Attribute 3: Normal (vec3) - location 3 in shader
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 24, 12);

    // 2. Dynamic Instance Buffer (pos & size in 3D)
    const instBuffer = gl.createBuffer();
    if (!instBuffer) throw new Error('Failed to create instance buffer');
    this.instanceBuffer = instBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Attribute 1: Position (px, py, pz) - vec3
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: Size (width, height, depth) - vec3
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }
  
  /**
   * Create cube vertex data with positions and normals
   */
  private createCubeVertices(): Float32Array {
    // Cube centered at origin, extending from -0.5 to 0.5 on each axis
    // Format: [x, y, z, nx, ny, nz] per vertex
    const verts = [
      // Front face (z = 0.5, normal = 0, 0, 1)
      -0.5, -0.5,  0.5,  0, 0, 1,
       0.5, -0.5,  0.5,  0, 0, 1,
       0.5,  0.5,  0.5,  0, 0, 1,
      -0.5,  0.5,  0.5,  0, 0, 1,
      
      // Back face (z = -0.5, normal = 0, 0, -1)
       0.5, -0.5, -0.5,  0, 0, -1,
      -0.5, -0.5, -0.5,  0, 0, -1,
      -0.5,  0.5, -0.5,  0, 0, -1,
       0.5,  0.5, -0.5,  0, 0, -1,
      
      // Top face (y = 0.5, normal = 0, 1, 0)
      -0.5,  0.5,  0.5,  0, 1, 0,
       0.5,  0.5,  0.5,  0, 1, 0,
       0.5,  0.5, -0.5,  0, 1, 0,
      -0.5,  0.5, -0.5,  0, 1, 0,
      
      // Bottom face (y = -0.5, normal = 0, -1, 0)
      -0.5, -0.5, -0.5,  0, -1, 0,
       0.5, -0.5, -0.5,  0, -1, 0,
       0.5, -0.5,  0.5,  0, -1, 0,
      -0.5, -0.5,  0.5,  0, -1, 0,
      
      // Right face (x = 0.5, normal = 1, 0, 0)
       0.5, -0.5,  0.5,  1, 0, 0,
       0.5,  0.5,  0.5,  1, 0, 0,
       0.5,  0.5, -0.5,  1, 0, 0,
       0.5, -0.5, -0.5,  1, 0, 0,
      
      // Left face (x = -0.5, normal = -1, 0, 0)
      -0.5, -0.5, -0.5, -1, 0, 0,
      -0.5,  0.5, -0.5, -1, 0, 0,
      -0.5,  0.5,  0.5, -1, 0, 0,
      -0.5, -0.5,  0.5, -1, 0, 0,
    ];
    
    // Convert to index buffer (16 unique vertices, 36 indices for 12 triangles)
    const indices = [
      // Front
      0, 1, 2, 0, 2, 3,
      // Back
      4, 5, 6, 4, 6, 7,
      // Top
      8, 9, 10, 8, 10, 11,
      // Bottom
      12, 13, 14, 12, 14, 15,
      // Right
      16, 17, 18, 16, 18, 19,
      // Left
      20, 21, 22, 20, 22, 23,
    ];
    
    // Expand indexed vertices to triangle list
    const triVerts: number[] = [];
    for (const idx of indices) {
      triVerts.push(
        verts[idx * 6],
        verts[idx * 6 + 1],
        verts[idx * 6 + 2],
        verts[idx * 6 + 3],
        verts[idx * 6 + 4],
        verts[idx * 6 + 5]
      );
    }
    
    return new Float32Array(triVerts);
  }
  
  /**
   * Set isometric view parameters
   */
  public setIsometricView(angleRadians: number, scaleY: number): void {
    this.isoAngle = angleRadians;
    this.isoScale = scaleY;
  }
  
  /**
   * Set camera rotation angle (for revolving around player)
   */
  public setCameraRotation(angleRadians: number): void {
    this.cameraRotation = angleRadians;
  }
  
  /**
   * Get current camera rotation
   */
  public getCameraRotation(): number {
    return this.cameraRotation;
  }
  
  public render(world: World, width: number, height: number, texture: WebGLTexture, 
                cameraX: number = 0, cameraY: number = 0): void {
    const gl = this.gl;
    const worldAny = world as any;
    
    // SAFE CHECK: Return early if world or world.set is not ready
    if (!worldAny || !worldAny.set) return;
    
    const count = worldAny.set.count;
    if (!count || count === 0) return;

    // Pack entity transform data into contiguous array (6 floats per entity)
    const dense = worldAny.set.dense;
    if (!dense) return;

    let offset = 0;
    for (let i = 0; i < count; i++) {
      const id = dense[i];
      this.instanceData[offset++] = worldAny.px[id];
      this.instanceData[offset++] = worldAny.py[id];
      this.instanceData[offset++] = worldAny.pz ? worldAny.pz[id] : 0;  // Z position
      this.instanceData[offset++] = worldAny.width[id];
      this.instanceData[offset++] = worldAny.height[id];
      this.instanceData[offset++] = worldAny.depth ? worldAny.depth[id] : 0;  // Depth
    }

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1f(this.cameraRotationLoc, this.cameraRotation);
    gl.uniform3f(this.lightDirLoc, 0.5, 0.8, 0.3);  // Light direction

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 6));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);  // 36 vertices per cube
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
    
    // Pack single player entity (6 floats: px, py, pz, width, height, depth)
    this.instanceData[0] = worldAny.px[PLAYER_ID];
    this.instanceData[1] = worldAny.py[PLAYER_ID];
    this.instanceData[2] = worldAny.pz ? worldAny.pz[PLAYER_ID] : 16;  // Z height (half of box height)
    this.instanceData[3] = worldAny.width[PLAYER_ID];
    this.instanceData[4] = worldAny.height[PLAYER_ID];
    this.instanceData[5] = worldAny.depth ? worldAny.depth[PLAYER_ID] : 32;  // Depth

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLoc, width, height);
    gl.uniform1f(this.isoAngleLoc, this.isoAngle);
    gl.uniform1f(this.isoScaleLoc, this.isoScale);
    gl.uniform2f(this.cameraOffsetLoc, cameraX, cameraY);
    gl.uniform1f(this.cameraRotationLoc, this.cameraRotation);
    gl.uniform1i(this.renderModeLoc, 1);  // Entity mode
    gl.uniform4f(this.entityColorLoc, 1.0, 0.0, 0.0, 1.0);  // Red color
    gl.uniform3f(this.lightDirLoc, 0.5, 0.8, 0.3);  // Light direction

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, 6));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, 1);  // 36 vertices for one cube
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
