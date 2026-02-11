import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWebGLRenderer } from './webglRenderer.js';

const VIEW_MODE = {
  PROCESSED: 0,
  SPLIT: 1,
  OVERLAY: 2,
};

function Slider({ label, min, max, step, value, onChange }) {
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  const displayValue = Number(value).toFixed(decimals);

  return (
    <label className="control">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{displayValue}</strong>
    </label>
  );
}

export default function App() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const emptyUploadInputRef = useRef(null);
  const [hasImage, setHasImage] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [modalMessage, setModalMessage] = useState('');

  const [filters, setFilters] = useState({
    blur: 0,
    posterize: 8,
    grayscale: 0,
    saturation: 1,
  });

  const [view, setView] = useState({
    mode: VIEW_MODE.PROCESSED,
    split: 0.5,
    overlayOpacity: 0.5,
  });

  const showErrorModal = useCallback((message) => {
    setModalMessage(message);
  }, []);

  const closeErrorModal = useCallback(() => {
    setModalMessage('');
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      rendererRef.current = createWebGLRenderer(canvasRef.current);
    } catch (rendererError) {
      showErrorModal(rendererError.message || 'Failed to initialize WebGL.');
      return;
    }

    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [showErrorModal]);

  useEffect(() => {
    if (!modalMessage) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeErrorModal();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalMessage, closeErrorModal]);

  const renderFrame = useCallback(() => {
    if (!rendererRef.current || !hasImage) return;
    rendererRef.current.render(filters, view);
  }, [filters, hasImage, view]);

  useEffect(() => {
    renderFrame();
  }, [renderFrame]);

  useEffect(() => {
    if (!hasImage) return undefined;
    const onResize = () => renderFrame();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [hasImage, renderFrame]);

  const loadFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      showErrorModal('Please upload an image file.');
      return;
    }

    setIsLoadingImage(true);

    try {
      const bitmap = await createImageBitmap(file);
      rendererRef.current?.setImage(bitmap);
      rendererRef.current?.render(filters, view);
      bitmap.close?.();
      setHasImage(true);
    } catch (uploadError) {
      showErrorModal('Failed to decode image.');
    } finally {
      setIsLoadingImage(false);
    }
  }, [filters, showErrorModal, view]);

  const onFileInput = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (file) void loadFile(file);
      event.target.value = '';
    },
    [loadFile]
  );

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void loadFile(file);
    },
    [loadFile]
  );

  const exportImage = useCallback(async () => {
    if (!rendererRef.current || !hasImage) return;

    try {
      const blob = await rendererRef.current.exportImage(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'processed-image.png';
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      showErrorModal(exportError.message || 'Export failed.');
    }
  }, [filters, hasImage, showErrorModal]);

  const modeLabel = useMemo(() => {
    if (view.mode === VIEW_MODE.SPLIT) return 'Split';
    if (view.mode === VIEW_MODE.OVERLAY) return 'Overlay';
    return 'Processed';
  }, [view.mode]);

  return (
    <div className={`app ${hasImage ? '' : 'app--empty'}`}>
      {hasImage ? (
        <aside className="panel">
          <div className="panel-header">
            <label className="upload-inline">
              <input type="file" accept="image/*" onChange={onFileInput} hidden />
              Replace image
            </label>
            <button type="button" onClick={exportImage}>
              Export PNG
            </button>
          </div>

          <Slider
            label="Blur"
            min={0}
            max={10}
            step={0.1}
            value={filters.blur}
            onChange={(value) => setFilters((prev) => ({ ...prev, blur: value }))}
          />
          <Slider
            label="Posterize"
            min={2}
            max={32}
            step={1}
            value={filters.posterize}
            onChange={(value) => setFilters((prev) => ({ ...prev, posterize: value }))}
          />
          <Slider
            label="Grayscale"
            min={0}
            max={1}
            step={0.01}
            value={filters.grayscale}
            onChange={(value) => setFilters((prev) => ({ ...prev, grayscale: value }))}
          />
          <Slider
            label="Saturation"
            min={0}
            max={2}
            step={0.01}
            value={filters.saturation}
            onChange={(value) => setFilters((prev) => ({ ...prev, saturation: value }))}
          />

          <div className="modes">
            <span>View mode: {modeLabel}</span>
            <div>
              <button
                type="button"
                onClick={() => setView((prev) => ({ ...prev, mode: VIEW_MODE.PROCESSED }))}
              >
                Processed
              </button>
              <button
                type="button"
                onClick={() => setView((prev) => ({ ...prev, mode: VIEW_MODE.SPLIT }))}
              >
                Split
              </button>
              <button
                type="button"
                onClick={() => setView((prev) => ({ ...prev, mode: VIEW_MODE.OVERLAY }))}
              >
                Overlay
              </button>
            </div>
          </div>

          {view.mode === VIEW_MODE.SPLIT ? (
            <Slider
              label="Split"
              min={0}
              max={1}
              step={0.01}
              value={view.split}
              onChange={(value) => setView((prev) => ({ ...prev, split: value }))}
            />
          ) : null}

          {view.mode === VIEW_MODE.OVERLAY ? (
            <Slider
              label="Overlay"
              min={0}
              max={1}
              step={0.01}
              value={view.overlayOpacity}
              onChange={(value) => setView((prev) => ({ ...prev, overlayOpacity: value }))}
            />
          ) : null}

        </aside>
      ) : null}

      <main
        className={`viewport ${hasImage ? '' : 'viewport--empty'}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <canvas
          ref={canvasRef}
          className={`canvas ${dragActive ? 'canvas--drag' : ''}`}
          aria-label="Image preview"
        />
        {!hasImage ? (
          <div className={`upload-zone ${dragActive ? 'is-active' : ''}`}>
            <div
              className="upload-card upload-card-clickable"
              role="button"
              tabIndex={0}
              onClick={() => emptyUploadInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  emptyUploadInputRef.current?.click();
                }
              }}
            >
              <input
                ref={emptyUploadInputRef}
                type="file"
                accept="image/*"
                onChange={onFileInput}
                hidden
              />
              <p>Upload image</p>
              <p>Drop image here or click to browse</p>
            </div>
          </div>
        ) : null}
      </main>

      {modalMessage ? (
        <div className="modal-backdrop" onClick={closeErrorModal}>
          <div
            className="error-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Error message"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Something went wrong</h2>
            <p>{modalMessage}</p>
            <button type="button" onClick={closeErrorModal}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {isLoadingImage ? (
        <div className="loading-backdrop" role="status" aria-live="polite" aria-label="Loading image">
          <div className="loading-spinner" />
          <p>Loading image...</p>
        </div>
      ) : null}
    </div>
  );
}
