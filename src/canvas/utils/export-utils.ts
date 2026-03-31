/**
 * SVG and PNG export utilities for the React Flow canvas.
 * Captures the current viewport content and triggers a file download.
 */

export function exportToSVG() {
  const viewport = document.querySelector('.react-flow__viewport');
  if (!viewport) return;

  const svgContent = viewport.innerHTML;
  const { width, height } = viewport.getBoundingClientRect();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svgContent}</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  downloadBlob(blob, 'flowlens-graph.svg');
}

export function exportToPNG() {
  const viewport = document.querySelector(
    '.react-flow__viewport',
  ) as HTMLElement;
  if (!viewport) return;

  const { width, height } = viewport.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  const scaleFactor = 2;
  canvas.width = width * scaleFactor;
  canvas.height = height * scaleFactor;

  const svgData = new XMLSerializer().serializeToString(viewport);
  const svgBlob = new Blob(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svgData}</svg>`,
    ],
    { type: 'image/svg+xml' },
  );
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();

  img.onload = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scaleFactor, scaleFactor);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'flowlens-graph.png');
    });
  };
  img.src = url;
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
