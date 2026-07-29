export class AssetLoader {
  /**
   * Loads an image URL and uploads it as a 2D WebGL texture.
   */
  public static async loadTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
    const image = await AssetLoader.loadImage(url);
    const texture = gl.createTexture();

    if (!texture) {
      throw new Error('Failed to create WebGL texture.');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Upload pixel data to GPU
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    // Default linear filtering for crisp modern rendering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return texture;
  }

  private static loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(new Error(`Failed to load image at ${url}: ${err}`));
      img.src = url;
    });
  }
}
