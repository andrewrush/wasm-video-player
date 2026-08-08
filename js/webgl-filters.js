/**
 * WebGL Video Filters for WASM Video Player
 * Inspired by movi-player canvas rendering pipeline
 */

class WebGLVideoFilter {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true }) || 
              canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
    this.video = null;
    this.animationId = null;
    this.currentFilter = 'none';
    this.init();
  }

  init() {
    const gl = this.gl;

    // Vertex shader
    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    // Fragment shader with filter uniforms
    const fsSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_texture;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform int u_filter; // 0=none,1=grayscale,2=sepia,3=invert,4=vintage,5=edge,6=pixelate,7=blur
      uniform float u_intensity;

      vec4 grayscale(vec4 color) {
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        return vec4(vec3(gray), color.a);
      }

      vec4 sepia(vec4 color) {
        vec3 sepiaColor = vec3(
          dot(color.rgb, vec3(0.393, 0.769, 0.189)),
          dot(color.rgb, vec3(0.349, 0.686, 0.168)),
          dot(color.rgb, vec3(0.272, 0.534, 0.131))
        );
        return vec4(sepiaColor, color.a);
      }

      vec4 invert(vec4 color) {
        return vec4(1.0 - color.rgb, color.a);
      }

      vec4 vintage(vec4 color) {
        vec3 v = color.rgb;
        v *= vec3(1.2, 1.0, 0.8);
        v = clamp(v, 0.0, 1.0);
        float noise = (fract(sin(dot(v_texCoord * u_time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.05;
        v += noise;
        float vignette = 1.0 - length((v_texCoord - 0.5) * 1.5);
        vignette = clamp(vignette, 0.0, 1.0);
        v *= vignette * 0.7 + 0.3;
        return vec4(v, color.a);
      }

      vec4 edgeDetect(sampler2D tex, vec2 uv, vec2 res) {
        float offset = 1.0 / res.x;
        vec4 c = texture2D(tex, uv);
        vec4 left = texture2D(tex, uv + vec2(-offset, 0.0));
        vec4 right = texture2D(tex, uv + vec2(offset, 0.0));
        vec4 top = texture2D(tex, uv + vec2(0.0, offset));
        vec4 bottom = texture2D(tex, uv + vec2(0.0, -offset));
        vec3 edge = abs(left.rgb - right.rgb) + abs(top.rgb - bottom.rgb);
        float gray = dot(edge, vec3(0.299, 0.587, 0.114));
        return vec4(vec3(gray), 1.0);
      }

      vec4 pixelate(sampler2D tex, vec2 uv, vec2 res) {
        float pixels = 80.0;
        vec2 dx = vec2(1.0 / pixels, 1.0 / pixels * (res.x / res.y));
        vec2 coord = floor(uv / dx) * dx + dx * 0.5;
        return texture2D(tex, coord);
      }

      vec4 blur(sampler2D tex, vec2 uv, vec2 res) {
        float offset = 2.0 / res.x;
        vec4 color = vec4(0.0);
        float total = 0.0;
        for (float x = -2.0; x <= 2.0; x += 1.0) {
          for (float y = -2.0; y <= 2.0; y += 1.0) {
            vec2 sampleUV = uv + vec2(x, y) * offset;
            float weight = 1.0 - length(vec2(x, y)) / 3.0;
            weight = max(weight, 0.0);
            color += texture2D(tex, sampleUV) * weight;
            total += weight;
          }
        }
        return color / total;
      }

      void main() {
        vec4 color = texture2D(u_texture, v_texCoord);

        if (u_filter == 1) {
          color = grayscale(color);
        } else if (u_filter == 2) {
          color = sepia(color);
        } else if (u_filter == 3) {
          color = invert(color);
        } else if (u_filter == 4) {
          color = vintage(color);
        } else if (u_filter == 5) {
          color = edgeDetect(u_texture, v_texCoord, u_resolution);
        } else if (u_filter == 6) {
          color = pixelate(u_texture, v_texCoord, u_resolution);
        } else if (u_filter == 7) {
          color = blur(u_texture, v_texCoord, u_resolution);
        }

        gl_FragColor = color;
      }
    `;

    this.program = this.createProgram(vsSource, fsSource);
    gl.useProgram(this.program);

    // Setup geometry
    const positions = new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1
    ]);
    const texCoords = new Float32Array([
      0, 1,  1, 1,  0, 0,
      0, 0,  1, 1,  1, 0
    ]);

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    // Create texture
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Uniforms
    this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.uTime = gl.getUniformLocation(this.program, 'u_time');
    this.uFilter = gl.getUniformLocation(this.program, 'u_filter');
    this.uIntensity = gl.getUniformLocation(this.program, 'u_intensity');
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  setVideo(video) {
    this.video = video;
  }

  setFilter(filterName) {
    const map = {
      'none': 0, 'grayscale': 1, 'sepia': 2, 'invert': 3,
      'vintage': 4, 'edge': 5, 'pixelate': 6, 'blur': 7
    };
    this.currentFilter = filterName;
    this.filterId = map[filterName] || 0;
  }

  render() {
    if (!this.video || this.video.paused || this.video.ended) return;
    const gl = this.gl;
    const canvas = this.canvas;

    if (canvas.width !== this.video.videoWidth || canvas.height !== this.video.videoHeight) {
      canvas.width = this.video.videoWidth || canvas.clientWidth;
      canvas.height = this.video.videoHeight || canvas.clientHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);

    gl.uniform2f(this.uResolution, canvas.width, canvas.height);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1i(this.uFilter, this.filterId);
    gl.uniform1f(this.uIntensity, 1.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  start() {
    if (this.animationId) return;
    const loop = () => {
      this.render();
      this.animationId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  destroy() {
    this.stop();
    if (this.gl) {
      this.gl.deleteProgram(this.program);
      this.gl.deleteTexture(this.texture);
      this.gl.deleteBuffer(this.positionBuffer);
      this.gl.deleteBuffer(this.texCoordBuffer);
    }
  }
}

// Expose globally
window.WebGLVideoFilter = WebGLVideoFilter;
