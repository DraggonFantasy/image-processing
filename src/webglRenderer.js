const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FILTER_FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_blur;
uniform float u_posterize;
uniform float u_grayscale;
uniform float u_saturation;

vec3 applySaturation(vec3 color, float amount) {
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 gray = vec3(luma);
  return mix(gray, color, amount);
}

void main() {
  vec2 blurOffset = u_texel * u_blur;

  vec4 c0 = texture2D(u_image, v_uv + blurOffset * vec2(-1.0, -1.0));
  vec4 c1 = texture2D(u_image, v_uv + blurOffset * vec2(0.0, -1.0));
  vec4 c2 = texture2D(u_image, v_uv + blurOffset * vec2(1.0, -1.0));
  vec4 c3 = texture2D(u_image, v_uv + blurOffset * vec2(-1.0, 0.0));
  vec4 c4 = texture2D(u_image, v_uv);
  vec4 c5 = texture2D(u_image, v_uv + blurOffset * vec2(1.0, 0.0));
  vec4 c6 = texture2D(u_image, v_uv + blurOffset * vec2(-1.0, 1.0));
  vec4 c7 = texture2D(u_image, v_uv + blurOffset * vec2(0.0, 1.0));
  vec4 c8 = texture2D(u_image, v_uv + blurOffset * vec2(1.0, 1.0));

  vec4 color = (c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8) / 9.0;

  float levels = max(2.0, u_posterize);
  color.rgb = floor(color.rgb * (levels - 1.0) + 0.5) / (levels - 1.0);

  float grayscaleAmount = clamp(u_grayscale, 0.0, 1.0);
  float gray = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  color.rgb = mix(color.rgb, vec3(gray), grayscaleAmount);

  float saturationAmount = max(0.0, u_saturation);
  float effectiveSaturation = 1.0 + (saturationAmount - 1.0) * (1.0 - grayscaleAmount);
  color.rgb = applySaturation(color.rgb, effectiveSaturation);

  gl_FragColor = color;
}
`;

const DISPLAY_FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_original;
uniform sampler2D u_processed;
uniform int u_viewMode;
uniform float u_split;
uniform float u_overlayOpacity;

void main() {
  vec4 original = texture2D(u_original, v_uv);
  vec4 processed = texture2D(u_processed, v_uv);

  if (u_viewMode == 1) {
    gl_FragColor = v_uv.x < u_split ? original : processed;
    return;
  }

  if (u_viewMode == 2) {
    gl_FragColor = mix(original, processed, clamp(u_overlayOpacity, 0.0, 1.0));
    return;
  }

  gl_FragColor = processed;
}
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }

  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function createTexture(gl, width, height, data = null) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth * dpr);
  const height = Math.floor(canvas.clientHeight * dpr);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }

  return false;
}

export function createWebGLRenderer(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });

  if (!gl) {
    throw new Error('WebGL is not supported in this browser.');
  }

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const filterProgram = createProgram(gl, VERTEX_SHADER_SOURCE, FILTER_FRAGMENT_SHADER_SOURCE);
  const displayProgram = createProgram(gl, VERTEX_SHADER_SOURCE, DISPLAY_FRAGMENT_SHADER_SOURCE);

  const state = {
    originalTexture: null,
    processedTexture: null,
    framebuffer: gl.createFramebuffer(),
    imageWidth: 0,
    imageHeight: 0,
  };

  function bindQuad(program) {
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  }

  function setImage(imageBitmap) {
    const scale = Math.min(1, maxTextureSize / Math.max(imageBitmap.width, imageBitmap.height));
    const targetWidth = Math.max(1, Math.floor(imageBitmap.width * scale));
    const targetHeight = Math.max(1, Math.floor(imageBitmap.height * scale));

    const stagingCanvas = document.createElement('canvas');
    stagingCanvas.width = targetWidth;
    stagingCanvas.height = targetHeight;
    const stagingCtx = stagingCanvas.getContext('2d', { alpha: false });
    stagingCtx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

    if (state.originalTexture) gl.deleteTexture(state.originalTexture);
    if (state.processedTexture) gl.deleteTexture(state.processedTexture);

    state.originalTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, state.originalTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stagingCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);

    state.processedTexture = createTexture(gl, targetWidth, targetHeight);
    state.imageWidth = targetWidth;
    state.imageHeight = targetHeight;
  }

  function runFilterPass(filters) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      state.processedTexture,
      0
    );

    gl.viewport(0, 0, state.imageWidth, state.imageHeight);
    gl.useProgram(filterProgram);
    bindQuad(filterProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.originalTexture);
    gl.uniform1i(gl.getUniformLocation(filterProgram, 'u_image'), 0);
    gl.uniform2f(
      gl.getUniformLocation(filterProgram, 'u_texel'),
      1 / state.imageWidth,
      1 / state.imageHeight
    );
    gl.uniform1f(gl.getUniformLocation(filterProgram, 'u_blur'), filters.blur);
    gl.uniform1f(gl.getUniformLocation(filterProgram, 'u_posterize'), filters.posterize);
    gl.uniform1f(gl.getUniformLocation(filterProgram, 'u_grayscale'), filters.grayscale);
    gl.uniform1f(gl.getUniformLocation(filterProgram, 'u_saturation'), filters.saturation);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function drawToCanvas(view) {
    resizeCanvasToDisplaySize(canvas);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const canvasAspect = canvas.width / canvas.height;
    const imageAspect = state.imageWidth / state.imageHeight;

    let drawWidth = canvas.width;
    let drawHeight = canvas.height;

    if (imageAspect > canvasAspect) {
      drawHeight = Math.round(canvas.width / imageAspect);
    } else {
      drawWidth = Math.round(canvas.height * imageAspect);
    }

    const viewportX = Math.floor((canvas.width - drawWidth) * 0.5);
    const viewportY = Math.floor((canvas.height - drawHeight) * 0.5);
    gl.viewport(viewportX, viewportY, drawWidth, drawHeight);
    gl.useProgram(displayProgram);
    bindQuad(displayProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.originalTexture);
    gl.uniform1i(gl.getUniformLocation(displayProgram, 'u_original'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.processedTexture);
    gl.uniform1i(gl.getUniformLocation(displayProgram, 'u_processed'), 1);

    gl.uniform1i(gl.getUniformLocation(displayProgram, 'u_viewMode'), view.mode);
    gl.uniform1f(gl.getUniformLocation(displayProgram, 'u_split'), view.split);
    gl.uniform1f(gl.getUniformLocation(displayProgram, 'u_overlayOpacity'), view.overlayOpacity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render(filters, view) {
    if (!state.originalTexture || !state.processedTexture) return;
    runFilterPass(filters);
    drawToCanvas(view);
  }

  function exportImage(filters) {
    if (!state.originalTexture || !state.processedTexture) {
      return Promise.reject(new Error('No image loaded.'));
    }

    runFilterPass(filters);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = state.imageWidth;
    exportCanvas.height = state.imageHeight;
    const exportGl = exportCanvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });

    if (!exportGl) {
      return Promise.reject(new Error('Failed to create export context.'));
    }

    const exportProgram = createProgram(exportGl, VERTEX_SHADER_SOURCE, DISPLAY_FRAGMENT_SHADER_SOURCE);
    const exportQuad = exportGl.createBuffer();
    exportGl.bindBuffer(exportGl.ARRAY_BUFFER, exportQuad);
    exportGl.bufferData(
      exportGl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      exportGl.STATIC_DRAW
    );

    const posLoc = exportGl.getAttribLocation(exportProgram, 'a_position');
    exportGl.useProgram(exportProgram);
    exportGl.enableVertexAttribArray(posLoc);
    exportGl.vertexAttribPointer(posLoc, 2, exportGl.FLOAT, false, 0, 0);

    const pixels = new Uint8Array(state.imageWidth * state.imageHeight * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state.processedTexture, 0);
    gl.readPixels(0, 0, state.imageWidth, state.imageHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const texture = createTexture(exportGl, state.imageWidth, state.imageHeight, pixels);

    exportGl.activeTexture(exportGl.TEXTURE0);
    exportGl.bindTexture(exportGl.TEXTURE_2D, texture);
    exportGl.uniform1i(exportGl.getUniformLocation(exportProgram, 'u_original'), 0);

    exportGl.activeTexture(exportGl.TEXTURE1);
    exportGl.bindTexture(exportGl.TEXTURE_2D, texture);
    exportGl.uniform1i(exportGl.getUniformLocation(exportProgram, 'u_processed'), 1);

    exportGl.uniform1i(exportGl.getUniformLocation(exportProgram, 'u_viewMode'), 0);
    exportGl.uniform1f(exportGl.getUniformLocation(exportProgram, 'u_split'), 0.5);
    exportGl.uniform1f(exportGl.getUniformLocation(exportProgram, 'u_overlayOpacity'), 1.0);

    exportGl.viewport(0, 0, state.imageWidth, state.imageHeight);
    exportGl.drawArrays(exportGl.TRIANGLES, 0, 6);

    return new Promise((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to export image.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  function destroy() {
    if (state.originalTexture) gl.deleteTexture(state.originalTexture);
    if (state.processedTexture) gl.deleteTexture(state.processedTexture);
    gl.deleteFramebuffer(state.framebuffer);
    gl.deleteProgram(filterProgram);
    gl.deleteProgram(displayProgram);
    gl.deleteBuffer(quadBuffer);
  }

  return {
    setImage,
    render,
    exportImage,
    destroy,
  };
}
