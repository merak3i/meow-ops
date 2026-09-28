export const ARCHIVE_SEAL_COLORS = {
  teal: '#64e5c2',
  copper: '#d7a463',
} as const;

export const ARCHIVE_SEAL_VIEWBOX_SIZE = 40;
export const ARCHIVE_SEAL_CENTER = { x: 20, y: 20 } as const;
export const ARCHIVE_SEAL_TRACK_PATH = 'M21.5 3.1 27 4.5 35.5 13 36.9 18.5';
export const ARCHIVE_SEAL_TRACK_ROTATIONS = [0, 90, 180, 270] as const;
export const ARCHIVE_SEAL_DIAMOND_PATH = 'm20 14.8 5.2 5.2-5.2 5.2-5.2-5.2 5.2-5.2Z';
export const ARCHIVE_SEAL_CENTER_RADIUS = 2.05;
export const ARCHIVE_SEAL_RAYS = Array.from({ length: 8 }, (_, index) => {
  const angle = index * Math.PI / 4;
  const outerRadius = index % 2 === 0 ? 16 : 13;
  return {
    x1: ARCHIVE_SEAL_CENTER.x + Math.cos(angle) * 6,
    y1: ARCHIVE_SEAL_CENTER.y + Math.sin(angle) * 6,
    x2: ARCHIVE_SEAL_CENTER.x + Math.cos(angle) * outerRadius,
    y2: ARCHIVE_SEAL_CENTER.y + Math.sin(angle) * outerRadius,
    color: index % 2 === 0 ? ARCHIVE_SEAL_COLORS.teal : ARCHIVE_SEAL_COLORS.copper,
  };
});

export function drawArchiveSealVector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = 32,
  background?: string,
) {
  const scale = size / ARCHIVE_SEAL_VIEWBOX_SIZE;
  ctx.save();
  ctx.translate(x - ARCHIVE_SEAL_CENTER.x * scale, y - ARCHIVE_SEAL_CENTER.y * scale);
  ctx.scale(scale, scale);

  if (background) {
    ctx.fillStyle = background;
    ctx.beginPath();
    ctx.arc(ARCHIVE_SEAL_CENTER.x, ARCHIVE_SEAL_CENTER.y, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  const track = new Path2D(ARCHIVE_SEAL_TRACK_PATH);
  ctx.strokeStyle = ARCHIVE_SEAL_COLORS.teal;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const rotation of ARCHIVE_SEAL_TRACK_ROTATIONS) {
    ctx.save();
    ctx.translate(ARCHIVE_SEAL_CENTER.x, ARCHIVE_SEAL_CENTER.y);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-ARCHIVE_SEAL_CENTER.x, -ARCHIVE_SEAL_CENTER.y);
    ctx.stroke(track);
    ctx.restore();
  }

  ctx.globalAlpha = 0.86;
  ctx.lineWidth = 1.7;
  for (const ray of ARCHIVE_SEAL_RAYS) {
    ctx.strokeStyle = ray.color;
    ctx.beginPath();
    ctx.moveTo(ray.x1, ray.y1);
    ctx.lineTo(ray.x2, ray.y2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = ARCHIVE_SEAL_COLORS.copper;
  ctx.fill(new Path2D(ARCHIVE_SEAL_DIAMOND_PATH));
  ctx.fillStyle = ARCHIVE_SEAL_COLORS.teal;
  ctx.beginPath();
  ctx.arc(ARCHIVE_SEAL_CENTER.x, ARCHIVE_SEAL_CENTER.y, ARCHIVE_SEAL_CENTER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
