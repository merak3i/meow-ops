const MAX_COLUMNS = 4;
const COLUMN_SPACING = 3;
const ROW_DEPTH_SPACING = 5.8;
const ROOT_DEPTH = 2.8;
const CAMERA_AXIS = Math.SQRT1_2;

export function sessionLaneRowCount(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('Session lane row count requires a positive integer count.');
  }
  return Math.ceil(count / MAX_COLUMNS);
}

export function sessionLanePosition(index, count, firstRow, totalRows) {
  if (!Number.isInteger(index) || index < 0 || index >= count
    || !Number.isInteger(firstRow) || firstRow < 0
    || !Number.isInteger(totalRows) || totalRows < 1
    || firstRow + sessionLaneRowCount(count) > totalRows) {
    throw new RangeError('Session lane position requires a valid index and row range.');
  }

  const columns = Math.min(count, MAX_COLUMNS);
  const rows = sessionLaneRowCount(count);
  const row = Math.floor(index / columns);
  const rowStart = row * columns;
  const rowCount = Math.min(columns, count - rowStart);
  const column = index - rowStart;
  const screenHorizontal = (column - (rowCount - 1) / 2) * COLUMN_SPACING;
  const screenRow = firstRow + row;
  const screenVertical = ROOT_DEPTH + ((totalRows - 1) / 2 - screenRow) * ROW_DEPTH_SPACING;
  // Align the roster to the camera plane: session columns follow screen-right,
  // while roots stay in front of the archive props and descendants recede.
  const x = (screenHorizontal + screenVertical) * CAMERA_AXIS;
  const z = (-screenHorizontal + screenVertical) * CAMERA_AXIS;

  return [x, z];
}
