local M = {}

-- Solve a 3x3 system with partial pivoting; nil means an unusable geometry.
local function solve(matrix, values)
  local a = {}
  for i = 1, 3 do a[i] = { matrix[i][1], matrix[i][2], matrix[i][3], values[i] } end
  for col = 1, 3 do
    local pivot = col
    for row = col + 1, 3 do
      if math.abs(a[row][col]) > math.abs(a[pivot][col]) then pivot = row end
    end
    if math.abs(a[pivot][col]) < 1e-9 then return nil end
    a[col], a[pivot] = a[pivot], a[col]
    local scale = a[col][col]
    for j = col, 4 do a[col][j] = a[col][j] / scale end
    for row = 1, 3 do
      if row ~= col then
        local factor = a[row][col]
        for j = col, 4 do a[row][j] = a[row][j] - factor * a[col][j] end
      end
    end
  end
  return { a[1][4], a[2][4], a[3][4] }
end

-- Map normalized editor-grid coordinates (u, v) to normalized tracker gaze.
function M.fit(samples)
  if #samples < 3 then return nil, 'Not enough calibration points' end
  local matrix = { { 0, 0, 0 }, { 0, 0, 0 }, { 0, 0, 0 } }
  local bx, by = { 0, 0, 0 }, { 0, 0, 0 }
  for _, s in ipairs(samples) do
    local p = { s.u, s.v, 1 }
    for i = 1, 3 do
      bx[i] = bx[i] + p[i] * s.x
      by[i] = by[i] + p[i] * s.y
      for j = 1, 3 do matrix[i][j] = matrix[i][j] + p[i] * p[j] end
    end
  end
  local x, y = solve(matrix, bx), solve(matrix, by)
  if not x or not y or math.abs(x[1] * y[2] - x[2] * y[1]) < 1e-6 then
    return nil, 'Calibration points do not span a usable area'
  end
  local error_sum = 0
  for _, s in ipairs(samples) do
    local dx = x[1] * s.u + x[2] * s.v + x[3] - s.x
    local dy = y[1] * s.u + y[2] * s.v + y[3] - s.y
    error_sum = error_sum + dx * dx + dy * dy
  end
  return { x = x, y = y, rms = math.sqrt(error_sum / #samples) }
end

function M.to_gaze(transform, u, v)
  local x, y = transform.x, transform.y
  return x[1] * u + x[2] * v + x[3], y[1] * u + y[2] * v + y[3]
end

function M.to_grid(transform, x, y)
  local a, b = transform.x, transform.y
  local det = a[1] * b[2] - a[2] * b[1]
  if math.abs(det) < 1e-6 then return nil end
  x, y = x - a[3], y - b[3]
  return (x * b[2] - a[2] * y) / det, (a[1] * y - x * b[1]) / det
end

-- Keep the calibrated cell origin and cell size when the grid dimensions
-- change. This cannot detect a moved window or a changed font size.
function M.for_grid(transform, saved_cols, saved_rows, cols, rows)
  local x_scale, y_scale = cols / saved_cols, rows / saved_rows
  return {
    x = { transform.x[1] * x_scale, transform.x[2] * y_scale, transform.x[3] },
    y = { transform.y[1] * x_scale, transform.y[2] * y_scale, transform.y[3] },
    rms = transform.rms,
  }
end

return M
